use crate::codex_cli::{self, AppServer, RpcError, RpcErrorKind};
use crate::codex_plugins::{read_config, resolve_home};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub(crate) struct HooksState(Arc<Mutex<State>>);

#[derive(Default)]
struct State {
    sequence: u64,
    observation: Option<Observation>,
}

struct Observation {
    id: String,
    home: PathBuf,
    config: ConfigView,
    hooks: HashMap<String, HookMetadata>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct HookMetadata {
    key: String,
    current_hash: String,
    event_name: String,
    handler_type: String,
    source: String,
    source_path: String,
    plugin_id: Option<String>,
    enabled: bool,
    is_managed: bool,
    trust_status: String,
    display_order: i64,
    matcher: Option<String>,
    timeout_sec: u64,
    status_message: Option<String>,
    additional_context_limit: Option<u64>,
    command: Option<String>,
    server: Option<String>,
    tool: Option<String>,
    #[serde(rename = "async", default)]
    is_async: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HookEntry {
    #[serde(flatten)]
    hook: HookMetadata,
    read_only_reason: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
enum ScanStatus {
    Ready,
    MissingCli,
    Incompatible,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookScan {
    snapshot_id: Option<String>,
    directory: String,
    config_path: String,
    status: ScanStatus,
    feature_enabled: Option<bool>,
    hooks: Vec<HookEntry>,
    warnings: Vec<String>,
    config_error: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookChangeRequest {
    snapshot_id: String,
    key: String,
    enabled: bool,
}

#[derive(Debug, Serialize, PartialEq)]
enum ChangeStatus {
    Saved,
    Conflict,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookChangeResult {
    status: ChangeStatus,
    message: String,
}

impl HookChangeResult {
    fn new(status: ChangeStatus, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn conflict() -> Self {
        Self::new(
            ChangeStatus::Conflict,
            "Hook 定义、状态或用户配置已变化，请刷新并重新确认。",
        )
    }
}

#[derive(Clone)]
struct ConfigView {
    target: PathBuf,
    version: String,
    states: Value,
    origins: Value,
}

struct Inventory {
    hooks: Vec<HookMetadata>,
    warnings: Vec<String>,
    errors: Vec<String>,
    feature_enabled: Option<bool>,
    config: Result<ConfigView, String>,
}

fn same_path(path: &str, target: &Path) -> bool {
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

fn parse_inventory(
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

fn feature_enabled(server: &mut AppServer) -> Result<bool, RpcError> {
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

fn load(home: &Path) -> Result<Inventory, RpcError> {
    let mut server = AppServer::start(home)?;
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

fn read_only(hook: &HookMetadata, config: &ConfigView) -> Option<String> {
    if hook.is_managed || hook.trust_status == "managed" {
        return Some("由策略管理，不能在此启停。".into());
    }
    match hook.trust_status.as_str() {
        "untrusted" => return Some("待信任：请在 Codex 的 Hooks 界面审查，再刷新此页。".into()),
        "modified" => return Some("定义已修改：请在 Codex 中重新审查，再刷新此页。".into()),
        "trusted" => {}
        _ => return Some("无法确认信任状态，当前仅供查看。".into()),
    }
    if !matches!(hook.source.as_str(), "user" | "plugin")
        || (hook.source == "plugin" && hook.plugin_id.as_deref().is_none_or(str::is_empty))
    {
        return Some("无法确认 Hook 来源，当前仅供查看。".into());
    }
    let supported = match hook.handler_type.as_str() {
        "command" => hook.command.as_deref().is_some_and(|v| !v.is_empty()),
        "mcpTool" => {
            hook.server.as_deref().is_some_and(|v| !v.is_empty())
                && hook.tool.as_deref().is_some_and(|v| !v.is_empty())
        }
        _ => false,
    };
    if !supported {
        return Some("当前 CLI 未提供可管理的处理程序，当前仅供查看。".into());
    }
    if !config.states[&hook.key]["enabled"].is_null() {
        let origin = &config.origins[format!("hooks.state.{}.enabled", hook.key)];
        if origin["name"]["type"] != "user"
            || !origin["name"]["profile"].is_null()
            || !origin["name"]["file"]
                .as_str()
                .is_some_and(|p| same_path(p, &config.target))
        {
            return Some("启用设置的来源无法确认为当前用户配置，当前仅供查看。".into());
        }
    }
    None
}

fn write_enabled(
    home: &Path,
    config: &ConfigView,
    key: &str,
    enabled: bool,
) -> Result<Value, RpcError> {
    // Key::new quotes the entire native identity, including dots, paths and quotes.
    let key = toml_edit::Key::new(key).to_string();
    AppServer::start(home)?.request(
        "config/value/write",
        json!({
            "keyPath":format!("hooks.state.{key}.enabled"),
            "value":enabled,
            "mergeStrategy":"replace",
            "filePath":config.target,
            "expectedVersion":config.version,
        }),
    )
}

impl HooksState {
    pub(crate) fn scan(&self) -> Result<HookScan, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.scan_with(resolve_home(), &load)
    }

    fn scan_with(
        &self,
        home: Result<PathBuf, String>,
        read: &impl Fn(&Path) -> Result<Inventory, RpcError>,
    ) -> Result<HookScan, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Hooks 状态不可用，请重新打开应用")?;
        state.observation = None;
        state.sequence += 1;
        let mut scan = HookScan {
            snapshot_id: None,
            directory: String::new(),
            config_path: String::new(),
            status: ScanStatus::Failed,
            feature_enabled: None,
            hooks: Vec::new(),
            warnings: Vec::new(),
            config_error: None,
            message: None,
        };
        let home = match home {
            Ok(home) => home,
            Err(message) => {
                scan.message = Some(message);
                return Ok(scan);
            }
        };
        scan.directory = home.display().to_string();
        scan.config_path = home.join("config.toml").display().to_string();
        let inventory = match read(&home) {
            Ok(inventory) => inventory,
            Err(error) => {
                scan.status = match error.kind {
                    RpcErrorKind::MissingCli => ScanStatus::MissingCli,
                    RpcErrorKind::Incompatible => ScanStatus::Incompatible,
                    _ => ScanStatus::Failed,
                };
                scan.message = Some(error.message);
                return Ok(scan);
            }
        };
        scan.status = ScanStatus::Ready;
        scan.feature_enabled = inventory.feature_enabled;
        scan.warnings = inventory.warnings;
        scan.config_error = inventory.config.as_ref().err().cloned();
        if !inventory.errors.is_empty() {
            scan.message = Some(format!(
                "清单可能不完整，当前仅供查看。\n{}",
                inventory.errors.join("\n")
            ));
        }
        let global_reason = scan
            .config_error
            .clone()
            .or_else(|| scan.message.clone())
            .or_else(|| {
                (scan.feature_enabled != Some(true))
                    .then(|| "hooks 总开关未开启或状态未知，当前仅供查看。".into())
            });
        let mut observed = HashMap::new();
        for hook in inventory.hooks {
            let reason = global_reason.clone().or_else(|| {
                inventory
                    .config
                    .as_ref()
                    .ok()
                    .and_then(|config| read_only(&hook, config))
            });
            if reason.is_none() {
                observed.insert(hook.key.clone(), hook.clone());
            }
            scan.hooks.push(HookEntry {
                hook,
                read_only_reason: reason,
            });
        }
        if global_reason.is_none() {
            if let Ok(config) = inventory.config {
                let id = format!("hooks-{}", state.sequence);
                scan.snapshot_id = Some(id.clone());
                state.observation = Some(Observation {
                    id,
                    home,
                    config,
                    hooks: observed,
                });
            }
        }
        Ok(scan)
    }

    pub(crate) fn set_enabled(
        &self,
        request: HookChangeRequest,
    ) -> Result<HookChangeResult, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.set_enabled_with(request, resolve_home(), &load, &write_enabled)
    }

    fn set_enabled_with(
        &self,
        request: HookChangeRequest,
        home: Result<PathBuf, String>,
        read: &impl Fn(&Path) -> Result<Inventory, RpcError>,
        write: &impl Fn(&Path, &ConfigView, &str, bool) -> Result<Value, RpcError>,
    ) -> Result<HookChangeResult, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Hooks 状态不可用，请重新打开应用")?;
        let Some(observation) = state.observation.take() else {
            return Ok(HookChangeResult::conflict());
        };
        let home = match home {
            Ok(home) if home == observation.home && request.snapshot_id == observation.id => home,
            _ => return Ok(HookChangeResult::conflict()),
        };
        let Some(expected) = observation.hooks.get(&request.key) else {
            return Ok(HookChangeResult::conflict());
        };
        if expected.enabled == request.enabled {
            return Ok(HookChangeResult::conflict());
        }
        let latest = match read(&home) {
            Ok(latest) => latest,
            Err(error) => return Ok(HookChangeResult::new(ChangeStatus::Failed, error.message)),
        };
        let config = match latest.config {
            Ok(config) => config,
            Err(message) => return Ok(HookChangeResult::new(ChangeStatus::Failed, message)),
        };
        if config.target != observation.config.target
            || config.version != observation.config.version
            || latest.feature_enabled != Some(true)
            || !latest.errors.is_empty()
            || !latest
                .hooks
                .iter()
                .any(|hook| hook == expected && read_only(hook, &config).is_none())
        {
            return Ok(HookChangeResult::conflict());
        }
        Ok(match write(&home, &config, &request.key, request.enabled) {
            Ok(response) if matches!(response["status"].as_str(), Some("ok" | "okOverridden")) => {
                HookChangeResult::new(
                    ChangeStatus::Saved,
                    if response["status"] == "okOverridden"
                        || !response["overriddenMetadata"].is_null()
                    {
                        "配置已保存，但被更高优先级设置覆盖。请核对新清单，并在新会话中验证。"
                    } else {
                        "配置已保存，信任记录保持不变。请在新会话中验证，不代表正在运行的会话立即生效。"
                    },
                )
            }
            Ok(_) => HookChangeResult::new(
                ChangeStatus::Failed,
                "未能确认保存结果，请核对刷新后的配置，不要直接重复操作。",
            ),
            Err(error) => HookChangeResult::new(
                if error.kind == RpcErrorKind::Conflict {
                    ChangeStatus::Conflict
                } else {
                    ChangeStatus::Failed
                },
                format!("{} 请核对刷新后的配置。", error.message),
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::fs;

    fn hook() -> HookMetadata {
        serde_json::from_value(json!({
            "key":"/codex/hooks.json:stop:0:0", "currentHash":"hash-1",
            "eventName":"stop", "handlerType":"command", "command":"echo fixture",
            "source":"user", "sourcePath":"/codex/hooks.json", "pluginId":null,
            "enabled":true, "isManaged":false, "trustStatus":"trusted",
            "displayOrder":0, "timeoutSec":10
        }))
        .unwrap()
    }

    fn inventory() -> Inventory {
        Inventory {
            hooks: vec![hook()],
            warnings: vec![],
            errors: vec![],
            feature_enabled: Some(true),
            config: Ok(ConfigView {
                target: "/codex/config.toml".into(),
                version: "version-1".into(),
                states: Value::Null,
                origins: json!({}),
            }),
        }
    }

    fn approve(state: &HooksState) -> HookChangeRequest {
        let scan = state
            .scan_with(Ok("/codex".into()), &|_| Ok(inventory()))
            .unwrap();
        HookChangeRequest {
            snapshot_id: scan.snapshot_id.unwrap(),
            key: hook().key,
            enabled: false,
        }
    }

    #[test]
    fn native_inventory_keeps_distinct_definitions_and_filters_project_sources() {
        let first = hook();
        let mut second = hook();
        second.key += ":another";
        second.source = "plugin".into();
        second.plugin_id = Some("fixture@market".into());
        second.enabled = false;
        let mut project = hook();
        project.key += ":project";
        project.source = "project".into();
        let (hooks, warnings, errors) = parse_inventory(json!({"data":[{
            "cwd":"/", "hooks":[first, second, project], "warnings":["two formats"],
            "errors":[{"path":"/bad/hooks.json","message":"invalid"}]
        }]}))
        .unwrap();
        assert_eq!(hooks.len(), 2);
        assert!(!hooks[1].enabled);
        assert_eq!(warnings, vec!["two formats"]);
        assert_eq!(errors, vec!["/bad/hooks.json：invalid"]);
        for value in [
            json!({}),
            json!({"data":[]}),
            json!({"data":[{"cwd":"/project","hooks":[],"warnings":[],"errors":[]}]}),
            json!({"data":[{"cwd":"/","hooks":[hook(),hook()],"warnings":[],"errors":[]}]}),
        ] {
            assert_eq!(
                parse_inventory(value).unwrap_err().kind,
                RpcErrorKind::Incompatible
            );
        }
    }

    #[test]
    fn trust_management_source_and_handler_restrictions_are_enforced_by_backend() {
        let config = inventory().config.unwrap();
        for trust in ["untrusted", "modified", "managed", "future-state"] {
            let mut item = hook();
            item.trust_status = trust.into();
            assert!(read_only(&item, &config).is_some());
        }
        for change in 0..5 {
            let mut item = hook();
            match change {
                0 => item.is_managed = true,
                1 => item.source = "unknown".into(),
                2 => item.source = "plugin".into(),
                3 => item.handler_type = "prompt".into(),
                _ => item.command = None,
            }
            assert!(read_only(&item, &config).is_some());
        }
        let mut item = hook();
        item.handler_type = "mcpTool".into();
        item.server = Some("fixture".into());
        item.tool = Some("notify".into());
        assert!(read_only(&item, &config).is_none());
        let mut config = config;
        config.states = json!({item.key.clone():{"enabled":true}});
        assert!(read_only(&item, &config).is_some());
        config.origins = json!({format!("hooks.state.{}.enabled",item.key):{
            "name":{"type":"system","file":"/etc/config.toml"}
        }});
        assert!(read_only(&item, &config).is_some());
    }

    #[test]
    fn incomplete_or_unverifiable_scans_never_grant_write_approval() {
        for change in 0..4 {
            let mut data = inventory();
            match change {
                0 => data.feature_enabled = Some(false),
                1 => data.feature_enabled = None,
                2 => data.errors.push("bad definition".into()),
                _ => data.config = Err("invalid config".into()),
            }
            let state = HooksState::default();
            let data = std::cell::RefCell::new(Some(data));
            let scan = state
                .scan_with(Ok("/codex".into()), &|_| {
                    Ok(data.borrow_mut().take().unwrap())
                })
                .unwrap();
            assert_eq!(scan.status, ScanStatus::Ready);
            assert!(scan.snapshot_id.is_none());
            assert_eq!(scan.hooks.len(), 1);
            assert!(scan.hooks[0].read_only_reason.is_some());
        }
    }

    #[test]
    fn definition_state_config_home_and_snapshot_changes_never_write() {
        for change in 0..12 {
            let state = HooksState::default();
            let mut request = approve(&state);
            let mut home = PathBuf::from("/codex");
            if change == 8 {
                request.snapshot_id = "stale".into();
            }
            if change == 9 {
                request.key = "not-observed".into();
            }
            if change == 10 {
                home = "/other-home".into();
            }
            let read = |_: &Path| {
                let mut data = inventory();
                match change {
                    0 => data.hooks[0].current_hash = "modified".into(),
                    1 => data.hooks[0].enabled = false,
                    2 => data.hooks[0].trust_status = "modified".into(),
                    3 => data.hooks[0].source_path = "/changed".into(),
                    4 => data.config.as_mut().unwrap().version = "new-version".into(),
                    5 => data.config.as_mut().unwrap().target = "/other/config.toml".into(),
                    6 => data.feature_enabled = Some(false),
                    7 => data.hooks.clear(),
                    11 => data.errors.push("definition read failed".into()),
                    _ => {}
                }
                Ok(data)
            };
            let result = state
                .set_enabled_with(request, Ok(home), &read, &|_, _, _, _| {
                    panic!("must not write after change {change}")
                })
                .unwrap();
            assert_eq!(result.status, ChangeStatus::Conflict);
        }
    }

    #[test]
    fn writes_only_the_approved_target_once_and_reports_native_conflicts() {
        for conflict in [false, true] {
            let state = HooksState::default();
            let request = approve(&state);
            let old = HookChangeRequest {
                snapshot_id: request.snapshot_id.clone(),
                key: request.key.clone(),
                enabled: false,
            };
            let calls = Cell::new(0);
            let write = |home: &Path, config: &ConfigView, key: &str, enabled: bool| {
                calls.set(calls.get() + 1);
                assert_eq!(home, Path::new("/codex"));
                assert_eq!(config.version, "version-1");
                assert_eq!(key, hook().key);
                assert!(!enabled);
                if conflict {
                    Err(RpcError {
                        kind: RpcErrorKind::Conflict,
                        message: "changed".into(),
                    })
                } else {
                    Ok(json!({"status":"ok"}))
                }
            };
            let result = state
                .set_enabled_with(request, Ok("/codex".into()), &|_| Ok(inventory()), &write)
                .unwrap();
            assert_eq!(
                result.status,
                if conflict {
                    ChangeStatus::Conflict
                } else {
                    ChangeStatus::Saved
                }
            );
            assert_eq!(
                state
                    .set_enabled_with(old, Ok("/codex".into()), &|_| Ok(inventory()), &write)
                    .unwrap()
                    .status,
                ChangeStatus::Conflict
            );
            assert_eq!(calls.get(), 1);
        }
    }

    #[test]
    fn failed_scan_invalidates_previous_approval_and_preserves_failure_category() {
        for (kind, expected) in [
            (RpcErrorKind::MissingCli, ScanStatus::MissingCli),
            (RpcErrorKind::Incompatible, ScanStatus::Incompatible),
            (RpcErrorKind::Failed, ScanStatus::Failed),
        ] {
            let state = HooksState::default();
            let request = approve(&state);
            let error = std::cell::RefCell::new(Some(RpcError {
                kind,
                message: "failure".into(),
            }));
            let scan = state
                .scan_with(Ok("/codex".into()), &|_| {
                    Err(error.borrow_mut().take().unwrap())
                })
                .unwrap();
            assert_eq!(scan.status, expected);
            assert!(scan.snapshot_id.is_none());
            assert_eq!(
                state
                    .set_enabled_with(
                        request,
                        Ok("/codex".into()),
                        &|_| Ok(inventory()),
                        &|_, _, _, _| panic!("invalidated approval")
                    )
                    .unwrap()
                    .status,
                ChangeStatus::Conflict
            );
        }
    }

    #[test]
    #[ignore = "requires Codex CLI; only reads/writes isolated temporary fixtures, never starts a thread or executes hooks"]
    fn real_cli_hooks_user_and_plugin_lifecycle() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("codex.test");
        fs::create_dir_all(&home).unwrap();
        let home = fs::canonicalize(home).unwrap();
        let config_path = home.join("config.toml");
        fs::write(&config_path, "# retained comment\nmodel_reasoning_effort = 'low'\n[features]\nhooks = true\n[plugins.'fixture-plugin@fixture-market']\nenabled = true\n").unwrap();
        let sentinel = home.join("must-not-execute");
        let definition = json!({"hooks":{"SessionStart":[{"hooks":[{
            "type":"command", "command":format!("/usr/bin/touch '{}'",sentinel.display()), "timeout":5
        }]}]}});
        fs::write(home.join("hooks.json"), definition.to_string()).unwrap();
        let plugin = home.join("plugins/cache/fixture-market/fixture-plugin/local");
        fs::create_dir_all(plugin.join(".codex-plugin")).unwrap();
        fs::create_dir_all(plugin.join("hooks")).unwrap();
        fs::write(
            plugin.join(".codex-plugin/plugin.json"),
            json!({
                "name":"fixture-plugin", "category":"Productivity", "hooks":"./hooks/hooks.json"
            })
            .to_string(),
        )
        .unwrap();
        fs::write(plugin.join("hooks/hooks.json"), definition.to_string()).unwrap();

        let before = load(&home).unwrap();
        assert_eq!(before.feature_enabled, Some(true), "{:?}", before.errors);
        assert_eq!(before.hooks.len(), 2);
        assert!(before.hooks.iter().any(|hook| hook.source == "plugin"));
        assert!(before
            .hooks
            .iter()
            .all(|hook| hook.trust_status == "untrusted"));
        let mut doc = read_config(&config_path).unwrap().document;
        // Seed existing trust only in the test fixture; the application never grants it.
        for hook in &before.hooks {
            doc["hooks"]["state"][&hook.key]["trusted_hash"] = toml_edit::value(&hook.current_hash);
        }
        doc["hooks"]["state"]["unrelated"]["enabled"] = toml_edit::value(false);
        fs::write(&config_path, doc.to_string()).unwrap();
        let original_user_definition = fs::read(home.join("hooks.json")).unwrap();
        let original_plugin_definition = fs::read(plugin.join("hooks/hooks.json")).unwrap();
        let state = HooksState::default();
        for hook in &before.hooks {
            for enabled in [false, true] {
                let scan = state.scan_with(Ok(home.clone()), &load).unwrap();
                let entry = scan
                    .hooks
                    .iter()
                    .find(|entry| entry.hook.key == hook.key)
                    .unwrap();
                assert!(
                    entry.read_only_reason.is_none(),
                    "{:?}",
                    entry.read_only_reason
                );
                let result = state
                    .set_enabled_with(
                        HookChangeRequest {
                            snapshot_id: scan.snapshot_id.unwrap(),
                            key: hook.key.clone(),
                            enabled,
                        },
                        Ok(home.clone()),
                        &load,
                        &write_enabled,
                    )
                    .unwrap();
                assert_eq!(result.status, ChangeStatus::Saved, "{}", result.message);
                let latest = load(&home).unwrap();
                let actual = latest
                    .hooks
                    .iter()
                    .find(|actual| actual.key == hook.key)
                    .unwrap();
                assert_eq!(actual.enabled, enabled);
                assert_eq!(actual.trust_status, "trusted");
                let saved = read_config(&config_path).unwrap().document;
                assert_eq!(
                    saved["hooks"]["state"][&hook.key]["trusted_hash"].as_str(),
                    Some(hook.current_hash.as_str())
                );
                assert_eq!(
                    saved["hooks"]["state"]["unrelated"]["enabled"].as_bool(),
                    Some(false)
                );
                assert_eq!(
                    saved["plugins"]["fixture-plugin@fixture-market"]["enabled"].as_bool(),
                    Some(true)
                );
                assert!(fs::read_to_string(&config_path)
                    .unwrap()
                    .starts_with("# retained comment"));
            }
        }
        let old_config = load(&home)
            .unwrap()
            .config
            .unwrap_or_else(|e| panic!("{e}"));
        let mut doc = read_config(&config_path).unwrap().document;
        doc["model_reasoning_effort"] = toml_edit::value("high");
        fs::write(&config_path, doc.to_string()).unwrap();
        let externally_changed = fs::read(&config_path).unwrap();
        assert_eq!(
            write_enabled(&home, &old_config, &before.hooks[0].key, false)
                .unwrap_err()
                .kind,
            RpcErrorKind::Conflict
        );
        assert_eq!(fs::read(&config_path).unwrap(), externally_changed);
        doc["plugins"]["fixture-plugin@fixture-market"]["enabled"] = toml_edit::value(false);
        fs::write(&config_path, doc.to_string()).unwrap();
        assert!(load(&home)
            .unwrap()
            .hooks
            .iter()
            .all(|hook| hook.source == "user"));
        doc["features"]["hooks"] = toml_edit::value(false);
        fs::write(&config_path, doc.to_string()).unwrap();
        let off = load(&home).unwrap();
        assert_eq!(off.feature_enabled, Some(false));
        assert!(off.hooks.is_empty());
        assert_eq!(
            fs::read(home.join("hooks.json")).unwrap(),
            original_user_definition
        );
        assert_eq!(
            fs::read(plugin.join("hooks/hooks.json")).unwrap(),
            original_plugin_definition
        );
        assert!(!sentinel.exists(), "management must never execute hooks");
    }
}
