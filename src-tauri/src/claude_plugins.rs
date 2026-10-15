use crate::claude_cli::{self, Runner};
use crate::claude_documents::{local_path, Document};
use crate::claude_plugin_details::{self, Details};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Default)]
pub(crate) struct ExtensionsState(Arc<Mutex<State>>);
#[derive(Default)]
struct State {
    sequence: u64,
    observation: Option<Observation>,
}

struct Observation {
    id: String,
    home: PathBuf,
    version: String,
    settings: Document,
    known: Document,
    installations: Document,
    raw_markets: Value,
    raw_plugins: Value,
    catalogs: Vec<Document>,
    markets: Vec<Marketplace>,
    plugins: Vec<Plugin>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Marketplace {
    pub name: String,
    pub source_kind: String,
    pub source: Option<String>,
    pub root: Option<String>,
    pub ref_name: Option<String>,
    pub sparse_paths: Vec<String>,
    pub read_only_reason: Option<String>,
    pub remove_blocked_reason: Option<String>,
    pub affected_plugins: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Plugin {
    pub id: String,
    pub name: String,
    pub marketplace_name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub enabled: Option<bool>,
    pub user_enabled: Option<bool>,
    pub source: Option<String>,
    pub read_only_reason: Option<String>,
    pub details: Details,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionScan {
    snapshot_id: Option<String>,
    directory: String,
    version: Option<String>,
    status: String,
    message: Option<String>,
    write_blocked_reason: Option<String>,
    marketplaces: Vec<Marketplace>,
    plugins: Vec<Plugin>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) enum Operation {
    AddMarket,
    UpdateMarket,
    RemoveMarket,
    Install,
    Update,
    Uninstall,
    Enable,
    Disable,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeRequest {
    pub snapshot_id: String,
    pub operation: Operation,
    pub target: Option<String>,
    pub source: Option<String>,
    pub source_kind: Option<String>,
    pub ref_name: Option<String>,
    #[serde(default)]
    pub sparse_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeResult {
    pub status: String,
    pub message: String,
    pub executed: bool,
}
impl ChangeResult {
    pub(crate) fn new(status: &str, message: impl Into<String>, executed: bool) -> Self {
        Self {
            status: status.into(),
            message: message.into(),
            executed,
        }
    }
}

pub(crate) fn list(home: &Path, args: &[&str], runner: &Runner) -> Result<Value, String> {
    let output = runner(home, args, Duration::from_secs(30))?;
    if !output.success {
        return Err(claude_cli::diagnostic(&output));
    }
    claude_cli::json_output(&output)
}

pub(crate) fn installed(inventory: &Value) -> Result<&Vec<Value>, String> {
    let records = inventory
        .get("installed")
        .unwrap_or(inventory)
        .as_array()
        .ok_or("插件清单格式不兼容。")?;
    let mut identities = HashSet::new();
    for row in records {
        let id = row["id"].as_str().ok_or("插件身份缺失。")?;
        let scope = row["scope"].as_str().ok_or("插件作用域缺失。")?;
        let path = row["installPath"].as_str().ok_or("插件安装路径缺失。")?;
        if !valid_id(id)
            || !Path::new(path).is_absolute()
            || !row["enabled"].is_boolean()
            || !row["version"].as_str().is_some_and(|v| !v.is_empty())
            || !identities.insert((id, scope, row["projectPath"].as_str()))
        {
            return Err("插件清单包含不完整或重复的安装身份。".into());
        }
        if matches!(scope, "project" | "local")
            && !row["projectPath"]
                .as_str()
                .is_some_and(|p| Path::new(p).is_absolute())
        {
            return Err("项目安装缺少完整位置，不能判断操作范围。".into());
        }
    }
    Ok(records)
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.starts_with('-')
}
fn valid_id(id: &str) -> bool {
    id.split_once('@')
        .is_some_and(|(name, market)| valid_name(name) && valid_name(market))
}
pub(crate) fn market_id(id: &str) -> Option<(&str, &str)> {
    id.split_once('@')
        .filter(|(_, market)| !matches!(*market, "inline" | "synced" | "skills-dir"))
}

fn object_field<'a>(
    value: &'a Value,
    field: &str,
) -> Result<Option<&'a serde_json::Map<String, Value>>, String> {
    match value.get(field) {
        None => Ok(None),
        Some(v) => v
            .as_object()
            .map(Some)
            .ok_or_else(|| format!("用户配置 {field} 格式不兼容。")),
    }
}

fn owned_market(row: &Value, settings: &Value, known: &Value) -> bool {
    let Some(name) = row["name"].as_str() else {
        return false;
    };
    let declared = &settings["extraKnownMarketplaces"][name]["source"];
    let actual = &known[name]["source"];
    let kind = row["source"].as_str().unwrap_or("");
    if !declared.is_object() || declared != actual || actual["source"] != kind {
        return false;
    }
    let field = match kind {
        "github" => "repo",
        "git" | "url" => "url",
        "directory" | "file" => "path",
        _ => return false,
    };
    actual[field].is_string() && row[field] == actual[field] && row["ref"] == actual["ref"]
}

fn catalog_path(market: &Marketplace) -> Option<PathBuf> {
    let root = PathBuf::from(market.root.as_ref()?);
    Some(if root.is_file() {
        root
    } else {
        root.join(".claude-plugin/marketplace.json")
    })
}

fn load(home: PathBuf, runner: &Runner) -> Result<Observation, String> {
    let version = claude_cli::version(&home, runner)?;
    let raw_markets = list(&home, &["plugin", "marketplace", "list", "--json"], runner)?;
    let raw_plugins = list(&home, &["plugin", "list", "--json", "--available"], runner)?;
    let records = installed(&raw_plugins)?;
    let available = raw_plugins["available"]
        .as_array()
        .ok_or("CLI 未提供可安装插件清单。")?;
    let settings = Document::read(&home.join("settings.json"))?;
    object_field(&settings.value, "extraKnownMarketplaces")?;
    object_field(&settings.value, "enabledPlugins")?;
    let known = Document::read(&home.join("plugins/known_marketplaces.json"))?;
    let installations = Document::read(&home.join("plugins/installed_plugins.json"))?;
    let mut markets = vec![];
    let mut names = HashSet::new();
    for row in raw_markets.as_array().ok_or("市场清单格式不兼容。")? {
        let name = row["name"]
            .as_str()
            .filter(|name| valid_name(name))
            .ok_or("市场身份无效。")?;
        if !names.insert(name) {
            return Err("市场身份重复。".into());
        }
        let non_user = records.iter().any(|r| {
            market_id(r["id"].as_str().unwrap_or("")).is_some_and(|(_, m)| m == name)
                && r["scope"] != "user"
        });
        let owned = owned_market(row, &settings.value, &known.value);
        markets.push(Marketplace {
            name: name.into(),
            source_kind: row["source"].as_str().unwrap_or("unknown").into(),
            source: ["repo", "url", "path"]
                .iter()
                .find_map(|key| row[key].as_str().map(str::to_string)),
            root: row["installLocation"]
                .as_str()
                .filter(|p| Path::new(p).is_absolute())
                .map(str::to_string),
            ref_name: row["ref"].as_str().map(str::to_string),
            sparse_paths: known.value[name]["source"]["sparsePaths"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            read_only_reason: (!owned)
                .then(|| "托管或无法确认属于当前用户的市场，仅供查看。".into()),
            remove_blocked_reason: non_user
                .then(|| "此市场存在项目或其他作用域安装，移除可能连带卸载，已阻止。".into()),
            affected_plugins: records
                .iter()
                .filter(|r| {
                    r["scope"] == "user"
                        && market_id(r["id"].as_str().unwrap_or("")).is_some_and(|(_, m)| m == name)
                })
                .filter_map(|r| r["id"].as_str().map(str::to_string))
                .collect(),
        });
    }
    let mut catalog_entries = BTreeMap::new();
    let mut catalogs = vec![];
    for market in &markets {
        if let Some(path) = catalog_path(market) {
            if let Ok(doc) = Document::read(&path) {
                if doc.value["name"] == market.name {
                    if let Some(entries) = doc.value["plugins"].as_array() {
                        for entry in entries {
                            if let Some(name) = entry["name"].as_str().filter(|n| valid_name(n)) {
                                catalog_entries
                                    .insert(format!("{name}@{}", market.name), entry.clone());
                            }
                        }
                    }
                }
                catalogs.push(doc);
            }
        }
    }
    let mut identities = BTreeMap::<String, Value>::new();
    for entry in available {
        let id = entry["pluginId"]
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or("市场目录项身份不完整。")?;
        if market_id(id).is_some() {
            identities.insert(id.into(), entry.clone());
        }
    }
    for row in records {
        let id = row["id"].as_str().unwrap();
        if market_id(id).is_some() {
            identities.entry(id.into()).or_insert(Value::Null);
        }
    }
    let mut plugins = vec![];
    for (id, available) in identities {
        let (name, market_name) = market_id(&id).unwrap();
        let market = markets.iter().find(|m| m.name == market_name);
        let record = records
            .iter()
            .find(|r| r["id"] == id && r["scope"] == "user");
        let entry = catalog_entries.get(&id).unwrap_or(&available);
        let root = record
            .and_then(|r| {
                r["readFromFolder"]
                    .as_str()
                    .or_else(|| r["installPath"].as_str())
            })
            .map(PathBuf::from)
            .or_else(|| {
                let source = entry["source"].as_str()?;
                let catalog = catalog_path(market?)?;
                let root = catalog.parent()?.parent()?;
                local_path(root, source).ok().filter(|p| p.is_dir())
            });
        let mut details = if let Some(root) = root {
            claude_plugin_details::read(
                &root,
                if record.is_some() {
                    "installed"
                } else {
                    "source"
                },
            )
            .0
        } else {
            Details {
                messages: vec![
                    "未下载或无法读取本地内容，组件详情未知；不会为预览自动下载。".into(),
                ],
                ..Default::default()
            }
        };
        if details.description.is_none() {
            details.description = entry["description"].as_str().map(str::to_string);
        }
        let source = entry.get("source").map(|v| {
            v.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| v.to_string())
        });
        let read_only_reason = market
            .map(|m| m.read_only_reason.clone())
            .unwrap_or_else(|| Some("未匹配可见市场来源，暂时只读。".into()));
        plugins.push(Plugin {
            name: name.into(),
            marketplace_name: market_name.into(),
            installed: record.is_some(),
            version: record
                .and_then(|r| r["version"].as_str())
                .map(str::to_string),
            enabled: record.and_then(|r| r["enabled"].as_bool()),
            user_enabled: settings.value["enabledPlugins"][&id].as_bool(),
            source,
            read_only_reason,
            details,
            id,
        });
    }
    Ok(Observation {
        id: String::new(),
        home,
        version,
        settings,
        known,
        installations,
        raw_markets,
        raw_plugins,
        catalogs,
        markets,
        plugins,
    })
}

impl Observation {
    fn unchanged(&self, next: &Self) -> bool {
        self.home == next.home
            && self.version == next.version
            && self.raw_markets == next.raw_markets
            && self.raw_plugins == next.raw_plugins
            && self.markets == next.markets
            && self.plugins == next.plugins
            && self.settings.unchanged()
            && self.known.unchanged()
            && self.installations.unchanged()
            && self.catalogs.iter().all(Document::unchanged)
    }
}

impl ExtensionsState {
    pub(crate) fn scan(&self) -> Result<ExtensionScan, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.scan_with(claude_cli::resolve_home()?, &claude_cli::run)
    }

    fn scan_with(&self, home: PathBuf, runner: &Runner) -> Result<ExtensionScan, String> {
        let mut state = self.0.lock().map_err(|_| "Claude 状态不可用。")?;
        state.observation = None;
        match load(home.clone(), runner) {
            Ok(mut observation) => {
                state.sequence += 1;
                observation.id = format!("claude-extensions-{}", state.sequence);
                let scan = ExtensionScan {
                    snapshot_id: Some(observation.id.clone()),
                    directory: home.display().to_string(),
                    version: Some(observation.version.clone()),
                    status: "Ready".into(),
                    message: None,
                    write_blocked_reason: claude_cli::write_blocked(&observation.version),
                    marketplaces: observation.markets.clone(),
                    plugins: observation.plugins.clone(),
                };
                state.observation = Some(observation);
                Ok(scan)
            }
            Err(message) => Ok(ExtensionScan {
                snapshot_id: None,
                directory: home.display().to_string(),
                version: None,
                status: if message.starts_with("未找到 Claude") {
                    "MissingCli"
                } else {
                    "Failed"
                }
                .into(),
                message: Some(message.clone()),
                write_blocked_reason: Some(message),
                marketplaces: vec![],
                plugins: vec![],
            }),
        }
    }

    pub(crate) fn change(&self, request: ChangeRequest) -> Result<ChangeResult, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.change_with(request, claude_cli::resolve_home()?, &claude_cli::run)
    }

    fn change_with(
        &self,
        request: ChangeRequest,
        home: PathBuf,
        runner: &Runner,
    ) -> Result<ChangeResult, String> {
        let mut state = self.0.lock().map_err(|_| "Claude 状态不可用。")?;
        let previous = state
            .observation
            .take()
            .ok_or("清单已过期，请重新读取并确认。")?;
        if previous.id != request.snapshot_id || previous.home != home {
            return Ok(ChangeResult::new(
                "Conflict",
                "用户目录或清单已变化，请重新读取并确认。",
                false,
            ));
        }
        if let Some(reason) = claude_cli::write_blocked(&previous.version) {
            return Ok(ChangeResult::new("Failed", reason, false));
        }
        let next = load(home.clone(), runner)?;
        if !previous.unchanged(&next) {
            return Ok(ChangeResult::new(
                "Conflict",
                "来源、配置或安装清单已变化，请重新读取并确认。",
                false,
            ));
        }
        let args = arguments(&request, &next)?;
        let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let output = match runner(&home, &refs, Duration::from_secs(180)) {
            Ok(output) => output,
            Err(message) => return Ok(ChangeResult::new("Unconfirmed", message, true)),
        };
        let value = match claude_cli::json_output(&output) {
            Ok(value) => value,
            Err(e) => return Ok(ChangeResult::new("Unconfirmed", e, true)),
        };
        if !output.success || value["outcome"] != "ok" {
            return Ok(ChangeResult::new(
                "Failed",
                claude_cli::diagnostic(&output),
                true,
            ));
        }
        Ok(ChangeResult::new("Succeeded", "Claude CLI 操作已完成。正在重新读取；现有会话请在 Claude 中重新加载插件或开启新会话验证。", true))
    }
}

fn arguments(request: &ChangeRequest, snapshot: &Observation) -> Result<Vec<String>, String> {
    let mut args = vec!["plugin".into()];
    match request.operation {
        Operation::AddMarket => {
            let mut source = request.source.as_deref().unwrap_or("").trim().to_string();
            if source.is_empty() || source.starts_with('-') || source.chars().any(char::is_control)
            {
                return Err("请输入有效的市场来源。".into());
            }
            let kind = request.source_kind.as_deref().unwrap_or("");
            if !matches!(kind, "git" | "local" | "url") {
                return Err("不支持此市场来源类型。".into());
            }
            if kind == "local" {
                if !Path::new(&source).is_absolute() || !Path::new(&source).exists() {
                    return Err("请选择存在的本地目录或 JSON 文件，使用绝对路径。".into());
                }
            } else if source.starts_with("http://") || source.starts_with("https://") {
                let authority = source
                    .split("://")
                    .nth(1)
                    .unwrap_or("")
                    .split('/')
                    .next()
                    .unwrap_or("");
                if authority.is_empty() || authority.contains('@') {
                    return Err("来源 URL 不可包含凭据。".into());
                }
            } else if kind == "url"
                || !(source.split_once('/').is_some_and(|(a, b)| {
                    valid_name(a) && valid_name(b.split(['#', '@']).next().unwrap_or(""))
                }) || source.contains('@') && source.contains(':'))
            {
                return Err("请输入 GitHub 简写、Git URL 或远程 JSON URL。".into());
            }
            let reference = request.ref_name.as_deref().unwrap_or("").trim();
            if kind != "git" && (!reference.is_empty() || !request.sparse_paths.is_empty()) {
                return Err("仅 Git 来源支持 ref 和 sparse。".into());
            }
            if !reference.is_empty() {
                if source.contains('#')
                    || (!source.contains(':')
                        && source
                            .split_once('/')
                            .is_some_and(|(_, repo)| repo.contains('@')))
                    || reference
                        .chars()
                        .any(|c| c.is_whitespace() || c.is_control())
                    || reference.starts_with('-')
                {
                    return Err("分支／标签无效或与来源中的 ref 重复。".into());
                }
                source.push('#');
                source.push_str(reference);
            }
            args.extend([
                "marketplace".into(),
                "add".into(),
                source,
                "--scope".into(),
                "user".into(),
                "--json".into(),
            ]);
            if !request.sparse_paths.is_empty() {
                if request.sparse_paths.iter().any(|p| {
                    p.trim().is_empty()
                        || p.starts_with('-')
                        || Path::new(p).is_absolute()
                        || p.chars().any(char::is_control)
                        || Path::new(p)
                            .components()
                            .any(|c| matches!(c, std::path::Component::ParentDir))
                }) {
                    return Err("sparse 必须是仓库内相对路径。".into());
                }
                args.push("--sparse".into());
                args.extend(request.sparse_paths.clone());
            }
        }
        Operation::UpdateMarket | Operation::RemoveMarket => {
            let market = snapshot
                .markets
                .iter()
                .find(|m| Some(m.name.as_str()) == request.target.as_deref())
                .ok_or("市场已不在清单中。")?;
            if let Some(reason) = &market.read_only_reason {
                return Err(reason.clone());
            }
            if request.operation == Operation::RemoveMarket {
                if let Some(reason) = &market.remove_blocked_reason {
                    return Err(reason.clone());
                }
            }
            args.extend([
                "marketplace".into(),
                if request.operation == Operation::RemoveMarket {
                    "remove"
                } else {
                    "update"
                }
                .into(),
                market.name.clone(),
            ]);
            if request.operation == Operation::RemoveMarket {
                args.extend(["--scope".into(), "user".into()]);
            }
            args.push("--json".into());
        }
        _ => {
            let plugin = snapshot
                .plugins
                .iter()
                .find(|p| Some(p.id.as_str()) == request.target.as_deref())
                .ok_or("插件已不在清单中。")?;
            if let Some(reason) = &plugin.read_only_reason {
                return Err(reason.clone());
            }
            if (request.operation == Operation::Install) == plugin.installed {
                return Err("插件安装状态已变化，请重新读取。".into());
            }
            let operation = match request.operation {
                Operation::Install => "install",
                Operation::Update => "update",
                Operation::Uninstall => "uninstall",
                Operation::Enable => "enable",
                Operation::Disable => "disable",
                _ => unreachable!(),
            };
            args.extend([
                operation.into(),
                plugin.id.clone(),
                "--scope".into(),
                "user".into(),
                "--json".into(),
            ]);
        }
    }
    Ok(args)
}

#[cfg(test)]
#[path = "claude_plugin_tests.rs"]
mod tests;
