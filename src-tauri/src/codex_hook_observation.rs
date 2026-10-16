use super::documents::{Definition, Format, Source};
use crate::codex_cli::{self, AppServer, RpcError};
use crate::codex_plugins::read_config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::Duration,
};

const VERIFIED_CLI: &str = "codex-cli 0.162.1";

// Only the CLI interaction varies in tests; parsing, source reads, and binding stay here.
pub(super) trait Session {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, RpcError>;
}

pub(super) trait Native {
    type Server: Session;
    fn connect(&self, home: &Path, inspect_hooks: bool) -> Result<Self::Server, RpcError>;
    fn version(&self, home: &Path) -> Result<codex_cli::Output, String>;
}

pub(super) struct NativeCodex;

impl Session for AppServer {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        AppServer::request(self, method, params)
    }
}

impl Native for NativeCodex {
    type Server = AppServer;

    fn connect(&self, home: &Path, inspect_hooks: bool) -> Result<Self::Server, RpcError> {
        if inspect_hooks {
            AppServer::inspect_hooks(home)
        } else {
            AppServer::start(home)
        }
    }

    fn version(&self, home: &Path) -> Result<codex_cli::Output, String> {
        codex_cli::run(home, &["--version"], Duration::from_secs(5))
    }
}

pub(super) struct HookObservation {
    pub inventory: Result<Inventory, RpcError>,
    pub definitions: DefinitionScan,
    pub definition_observation: Option<DefinitionObservation>,
}

pub(super) fn observe_with(home: &Path, reader: &impl Native) -> HookObservation {
    let inventory = load_with(home, reader);
    let (definitions, definition_observation) = definition_view(home, &inventory, reader);
    HookObservation {
        inventory,
        definitions,
        definition_observation,
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct HookMetadata {
    pub(super) key: String,
    pub(super) current_hash: String,
    pub(super) event_name: String,
    pub(super) handler_type: String,
    pub(super) source: String,
    pub(super) source_path: String,
    pub(super) plugin_id: Option<String>,
    pub(super) enabled: bool,
    pub(super) is_managed: bool,
    pub(super) trust_status: String,
    pub(super) display_order: i64,
    pub(super) matcher: Option<String>,
    pub(super) timeout_sec: u64,
    pub(super) status_message: Option<String>,
    pub(super) additional_context_limit: Option<u64>,
    pub(super) command: Option<String>,
    pub(super) server: Option<String>,
    pub(super) tool: Option<String>,
    #[serde(rename = "async", default)]
    pub(super) is_async: bool,
}

#[derive(Clone)]
pub(super) struct ConfigView {
    pub(super) target: PathBuf,
    pub(super) version: String,
    pub(super) states: Value,
    pub(super) origins: Value,
}

pub(super) struct Inventory {
    pub(super) hooks: Vec<HookMetadata>,
    pub(super) warnings: Vec<String>,
    pub(super) errors: Vec<String>,
    pub(super) feature_enabled: Option<bool>,
    pub(super) config: Result<ConfigView, String>,
}

pub(super) fn same_path(path: &str, target: &Path) -> bool {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path)) == target
}

fn config_view(home: &Path, response: Value) -> Result<ConfigView, String> {
    let file = read_config(&home.join("config.toml"))?;
    let layers = response["layers"]
        .as_array()
        .ok_or("CLI 未提供用户配置版本，当前仅供查看。")?;
    let layer = layers
        .iter()
        .find(|layer| {
            layer["name"]["type"] == "user"
                && layer["name"]["profile"].is_null()
                && layer["name"]["file"]
                    .as_str()
                    .is_some_and(|p| same_path(p, &file.target))
                && layer["disabledReason"].is_null()
        })
        .ok_or("无法确认当前 Codex home 的用户配置层，当前仅供查看。")?;
    let version = layer["version"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("CLI 未提供用户配置版本，当前仅供查看。")?;
    if !response["origins"].is_object() {
        return Err("CLI 未提供配置来源，当前仅供查看。".into());
    }
    Ok(ConfigView {
        target: file.target,
        version: version.into(),
        states: response["config"]["hooks"]["state"].clone(),
        origins: response["origins"].clone(),
    })
}

pub(super) fn parse_inventory(
    response: Value,
) -> Result<(Vec<HookMetadata>, Vec<String>, Vec<String>), RpcError> {
    #[derive(Deserialize)]
    struct Entry {
        cwd: String,
        hooks: Vec<HookMetadata>,
        warnings: Vec<String>,
        errors: Vec<HookError>,
    }
    #[derive(Deserialize)]
    struct HookError {
        message: String,
        path: String,
    }
    #[derive(Deserialize)]
    struct Response {
        data: Vec<Entry>,
    }
    let mut response: Response =
        serde_json::from_value(response).map_err(|_| RpcError::incompatible())?;
    if response.data.len() != 1 || response.data[0].cwd != "/" {
        return Err(RpcError::incompatible());
    }
    let entry = response.data.remove(0);
    let mut keys = HashSet::new();
    for hook in &entry.hooks {
        if hook.key.is_empty()
            || hook.current_hash.is_empty()
            || !Path::new(&hook.source_path).is_absolute()
            || !keys.insert(hook.key.clone())
        {
            return Err(RpcError::incompatible());
        }
    }
    let mut hooks: Vec<_> = entry
        .hooks
        .into_iter()
        .filter(|hook| matches!(hook.source.as_str(), "user" | "plugin"))
        .collect();
    hooks.sort_by_key(|hook| hook.display_order);
    Ok((
        hooks,
        entry.warnings,
        entry
            .errors
            .into_iter()
            .map(|error| format!("{}：{}", error.path, error.message))
            .collect(),
    ))
}

fn feature_enabled(server: &mut impl Session) -> Result<bool, RpcError> {
    let mut cursor: Option<String> = None;
    let mut cursors = HashSet::new();
    loop {
        let response = server.request(
            "experimentalFeature/list",
            json!({"limit":100,"cursor":cursor}),
        )?;
        let features = response["data"]
            .as_array()
            .ok_or_else(RpcError::incompatible)?;
        if let Some(feature) = features.iter().find(|feature| feature["name"] == "hooks") {
            return feature["enabled"]
                .as_bool()
                .ok_or_else(RpcError::incompatible);
        }
        match response["nextCursor"].as_str() {
            Some(next) if cursors.insert(next.to_owned()) => cursor = Some(next.into()),
            _ => return Err(RpcError::incompatible()),
        }
    }
}

pub(super) fn load(home: &Path) -> Result<Inventory, RpcError> {
    load_with(home, &NativeCodex)
}

fn load_with(home: &Path, reader: &impl Native) -> Result<Inventory, RpcError> {
    let mut server = reader.connect(home, false)?;
    let (hooks, warnings, mut errors) =
        parse_inventory(server.request("hooks/list", json!({"cwds":["/"]}))?)?;
    let config = server
        .request("config/read", json!({"includeLayers":true,"cwd":"/"}))
        .map_err(|error| error.message)
        .and_then(|response| config_view(home, response));
    let enabled = match feature_enabled(&mut server) {
        Ok(enabled) => Some(enabled),
        Err(_) => {
            errors
                .push("无法核实 hooks 总开关状态，请检查 CLI 兼容性后刷新，当前仅供查看。".into());
            None
        }
    };
    Ok(Inventory {
        hooks,
        warnings,
        errors,
        feature_enabled: enabled,
        config,
    })
}

#[derive(Clone)]
pub(super) struct DefinitionObservation {
    pub(super) id: String,
    pub(super) home: PathBuf,
    pub(super) sources: Vec<Source>,
    pub(super) native: Vec<HookMetadata>,
    pub(super) config: ConfigView,
    pub(super) feature_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionEntry {
    pub(super) id: String,
    pub(super) source: Format,
    pub(super) source_path: String,
    pub(super) event: String,
    pub(super) matcher: Option<String>,
    pub(super) handler: Value,
    pub(super) native_key: Option<String>,
    pub(super) enabled: Option<bool>,
    pub(super) trust_status: String,
    pub(super) read_only_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionSource {
    pub(super) format: Format,
    pub(super) path: String,
    pub(super) has_definitions: bool,
    pub(super) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionScan {
    pub(super) snapshot_id: Option<String>,
    pub(super) entries: Vec<DefinitionEntry>,
    pub(super) sources: Vec<DefinitionSource>,
    pub(super) default_source: Option<Format>,
    pub(super) read_only_reason: Option<String>,
}

pub(super) fn native(home: &Path) -> Result<(Vec<HookMetadata>, ConfigView, bool), String> {
    native_from(home, &load(home), &NativeCodex)
}

fn native_from(
    home: &Path,
    inventory: &Result<Inventory, RpcError>,
    reader: &impl Native,
) -> Result<(Vec<HookMetadata>, ConfigView, bool), String> {
    let inventory = inventory.as_ref().map_err(|e| e.message.clone())?;
    let config = inventory.config.as_ref().map_err(Clone::clone)?.clone();
    let enabled = inventory
        .feature_enabled
        .ok_or("无法确认 Hooks 总开关，定义当前只读。")?;
    if !inventory.errors.is_empty() {
        return Err(inventory.errors.join("\n"));
    }
    let hooks = if enabled {
        inventory.hooks.clone()
    } else {
        let mut server = reader.connect(home, true).map_err(|e| e.message)?;
        let (hooks, _, errors) = parse_inventory(
            server
                .request("hooks/list", json!({"cwds":["/"]}))
                .map_err(|e| e.message)?,
        )
        .map_err(|e| e.message)?;
        if !errors.is_empty() {
            return Err(errors.join("\n"));
        }
        hooks
    };
    Ok((hooks, config, enabled))
}

fn verified_version_with(home: &Path, reader: &impl Native) -> Result<(), String> {
    let version = reader.version(home)?;
    if !version.success || version.stdout.trim() != VERIFIED_CLI {
        return Err("当前 CLI 的定义编辑能力尚未验证，暂时只读。已验证版本为 Codex CLI 0.162.1；已有启停能力独立判断。".into());
    }
    Ok(())
}

pub(super) fn matches_native(definition: &Definition, hook: &HookMetadata) -> bool {
    let event = &definition.location.event;
    let event = event[..1].to_lowercase() + &event[1..];
    let handler_type = match definition.handler["type"].as_str() {
        Some("command") => "command",
        Some("mcp_tool") => "mcpTool",
        _ => return false,
    };
    !hook.is_managed
        && matches!(
            hook.trust_status.as_str(),
            "trusted" | "modified" | "untrusted"
        )
        && hook.event_name == event
        && hook.handler_type == handler_type
        && (matches!(
            definition.location.event.as_str(),
            "Stop" | "Interrupt" | "UserPromptSubmit"
        ) || hook.matcher == definition.matcher)
        && if handler_type == "command" {
            hook.command.as_deref() == definition.handler["command"].as_str()
        } else {
            hook.server.as_deref() == definition.handler["server"].as_str()
                && hook.tool.as_deref() == definition.handler["tool"].as_str()
        }
}

fn bind(sources: &[Source], hooks: &[HookMetadata]) -> Result<(), String> {
    let mut keys = HashSet::new();
    for source in sources {
        for definition in source.definitions()? {
            let key = definition.location.key(&source.file.path)?;
            let hook = hooks
                .iter()
                .find(|h| {
                    h.key == key
                        && h.source == "user"
                        && same_path(&h.source_path, &source.file.path)
                })
                .ok_or("无法将用户定义与 Codex 身份可靠关联，定义当前只读。")?;
            if !matches_native(&definition, hook) {
                return Err("原生定义与文件内容不一致，定义当前只读。".into());
            }
            keys.insert(key);
        }
    }
    if hooks
        .iter()
        .any(|h| h.source == "user" && !keys.contains(&h.key))
    {
        return Err("原生清单包含未识别的用户来源，无法确认变更范围。".into());
    }
    Ok(())
}

fn definition_view(
    home: &Path,
    inventory: &Result<Inventory, RpcError>,
    reader: &impl Native,
) -> (DefinitionScan, Option<DefinitionObservation>) {
    let mut sources = vec![];
    let mut choices = vec![];
    let mut reason = None;
    for format in [Format::Json, Format::Toml] {
        let source = Source::read(home, format).and_then(|source| {
            source.definitions()?;
            Ok(source)
        });
        let error = source.as_ref().err().cloned();
        if reason.is_none() {
            reason = error.clone();
        }
        choices.push(DefinitionSource {
            format,
            path: home.join(format.filename()).display().to_string(),
            has_definitions: source
                .as_ref()
                .is_ok_and(|s| s.definitions().is_ok_and(|d| !d.is_empty())),
            error,
        });
        if let Ok(source) = source {
            sources.push(source);
        }
    }
    let native = native_from(home, inventory, reader);
    if reason.is_none() {
        reason = native.as_ref().err().cloned();
    }
    if reason.is_none() {
        reason = verified_version_with(home, reader).err();
    }
    if let Ok((hooks, _, _)) = &native {
        if reason.is_none() {
            reason = bind(&sources, hooks).err();
        }
    }
    let mut entries = vec![];
    for source in &sources {
        for definition in source.definitions().unwrap_or_default() {
            let key = definition.location.key(&source.file.path).ok();
            let hook = native.as_ref().ok().and_then(|(hooks, _, _)| {
                hooks
                    .iter()
                    .find(|h| Some(&h.key) == key.as_ref() && h.source == "user")
            });
            entries.push(DefinitionEntry {
                id: definition.location.id(source.format),
                source: source.format,
                source_path: source.file.path.display().to_string(),
                event: definition.location.event,
                matcher: definition.matcher,
                handler: definition.handler,
                native_key: hook.map(|h| h.key.clone()),
                enabled: hook.map(|h| h.enabled),
                trust_status: hook.map_or("unknown".into(), |h| h.trust_status.clone()),
                read_only_reason: reason.clone(),
            });
        }
    }
    let configured: Vec<_> = choices
        .iter()
        .filter(|s| s.has_definitions)
        .map(|s| s.format)
        .collect();
    let default_source = match configured.as_slice() {
        [] => Some(Format::Json),
        [one] => Some(*one),
        _ => None,
    };
    let observation = if reason.is_none() {
        native
            .ok()
            .map(|(native, config, feature_enabled)| DefinitionObservation {
                id: String::new(),
                home: home.into(),
                sources,
                native,
                config,
                feature_enabled,
            })
    } else {
        None
    };
    (
        DefinitionScan {
            snapshot_id: None,
            entries,
            sources: choices,
            default_source,
            read_only_reason: reason,
        },
        observation,
    )
}

impl DefinitionObservation {
    pub(super) fn fresh(&self) -> Result<(), String> {
        self.fresh_with(&NativeCodex)
    }

    fn fresh_with(&self, reader: &impl Native) -> Result<(), String> {
        if !self.sources.iter().all(|s| s.file.unchanged()) {
            return Err("定义文件或用户配置已变化，请刷新并重新确认。".into());
        }
        verified_version_with(&self.home, reader)?;
        let (hooks, config, enabled) =
            native_from(&self.home, &load_with(&self.home, reader), reader)?;
        if hooks != self.native
            || config.version != self.config.version
            || config.target != self.config.target
            || config.origins != self.config.origins
            || enabled != self.feature_enabled
        {
            return Err("Codex 定义、信任或配置状态已变化，请刷新并重新确认。".into());
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "codex_hook_observation_tests.rs"]
pub(super) mod tests;
