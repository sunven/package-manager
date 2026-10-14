use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use toml_edit::{DocumentMut, Item, Table};

#[derive(Clone, Default)]
pub(crate) struct CodexPluginsState(Arc<Mutex<PluginState>>);

#[derive(Default)]
struct PluginState {
    sequence: u64,
    observation: Option<Observation>,
}

struct Observation {
    id: String,
    home: PathBuf,
    config_target: PathBuf,
    plugins: HashMap<String, (InstalledPlugin, Option<bool>)>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct InstalledPlugin {
    plugin_id: String,
    name: String,
    marketplace_name: String,
    installed: bool,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    source: JsonValue,
    #[serde(default)]
    marketplace_source: JsonValue,
    #[serde(default)]
    install_policy: JsonValue,
}

impl InstalledPlugin {
    fn editable(&self) -> bool {
        matches!(
            self.source["source"].as_str(),
            Some("local" | "git" | "npm")
        ) && matches!(
            self.marketplace_source["sourceType"].as_str(),
            Some("local" | "git")
        )
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) enum PluginScanStatus {
    Ready,
    MissingCli,
    Incompatible,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginScan {
    snapshot_id: Option<String>,
    directory: String,
    config_path: String,
    status: PluginScanStatus,
    plugins: Vec<PluginEntry>,
    message: Option<String>,
    config_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginEntry {
    plugin_id: String,
    name: String,
    marketplace_name: String,
    version: Option<String>,
    default_enabled: Option<bool>,
    source_kind: Option<String>,
    source_location: Option<String>,
    marketplace_location: Option<String>,
    read_only_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginChangeRequest {
    snapshot_id: String,
    plugin_id: String,
    enabled: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) enum PluginChangeStatus {
    Saved,
    Conflict,
    Failed,
}

#[derive(Debug, Serialize)]
pub(crate) struct PluginChangeResult {
    status: PluginChangeStatus,
    message: String,
}

impl PluginChangeResult {
    fn new(status: PluginChangeStatus, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

#[derive(Debug)]
struct ListFailure {
    status: PluginScanStatus,
    message: String,
}

impl CodexPluginsState {
    pub(crate) fn scan(&self) -> Result<PluginScan, String> {
        let _operation = crate::codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.scan_with(resolve_home(), &list_installed)
    }

    fn scan_with(
        &self,
        home: Result<PathBuf, String>,
        list: &impl Fn(&Path) -> Result<Vec<InstalledPlugin>, ListFailure>,
    ) -> Result<PluginScan, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "插件状态不可用，请重新打开应用")?;
        state.observation = None;
        state.sequence += 1;
        let mut scan = PluginScan {
            snapshot_id: None,
            directory: String::new(),
            config_path: String::new(),
            status: PluginScanStatus::Failed,
            plugins: Vec::new(),
            message: None,
            config_error: None,
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
        let config = read_config(&home.join("config.toml"));
        scan.config_error = config.as_ref().err().cloned();
        let plugins = match list(&home) {
            Ok(plugins) => plugins,
            Err(failure) => {
                scan.status = failure.status;
                scan.message = Some(failure.message);
                return Ok(scan);
            }
        };
        let mut observed = HashMap::new();
        for plugin in plugins {
            let enabled = config
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|config| default_enabled(&config.document, &plugin.plugin_id));
            let read_only_reason = enabled.as_ref().err().cloned().or_else(|| {
                (!plugin.editable()).then(|| "无法确认是可管理的本地插件来源，仅供查看。".into())
            });
            let default_enabled = enabled.unwrap_or(None);
            if read_only_reason.is_none() {
                observed.insert(plugin.plugin_id.clone(), (plugin.clone(), default_enabled));
            }
            let source_location = ["path", "url", "repo", "package"]
                .iter()
                .find_map(|key| plugin.source[*key].as_str())
                .map(str::to_owned);
            scan.plugins.push(PluginEntry {
                source_kind: plugin.source["source"].as_str().map(str::to_owned),
                source_location,
                marketplace_location: plugin.marketplace_source["source"]
                    .as_str()
                    .map(str::to_owned),
                plugin_id: plugin.plugin_id,
                name: plugin.name,
                marketplace_name: plugin.marketplace_name,
                version: plugin.version,
                default_enabled,
                read_only_reason,
            });
        }
        scan.plugins
            .sort_by(|a, b| (&a.name, &a.marketplace_name).cmp(&(&b.name, &b.marketplace_name)));
        scan.status = PluginScanStatus::Ready;
        if let Ok(config) = config {
            let id = state.sequence.to_string();
            state.observation = Some(Observation {
                id: id.clone(),
                home,
                config_target: config.target,
                plugins: observed,
            });
            scan.snapshot_id = Some(id);
        }
        Ok(scan)
    }

    pub(crate) fn set_enabled(
        &self,
        request: PluginChangeRequest,
    ) -> Result<PluginChangeResult, String> {
        let _operation = crate::codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.set_enabled_with(request, resolve_home(), &list_installed)
    }

    fn set_enabled_with(
        &self,
        request: PluginChangeRequest,
        current_home: Result<PathBuf, String>,
        list: &impl Fn(&Path) -> Result<Vec<InstalledPlugin>, ListFailure>,
    ) -> Result<PluginChangeResult, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "插件状态不可用，请重新打开应用")?;
        let Some(observation) = state.observation.take() else {
            return Ok(PluginChangeResult::new(
                PluginChangeStatus::Conflict,
                "插件清单已失效，请刷新并重新确认。",
            ));
        };
        if observation.id != request.snapshot_id
            || current_home.as_ref().ok() != Some(&observation.home)
        {
            return Ok(PluginChangeResult::new(
                PluginChangeStatus::Conflict,
                "插件清单或 Codex 目录已改变，请刷新并重新确认。",
            ));
        }
        let Some((expected_plugin, expected_enabled)) = observation.plugins.get(&request.plugin_id)
        else {
            return Ok(PluginChangeResult::new(
                PluginChangeStatus::Conflict,
                "该插件不在可修改的清单中，请刷新后核对。",
            ));
        };
        let installed = match list(&observation.home) {
            Ok(installed) => installed,
            Err(failure) => {
                return Ok(PluginChangeResult::new(
                    PluginChangeStatus::Failed,
                    failure.message,
                ))
            }
        };
        if installed
            .iter()
            .find(|plugin| plugin.plugin_id == request.plugin_id)
            != Some(expected_plugin)
        {
            return Ok(PluginChangeResult::new(
                PluginChangeStatus::Conflict,
                "插件已移除或安装信息已改变，请刷新并重新确认。",
            ));
        }
        let config_path = observation.home.join("config.toml");
        let mut config = match read_config(&config_path) {
            Ok(config) => config,
            Err(message) => {
                return Ok(PluginChangeResult::new(PluginChangeStatus::Failed, message))
            }
        };
        let actual_enabled = match default_enabled(&config.document, &request.plugin_id) {
            Ok(enabled) => enabled,
            Err(message) => {
                return Ok(PluginChangeResult::new(PluginChangeStatus::Failed, message))
            }
        };
        if config.target != observation.config_target || actual_enabled != *expected_enabled {
            return Ok(PluginChangeResult::new(
                PluginChangeStatus::Conflict,
                "用户默认设置已被外部修改，请刷新并重新确认。",
            ));
        }
        if let Err(message) =
            edit_enabled(&mut config.document, &request.plugin_id, request.enabled)
        {
            return Ok(PluginChangeResult::new(PluginChangeStatus::Failed, message));
        }
        Ok(match persist_config(&config_path, config) {
            Ok(()) => PluginChangeResult::new(
                PluginChangeStatus::Saved,
                "配置已保存。请在新会话中验证；项目设置可能覆盖用户默认值。",
            ),
            Err(result) => result,
        })
    }
}

pub(crate) fn resolve_home() -> Result<PathBuf, String> {
    let home = match std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(std::env::var_os("HOME").ok_or("无法确定当前用户的主目录")?)
            .join(".codex"),
    };
    if !home.is_absolute() {
        return Err("Codex 目录必须是绝对路径，请检查 CODEX_HOME。".into());
    }
    // Resolve the home once so a changed symlink cannot redirect an approved operation.
    match fs::canonicalize(&home) {
        Ok(home) => Ok(home),
        // A fresh installation may not have created this directory yet. Still
        // probe the CLI, so missing CLI and a successful empty list stay distinct.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(home),
        Err(error) => Err(format!("无法访问 Codex 目录 {}：{error}", home.display())),
    }
}

fn parse_inventory(stdout: &str) -> Result<Vec<InstalledPlugin>, ListFailure> {
    #[derive(Deserialize)]
    struct Inventory {
        installed: Vec<InstalledPlugin>,
    }
    let failure = || ListFailure {
        status: PluginScanStatus::Incompatible,
        message: "Codex CLI 返回的插件清单格式不兼容，请更新 CLI 后刷新。".into(),
    };
    let inventory: Inventory = serde_json::from_str(stdout).map_err(|_| failure())?;
    let mut ids = HashSet::new();
    for plugin in &inventory.installed {
        if !plugin.installed
            || plugin.name.is_empty()
            || plugin.marketplace_name.is_empty()
            || plugin.plugin_id != format!("{}@{}", plugin.name, plugin.marketplace_name)
            || !ids.insert(&plugin.plugin_id)
        {
            return Err(failure());
        }
    }
    Ok(inventory.installed)
}

fn list_installed(home: &Path) -> Result<Vec<InstalledPlugin>, ListFailure> {
    let fail = |message: String| ListFailure {
        status: PluginScanStatus::Failed,
        message,
    };
    // Files drain both streams while waiting, including inventories larger than a pipe buffer.
    let mut stdout =
        tempfile::tempfile().map_err(|error| fail(format!("无法准备插件清单读取：{error}")))?;
    let mut stderr =
        tempfile::tempfile().map_err(|error| fail(format!("无法准备插件清单读取：{error}")))?;
    let mut child = Command::new("codex")
        .args(["plugin", "list", "--json"])
        .current_dir("/")
        .env("CODEX_HOME", home)
        .stdin(Stdio::null())
        .stdout(
            stdout
                .try_clone()
                .map_err(|error| fail(error.to_string()))?,
        )
        .stderr(
            stderr
                .try_clone()
                .map_err(|error| fail(error.to_string()))?,
        )
        .spawn()
        .map_err(|error| ListFailure {
            status: if error.kind() == std::io::ErrorKind::NotFound {
                PluginScanStatus::MissingCli
            } else {
                PluginScanStatus::Failed
            },
            message: if error.kind() == std::io::ErrorKind::NotFound {
                "未找到 Codex CLI。请安装支持插件清单的 CLI，并确保应用的 PATH 可以找到 codex。"
                    .into()
            } else {
                format!("无法运行 Codex CLI：{error}")
            },
        })?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < Duration::from_secs(15) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(fail(match result {
                    Err(error) => format!("无法等待 Codex CLI：{error}"),
                    _ => "读取插件清单超时，请稍后刷新。".into(),
                }));
            }
        }
    };
    let mut output = String::new();
    stdout
        .seek(SeekFrom::Start(0))
        .and_then(|_| stdout.read_to_string(&mut output))
        .map_err(|error| fail(format!("无法读取插件清单：{error}")))?;
    if status.success() {
        return parse_inventory(&output);
    }
    let mut diagnostic = String::new();
    stderr
        .seek(SeekFrom::Start(0))
        .and_then(|_| stderr.read_to_string(&mut diagnostic))
        .map_err(|error| fail(error.to_string()))?;
    let incompatible = diagnostic.contains("unrecognized subcommand")
        || diagnostic.contains("unexpected argument");
    Err(ListFailure {
        status: if incompatible {
            PluginScanStatus::Incompatible
        } else {
            PluginScanStatus::Failed
        },
        message: if incompatible {
            "当前 Codex CLI 不支持插件清单，请更新 CLI 后刷新。".into()
        } else {
            format!("Codex CLI 读取插件清单失败（退出码 {}）。请检查用户配置，并在终端运行 codex plugin list --json 核对。", status.code().map(|code| code.to_string()).unwrap_or_else(|| "未知".into()))
        },
    })
}

pub(crate) struct ConfigFile {
    pub(crate) target: PathBuf,
    original: Option<String>,
    permissions: Option<fs::Permissions>,
    pub(crate) document: DocumentMut,
}

pub(crate) fn read_config(path: &Path) -> Result<ConfigFile, String> {
    let target = match fs::canonicalize(path) {
        Ok(target) => target,
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                && fs::symlink_metadata(path).is_err() =>
        {
            path.to_path_buf()
        }
        Err(error) => return Err(format!("无法访问用户配置：{error}")),
    };
    let original = match fs::read_to_string(&target) {
        Ok(content) => Some(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("无法读取用户配置：{error}")),
    };
    let document = original
        .as_deref()
        .unwrap_or("")
        .parse::<DocumentMut>()
        .map_err(|_| "无法解析用户配置，请检查 config.toml 的 TOML 语法后刷新。".to_string())?;
    let permissions = if original.is_some() {
        Some(
            fs::metadata(&target)
                .map_err(|error| format!("无法读取配置权限：{error}"))?
                .permissions(),
        )
    } else {
        None
    };
    Ok(ConfigFile {
        target,
        original,
        permissions,
        document,
    })
}

fn default_enabled(document: &DocumentMut, id: &str) -> Result<Option<bool>, String> {
    let invalid = || "插件启用配置格式无效，请检查 plugins 下的 enabled 是否为布尔值。".to_string();
    let Some(plugins) = document.get("plugins") else {
        return Ok(None);
    };
    let plugins = plugins.as_table_like().ok_or_else(invalid)?;
    let Some(plugin) = plugins.get(id) else {
        return Ok(None);
    };
    let plugin = plugin.as_table_like().ok_or_else(invalid)?;
    plugin
        .get("enabled")
        .map(|item| item.as_bool().ok_or_else(invalid))
        .transpose()
}

fn edit_enabled(document: &mut DocumentMut, id: &str, enabled: bool) -> Result<(), String> {
    default_enabled(document, id)?;
    let plugins = document
        .entry("plugins")
        .or_insert(Item::Table(Table::new()))
        .as_table_like_mut()
        .ok_or("插件配置格式无效")?;
    let plugin = plugins
        .entry(id)
        .or_insert(Item::Table(Table::new()))
        .as_table_like_mut()
        .ok_or("插件配置格式无效")?;
    let mut value = toml_edit::Value::from(enabled);
    if let Some(previous) = plugin.get("enabled").and_then(Item::as_value) {
        *value.decor_mut() = previous.decor().clone();
    }
    plugin.insert("enabled", Item::Value(value));
    Ok(())
}

fn persist_config(path: &Path, config: ConfigFile) -> Result<(), PluginChangeResult> {
    let failed = |message: String| PluginChangeResult::new(PluginChangeStatus::Failed, message);
    let parent = config
        .target
        .parent()
        .ok_or_else(|| failed("无法确定配置目录。".into()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| failed(format!("无法准备配置保存：{error}")))?;
    if let Some(permissions) = config.permissions {
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| failed(format!("无法保留配置权限：{error}")))?;
    }
    temporary
        .write_all(config.document.to_string().as_bytes())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| failed(format!("配置写入失败：{error}")))?;
    let latest = read_config(path).map_err(failed)?;
    if latest.target != config.target || latest.original != config.original {
        return Err(PluginChangeResult::new(
            PluginChangeStatus::Conflict,
            "保存前检测到配置发生变化，请刷新并重新确认。",
        ));
    }
    temporary
        .persist(&config.target)
        .map_err(|error| failed(format!("配置保存失败：{}", error.error)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn inventory() -> Vec<InstalledPlugin> {
        parse_inventory(&json!({"installed": [
            {"pluginId":"writer@personal", "name":"writer", "marketplaceName":"personal", "installed":true,
             "enabled":true, "version":"1.0", "source":{"source":"local", "path":"/plugins/writer"},
             "marketplaceSource":{"sourceType":"git", "source":"https://example.com/catalog"}},
            {"pluginId":"writer@other", "name":"writer", "marketplaceName":"other", "installed":true,
             "enabled":false, "source":{"source":"git", "url":"https://example.com/writer"},
             "marketplaceSource":{"sourceType":"local", "source":"/catalog"}}
        ]}).to_string()).unwrap()
    }

    fn fixture(content: &str) -> (tempfile::TempDir, PathBuf, CodexPluginsState) {
        let directory = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(directory.path()).unwrap();
        fs::write(home.join("config.toml"), content).unwrap();
        (directory, home, CodexPluginsState::default())
    }

    fn scan(state: &CodexPluginsState, home: &Path) -> PluginScan {
        state
            .scan_with(Ok(home.to_path_buf()), &|_| Ok(inventory()))
            .unwrap()
    }

    fn request(scan: &PluginScan, enabled: bool) -> PluginChangeRequest {
        PluginChangeRequest {
            snapshot_id: scan.snapshot_id.clone().unwrap(),
            plugin_id: "writer@personal".into(),
            enabled,
        }
    }

    #[test]
    fn reads_user_defaults_separately_from_cli_effective_values_and_same_name_plugins() {
        let (_directory, home, state) = fixture("[plugins.\"writer@personal\"]\nenabled = false\n");
        let scan = scan(&state, &home);
        assert_eq!(scan.status, PluginScanStatus::Ready);
        assert_eq!(scan.plugins.len(), 2);
        assert_eq!(
            scan.plugins
                .iter()
                .find(|p| p.marketplace_name == "personal")
                .unwrap()
                .default_enabled,
            Some(false)
        );
        assert_eq!(
            scan.plugins
                .iter()
                .find(|p| p.marketplace_name == "other")
                .unwrap()
                .default_enabled,
            None
        );
        assert!(scan.plugins.iter().all(|p| p.read_only_reason.is_none()));
    }

    #[test]
    fn saves_only_the_named_marketplace_and_preserves_comments_and_external_unrelated_edits() {
        let original = "# settings\nmodel = 'before'\n[plugins.\"writer@personal\"]\nenabled = true # keep me\ncustom = 'value'\n[plugins.\"writer@other\"]\nenabled = true\n";
        let (_directory, home, state) = fixture(original);
        let scan = scan(&state, &home);
        let updated = original.replace("'before'", "'external-change'");
        fs::write(home.join("config.toml"), &updated).unwrap();
        let result = state
            .set_enabled_with(
                request(&scan, false),
                Ok(home.clone()),
                &|_| Ok(inventory()),
            )
            .unwrap();
        assert_eq!(result.status, PluginChangeStatus::Saved);
        assert_eq!(
            fs::read_to_string(home.join("config.toml")).unwrap(),
            updated.replacen("enabled = true # keep me", "enabled = false # keep me", 1)
        );
    }

    #[test]
    fn missing_and_inline_entries_can_be_explicitly_set_without_replacing_other_values() {
        for original in [
            "model = 'test'\n",
            "plugins = { 'writer@personal' = { note = 'keep' }, other = { enabled = true } }\n",
        ] {
            let (_directory, home, state) = fixture(original);
            let before = scan(&state, &home);
            let result = state
                .set_enabled_with(request(&before, true), Ok(home.clone()), &|_| {
                    Ok(inventory())
                })
                .unwrap();
            assert_eq!(result.status, PluginChangeStatus::Saved);
            let after = read_config(&home.join("config.toml")).unwrap();
            assert_eq!(
                default_enabled(&after.document, "writer@personal").unwrap(),
                Some(true)
            );
            assert!(after
                .original
                .unwrap()
                .contains(if original.starts_with("model") {
                    "model = 'test'"
                } else {
                    "note = 'keep'"
                }));
        }
    }

    #[test]
    fn rejects_target_changes_since_confirmation() {
        let (_directory, home, state) = fixture("[plugins.\"writer@personal\"]\nenabled = true\n");
        let before = scan(&state, &home);
        let external = "[plugins.\"writer@personal\"]\nenabled = false\n";
        fs::write(home.join("config.toml"), external).unwrap();
        let result = state
            .set_enabled_with(request(&before, false), Ok(home.clone()), &|_| {
                Ok(inventory())
            })
            .unwrap();
        assert_eq!(result.status, PluginChangeStatus::Conflict);
        assert_eq!(
            fs::read_to_string(home.join("config.toml")).unwrap(),
            external
        );
    }

    #[test]
    fn rejects_removed_or_changed_installations() {
        for changed in [Vec::new(), {
            let mut items = inventory();
            items[0].version = Some("2.0".into());
            items
        }] {
            let (_directory, home, state) = fixture("");
            let before = scan(&state, &home);
            let result = state
                .set_enabled_with(request(&before, true), Ok(home.clone()), &|_| {
                    Ok(changed.clone())
                })
                .unwrap();
            assert_eq!(result.status, PluginChangeStatus::Conflict);
            assert_eq!(fs::read_to_string(home.join("config.toml")).unwrap(), "");
        }
    }

    #[test]
    fn stale_snapshot_unknown_identity_and_changed_home_cannot_write() {
        for scenario in ["snapshot", "identity", "home"] {
            let (_directory, home, state) = fixture("");
            let before = scan(&state, &home);
            let mut change = request(&before, true);
            let mut current_home = home.clone();
            match scenario {
                "snapshot" => {
                    scan(&state, &home);
                }
                "identity" => change.plugin_id = "not-observed@personal".into(),
                _ => current_home = home.join("another-home"),
            }
            let result = state
                .set_enabled_with(change, Ok(current_home), &|_| {
                    panic!("must not execute unapproved operation")
                })
                .unwrap();
            assert_eq!(result.status, PluginChangeStatus::Conflict);
            assert_eq!(fs::read_to_string(home.join("config.toml")).unwrap(), "");
        }
    }

    #[test]
    fn invalid_config_and_invalid_enabled_values_are_read_only() {
        for content in [
            "model = 'private-value'\n[broken",
            "plugins = 42",
            "[plugins.\"writer@personal\"]\nenabled = 'yes'",
        ] {
            let (_directory, home, state) = fixture(content);
            let before = scan(&state, &home);
            assert!(before
                .plugins
                .iter()
                .find(|p| p.marketplace_name == "personal")
                .unwrap()
                .read_only_reason
                .is_some());
            assert!(!serde_json::to_string(&before)
                .unwrap()
                .contains("private-value"));
            assert_eq!(
                fs::read_to_string(home.join("config.toml")).unwrap(),
                content
            );
        }
    }

    #[test]
    fn corruption_after_scan_is_never_overwritten() {
        let (_directory, home, state) = fixture("");
        let before = scan(&state, &home);
        fs::write(home.join("config.toml"), "[broken").unwrap();
        let result = state
            .set_enabled_with(request(&before, true), Ok(home.clone()), &|_| {
                Ok(inventory())
            })
            .unwrap();
        assert_eq!(result.status, PluginChangeStatus::Failed);
        assert_eq!(
            fs::read_to_string(home.join("config.toml")).unwrap(),
            "[broken"
        );
    }

    #[test]
    fn changes_during_persistence_are_not_overwritten() {
        let (_directory, home, _) = fixture("model = 'old'\n");
        let path = home.join("config.toml");
        let mut config = read_config(&path).unwrap();
        edit_enabled(&mut config.document, "writer@personal", true).unwrap();
        fs::write(&path, "model = 'new'\n").unwrap();
        assert_eq!(
            persist_config(&path, config).unwrap_err().status,
            PluginChangeStatus::Conflict
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "model = 'new'\n");
        assert_eq!(fs::read_dir(&home).unwrap().count(), 1);
    }

    #[test]
    fn failures_are_not_empty_inventory_and_invalidate_previous_approval() {
        let (_directory, home, state) = fixture("");
        let before = scan(&state, &home);
        let failed = state
            .scan_with(Ok(home.clone()), &|_| {
                Err(ListFailure {
                    status: PluginScanStatus::MissingCli,
                    message: "CLI missing".into(),
                })
            })
            .unwrap();
        assert_eq!(failed.status, PluginScanStatus::MissingCli);
        assert!(failed.snapshot_id.is_none());
        assert_eq!(
            state
                .set_enabled_with(
                    request(&before, true),
                    Ok(home.clone()),
                    &|_| unreachable!()
                )
                .unwrap()
                .status,
            PluginChangeStatus::Conflict
        );
        let empty = state.scan_with(Ok(home), &|_| Ok(vec![])).unwrap();
        assert_eq!(empty.status, PluginScanStatus::Ready);
        assert!(empty.plugins.is_empty());
    }

    #[test]
    fn unknown_or_workspace_sources_are_not_editable() {
        let (_directory, home, state) = fixture("");
        let mut items = inventory();
        items[0].marketplace_source = json!({"sourceType":"workspace"});
        let scan = state.scan_with(Ok(home), &|_| Ok(items.clone())).unwrap();
        assert!(scan
            .plugins
            .iter()
            .find(|p| p.marketplace_name == "personal")
            .unwrap()
            .read_only_reason
            .is_some());
    }

    #[test]
    fn incompatible_json_is_not_silently_treated_as_no_plugins() {
        for input in ["{}", "null", "not-json", "{\"installed\":[{}]}"] {
            assert_eq!(
                parse_inventory(input).unwrap_err().status,
                PluginScanStatus::Incompatible
            );
        }
        assert_eq!(parse_inventory(&json!({"installed": [{"pluginId":"x@y", "name":"other", "marketplaceName":"y", "installed":true}]}).to_string()).unwrap_err().status, PluginScanStatus::Incompatible);
    }

    #[cfg(unix)]
    #[test]
    fn preserves_symlinked_config_and_file_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (_directory, home, state) = fixture("# dotfiles\n");
        let target = home.join("dotfiles.toml");
        fs::rename(home.join("config.toml"), &target).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, home.join("config.toml")).unwrap();
        let before = scan(&state, &home);
        let result = state
            .set_enabled_with(request(&before, true), Ok(home.clone()), &|_| {
                Ok(inventory())
            })
            .unwrap();
        assert_eq!(result.status, PluginChangeStatus::Saved);
        assert!(fs::symlink_metadata(home.join("config.toml"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(fs::read_to_string(target).unwrap().contains("# dotfiles"));
    }

    #[test]
    #[ignore = "read-only smoke test requiring an installed Codex CLI"]
    fn reads_real_codex_inventory_without_changing_user_config() {
        let home = resolve_home().unwrap();
        let before = fs::read(home.join("config.toml")).unwrap();
        let scan = CodexPluginsState::default().scan().unwrap();
        assert_eq!(scan.status, PluginScanStatus::Ready, "{:?}", scan.message);
        assert_eq!(fs::read(home.join("config.toml")).unwrap(), before);
    }
}
