use crate::codex_cli::{self, Output};
use crate::codex_plugins::{read_config, resolve_home, PluginScanStatus};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Default)]
pub(crate) struct MarketplacesState(Arc<Mutex<State>>);

#[derive(Default)]
struct State {
    sequence: u64,
    observation: Option<Observation>,
}

struct Observation {
    id: String,
    home: PathBuf,
    config: ConfigView,
    markets: Vec<Market>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Market {
    name: String,
    root: String,
    #[serde(default)]
    marketplace_source: Value,
}

#[derive(Clone, Debug, PartialEq)]
struct ConfigView {
    target: PathBuf,
    sources: Map<String, Value>,
    owned: HashSet<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketplaceScan {
    snapshot_id: Option<String>,
    directory: String,
    config_path: String,
    status: PluginScanStatus,
    marketplaces: Vec<MarketplaceEntry>,
    message: Option<String>,
    config_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceEntry {
    id: String,
    name: String,
    root: String,
    source_kind: Option<String>,
    source: Option<String>,
    read_only_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub(crate) enum Operation {
    Add,
    Refresh,
    Remove,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketplaceRequest {
    snapshot_id: String,
    operation: Operation,
    #[serde(default)]
    marketplace_id: Option<String>,
    #[serde(default)]
    source_kind: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub(crate) enum ChangeStatus {
    Succeeded,
    AlreadyExists,
    Partial,
    Conflict,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketplaceResult {
    status: ChangeStatus,
    message: String,
    executed: bool,
}

impl MarketplaceResult {
    fn new(status: ChangeStatus, message: impl Into<String>, executed: bool) -> Self {
        Self {
            status,
            message: message.into(),
            executed,
        }
    }
    fn conflict() -> Self {
        Self::new(
            ChangeStatus::Conflict,
            "市场来源或 Codex 目录已变化，请重新读取并确认。",
            false,
        )
    }
}

fn same_path(a: &str, b: &Path) -> bool {
    std::fs::canonicalize(a).unwrap_or_else(|_| PathBuf::from(a))
        == std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf())
}

fn config_view(home: &Path, rpc: Value) -> Result<ConfigView, String> {
    let file = read_config(&home.join("config.toml"))?;
    let sources = rpc["config"]["marketplaces"]
        .as_object()
        .ok_or("CLI 未提供市场配置信息，市场暂时只读。")?
        .clone();
    let origins = rpc["origins"]
        .as_object()
        .ok_or("CLI 未提供配置来源，市场暂时只读。")?;
    let mut owned = HashSet::new();
    for (key, source) in &sources {
        let prefix = format!("marketplaces.{key}.");
        let is_user = |origin: &Value| {
            origin["name"]["type"] == "user"
                && origin["name"]["profile"].is_null()
                && origin["name"]["file"]
                    .as_str()
                    .is_some_and(|path| same_path(path, &file.target))
        };
        let explicit = file.document.get("marketplaces").and_then(|v| v.get(key));
        let source_matches = ["source", "source_type"].iter().all(|field| {
            source[*field].as_str().is_some()
                && explicit.and_then(|v| v.get(field)).and_then(|v| v.as_str())
                    == source[*field].as_str()
                && origins
                    .get(&format!("{prefix}{field}"))
                    .is_some_and(is_user)
        });
        let ref_matches =
            explicit.and_then(|v| v.get("ref")).and_then(|v| v.as_str()) == source["ref"].as_str();
        let explicit_sparse = explicit
            .and_then(|v| v.get("sparse_paths"))
            .and_then(|v| v.as_array())
            .map(|v| v.iter().map(|p| p.as_str()).collect::<Vec<_>>());
        let effective_sparse = source["sparse_paths"]
            .as_array()
            .map(|v| v.iter().map(Value::as_str).collect::<Vec<_>>());
        if source_matches
            && ref_matches
            && explicit_sparse == effective_sparse
            && origins
                .iter()
                .filter(|(field, _)| field.starts_with(&prefix))
                .all(|(_, origin)| is_user(origin))
        {
            owned.insert(key.clone());
        }
    }
    Ok(ConfigView {
        target: file.target,
        sources,
        owned,
    })
}

fn read_config_view(home: &Path) -> Result<ConfigView, String> {
    config_view(home, codex_cli::config(home)?)
}

fn read_only(market: &Market, config: &ConfigView) -> Option<String> {
    let kind = market.marketplace_source["sourceType"].as_str();
    let source = market.marketplace_source["source"].as_str();
    let configured = config.sources.get(&market.name);
    let matches = configured.is_some_and(|value| {
        value["source_type"].as_str() == kind
            && source.is_some_and(|source| {
                value["source"].as_str().is_some_and(|expected| {
                    if kind == Some("local") {
                        same_path(source, Path::new(expected))
                    } else {
                        source == expected
                    }
                })
            })
    });
    if !matches || !config.owned.contains(&market.name) || !matches!(kind, Some("local" | "git")) {
        Some("默认、受管理或无法确认属于当前用户配置的来源，仅供查看。".into())
    } else {
        None
    }
}

fn parse_markets(stdout: &str) -> Result<Vec<Market>, String> {
    #[derive(Deserialize)]
    struct Inventory {
        marketplaces: Vec<Market>,
    }
    let inventory: Inventory =
        serde_json::from_str(stdout).map_err(|_| "CLI 返回的市场清单格式不兼容。")?;
    let mut names = HashSet::new();
    for market in &inventory.marketplaces {
        if market.name.trim().is_empty()
            || !Path::new(&market.root).is_absolute()
            || !names.insert(market.name.clone())
        {
            return Err("CLI 返回了无法唯一识别的市场，请检查来源后重新读取。".into());
        }
    }
    Ok(inventory.marketplaces)
}

fn list(home: &Path) -> Result<Vec<Market>, String> {
    let output = codex_cli::run(
        home,
        &["plugin", "marketplace", "list", "--json"],
        Duration::from_secs(20),
    )?;
    if !output.success {
        return Err(codex_cli::diagnostic(&output.stderr));
    }
    parse_markets(&output.stdout)
}

fn check_capabilities(home: &Path) -> Result<(), String> {
    for operation in ["add", "upgrade", "remove"] {
        let output = codex_cli::run(
            home,
            &["plugin", "marketplace", operation, "--help"],
            Duration::from_secs(5),
        )?;
        if !output.success || !output.stdout.contains("--json") {
            return Err("当前 Codex CLI 不支持完整市场管理命令，请更新 CLI 后重新读取。".into());
        }
    }
    Ok(())
}

impl MarketplacesState {
    pub(crate) fn scan(&self) -> Result<MarketplaceScan, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.scan_with(resolve_home(), &list, &|home| {
            check_capabilities(home)?;
            read_config_view(home)
        })
    }

    fn scan_with(
        &self,
        home: Result<PathBuf, String>,
        list: &impl Fn(&Path) -> Result<Vec<Market>, String>,
        config: &impl Fn(&Path) -> Result<ConfigView, String>,
    ) -> Result<MarketplaceScan, String> {
        let mut state = self.0.lock().map_err(|_| "市场状态不可用")?;
        state.observation = None;
        state.sequence += 1;
        let mut scan = MarketplaceScan {
            snapshot_id: None,
            directory: String::new(),
            config_path: String::new(),
            status: PluginScanStatus::Failed,
            marketplaces: vec![],
            message: None,
            config_error: None,
        };
        let home = match home {
            Ok(home) => home,
            Err(error) => {
                scan.message = Some(error);
                return Ok(scan);
            }
        };
        scan.directory = home.display().to_string();
        scan.config_path = home.join("config.toml").display().to_string();
        let markets = match list(&home) {
            Ok(markets) => markets,
            Err(error) => {
                scan.status = if error.contains("未找到 Codex") {
                    PluginScanStatus::MissingCli
                } else if error.contains("不兼容") || error.contains("不支持") {
                    PluginScanStatus::Incompatible
                } else {
                    PluginScanStatus::Failed
                };
                scan.message = Some(error);
                return Ok(scan);
            }
        };
        let config = config(&home);
        scan.config_error = config.as_ref().err().cloned();
        scan.status = PluginScanStatus::Ready;
        scan.marketplaces = markets
            .iter()
            .map(|market| MarketplaceEntry {
                id: market.name.clone(),
                name: market.name.clone(),
                root: market.root.clone(),
                source_kind: market.marketplace_source["sourceType"]
                    .as_str()
                    .map(str::to_owned),
                source: market.marketplace_source["source"]
                    .as_str()
                    .map(str::to_owned),
                read_only_reason: match &config {
                    Ok(config) => read_only(market, config),
                    Err(error) => Some(error.clone()),
                },
            })
            .collect();
        scan.marketplaces.sort_by(|a, b| a.name.cmp(&b.name));
        if let Ok(config) = config {
            let id = state.sequence.to_string();
            scan.snapshot_id = Some(id.clone());
            state.observation = Some(Observation {
                id,
                home,
                config,
                markets,
            });
        }
        Ok(scan)
    }

    pub(crate) fn change(&self, request: MarketplaceRequest) -> Result<MarketplaceResult, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.change_with(
            request,
            resolve_home(),
            &list,
            &read_config_view,
            &|home, args| codex_cli::run(home, args, Duration::from_secs(120)),
        )
    }

    fn change_with(
        &self,
        request: MarketplaceRequest,
        current_home: Result<PathBuf, String>,
        list: &impl Fn(&Path) -> Result<Vec<Market>, String>,
        config: &impl Fn(&Path) -> Result<ConfigView, String>,
        run: &impl Fn(&Path, &[&str]) -> Result<Output, String>,
    ) -> Result<MarketplaceResult, String> {
        let mut state = self.0.lock().map_err(|_| "市场状态不可用")?;
        let Some(observation) = state.observation.take() else {
            return Ok(MarketplaceResult::conflict());
        };
        if observation.id != request.snapshot_id
            || current_home.as_ref().ok() != Some(&observation.home)
        {
            return Ok(MarketplaceResult::conflict());
        }
        let markets = if request.operation == Operation::Add {
            Vec::new()
        } else {
            match list(&observation.home) {
                Ok(markets) => markets,
                Err(error) => {
                    return Ok(MarketplaceResult::new(ChangeStatus::Failed, error, false))
                }
            }
        };
        // Check configuration after listing: a slow list must not leave a stale source approved.
        let fresh_config = match config(&observation.home) {
            Ok(config) => config,
            Err(error) => return Ok(MarketplaceResult::new(ChangeStatus::Failed, error, false)),
        };
        if observation.config != fresh_config {
            return Ok(MarketplaceResult::conflict());
        }
        let (command, target) = match request.operation {
            Operation::Add => {
                let source = match validate_source(
                    request.source_kind.as_deref(),
                    request.source.as_deref(),
                ) {
                    Ok(source) => source,
                    Err(error) => {
                        return Ok(MarketplaceResult::new(ChangeStatus::Failed, error, false))
                    }
                };
                ("add", source)
            }
            Operation::Refresh | Operation::Remove => {
                let Some(expected) = observation
                    .markets
                    .iter()
                    .find(|market| Some(&market.name) == request.marketplace_id.as_ref())
                else {
                    return Ok(MarketplaceResult::conflict());
                };
                if markets.iter().find(|market| market.name == expected.name) != Some(expected)
                    || read_only(expected, &fresh_config).is_some()
                {
                    return Ok(MarketplaceResult::conflict());
                }
                if request.operation == Operation::Refresh
                    && expected.marketplace_source["sourceType"] != "git"
                {
                    return Ok(MarketplaceResult::new(
                        ChangeStatus::Failed,
                        "本地来源请重新读取清单，无需 Git 刷新。",
                        false,
                    ));
                }
                (
                    if request.operation == Operation::Refresh {
                        "upgrade"
                    } else {
                        "remove"
                    },
                    expected.name.clone(),
                )
            }
        };
        let output = match run(
            &observation.home,
            &["plugin", "marketplace", command, "--json", "--", &target],
        ) {
            Ok(output) => output,
            Err(error) => {
                return Ok(MarketplaceResult::new(
                    ChangeStatus::Failed,
                    format!("未能确认命令结果：{error}"),
                    true,
                ))
            }
        };
        Ok(operation_result(&request.operation, &target, output))
    }
}

fn validate_source(kind: Option<&str>, source: Option<&str>) -> Result<String, String> {
    let source = source.unwrap_or("").trim();
    if source.is_empty() || source.chars().any(char::is_control) || source.starts_with('-') {
        return Err("请输入有效的市场来源。".into());
    }
    match kind {
        Some("local") => {
            let root = Path::new(source);
            if !root.is_absolute() || !root.join(".agents/plugins/marketplace.json").is_file() {
                return Err(
                    "请选择包含 .agents/plugins/marketplace.json 的本地市场根目录。".into(),
                );
            }
            std::fs::canonicalize(root)
                .map(|path| path.display().to_string())
                .map_err(|e| format!("无法读取市场目录：{e}"))
        }
        Some("git") => {
            let url = source.starts_with("https://")
                || source.starts_with("http://")
                || source.starts_with("ssh://")
                || source.starts_with("git@");
            let shorthand = !source.contains(':')
                && !source.starts_with('.')
                && source.split('/').count() == 2
                && source.split('/').all(|part| {
                    !part.is_empty()
                        && part
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
                });
            if !url && !shorthand {
                return Err("请输入 owner/repo、HTTP(S) Git URL 或 SSH Git URL。".into());
            }
            if let Some(rest) = source
                .strip_prefix("https://")
                .or_else(|| source.strip_prefix("http://"))
            {
                if rest.split('/').next().unwrap_or("").contains('@') {
                    return Err("请使用不含凭据的 Git 地址，并通过本机 Git 完成认证。".into());
                }
            }
            Ok(source.into())
        }
        _ => Err("请选择 Git 或本地市场来源。".into()),
    }
}

fn operation_result(operation: &Operation, target: &str, output: Output) -> MarketplaceResult {
    let invalid = || {
        MarketplaceResult::new(
            ChangeStatus::Failed,
            if output.success {
                "命令已结束，但无法确认返回结果；请重新读取清单核对，勿直接重复执行。".into()
            } else {
                format!(
                    "{}\n操作未成功，仍可能已产生变更；请重新读取清单核对。",
                    codex_cli::diagnostic(&output.stderr)
                )
            },
            true,
        )
    };
    let Ok(value) = serde_json::from_str::<Value>(&output.stdout) else {
        return invalid();
    };
    if let Some(errors) = value.get("errors").and_then(Value::as_array) {
        if !errors.is_empty() {
            let completed = matches!(operation, Operation::Refresh)
                && value["selectedMarketplaces"]
                    .as_array()
                    .is_some_and(|items| items == &vec![Value::String(target.into())])
                && value["upgradedRoots"]
                    .as_array()
                    .is_some_and(|roots| !roots.is_empty());
            return MarketplaceResult::new(
                if completed {
                    ChangeStatus::Partial
                } else {
                    ChangeStatus::Failed
                },
                format!(
                    "{}命令返回 {} 项错误：{}",
                    if completed {
                        "部分刷新已完成。"
                    } else {
                        "操作未成功，仍可能已产生变更；请重新读取清单核对。"
                    },
                    errors.len(),
                    codex_cli::diagnostic(
                        &errors
                            .iter()
                            .map(|v| v
                                .as_str()
                                .map(str::to_owned)
                                .unwrap_or_else(|| v.to_string()))
                            .collect::<Vec<_>>()
                            .join("\n")
                    )
                ),
                true,
            );
        }
    }
    if !output.success {
        return invalid();
    }
    match operation {
        Operation::Add
            if value["marketplaceName"].as_str().is_some()
                && value["alreadyAdded"].as_bool().is_some() =>
        {
            if value["alreadyAdded"] == true {
                MarketplaceResult::new(ChangeStatus::AlreadyExists, "该市场来源已存在。", true)
            } else {
                MarketplaceResult::new(
                    ChangeStatus::Succeeded,
                    format!(
                        "已添加市场 {}。",
                        value["marketplaceName"].as_str().unwrap()
                    ),
                    true,
                )
            }
        }
        Operation::Remove if value["marketplaceName"] == target => MarketplaceResult::new(
            ChangeStatus::Succeeded,
            "市场来源已移除。应用未追加插件卸载或原始来源删除。",
            true,
        ),
        Operation::Refresh
            if value["selectedMarketplaces"]
                .as_array()
                .is_some_and(|items| items == &vec![Value::String(target.into())])
                && value["errors"].is_array()
                && value["upgradedRoots"]
                    .as_array()
                    .is_some_and(|roots| !roots.is_empty()) =>
        {
            MarketplaceResult::new(
                ChangeStatus::Succeeded,
                "市场刷新已完成，已配置插件可能一并同步。请在新会话中验证插件。",
                true,
            )
        }
        _ => invalid(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;
    use std::fs;

    fn market() -> Market {
        Market {
            name: "personal".into(),
            root: "/fixture/market".into(),
            marketplace_source: json!({"sourceType":"git","source":"https://example.test/market.git"}),
        }
    }

    fn config() -> ConfigView {
        ConfigView {
            target: PathBuf::from("/fixture/home/config.toml"),
            sources:
                json!({"personal":{"source_type":"git","source":"https://example.test/market.git"}})
                    .as_object()
                    .unwrap()
                    .clone(),
            owned: HashSet::from(["personal".into()]),
        }
    }

    fn request(snapshot: &MarketplaceScan, operation: Operation) -> MarketplaceRequest {
        MarketplaceRequest {
            snapshot_id: snapshot.snapshot_id.clone().unwrap(),
            operation,
            marketplace_id: Some("personal".into()),
            source_kind: Some("git".into()),
            source: Some("owner/market".into()),
        }
    }

    fn scan(state: &MarketplacesState) -> MarketplaceScan {
        state
            .scan_with(
                Ok(PathBuf::from("/fixture/home")),
                &|_| Ok(vec![market()]),
                &|_| Ok(config()),
            )
            .unwrap()
    }

    fn output(value: Value) -> Output {
        Output {
            success: true,
            stdout: value.to_string(),
            stderr: String::new(),
        }
    }

    #[test]
    fn visible_empty_markets_are_not_derived_from_installed_plugins() {
        let state = MarketplacesState::default();
        let result = scan(&state);
        assert_eq!(result.marketplaces.len(), 1);
        assert!(result.marketplaces[0].read_only_reason.is_none());
        let empty = state
            .scan_with(Ok(PathBuf::from("/fixture/home")), &|_| Ok(vec![]), &|_| {
                Ok(config())
            })
            .unwrap();
        assert_eq!(empty.status, PluginScanStatus::Ready);
        assert!(empty.snapshot_id.is_some());
    }

    #[test]
    fn authoritative_origins_are_required_even_when_sources_match() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        fs::write(home.join("config.toml"), "[marketplaces.personal]\nsource_type='git'\nsource='https://example.test/market.git'\n").unwrap();
        let user = json!({"name":{"type":"user","file":home.join("config.toml"),"profile":null}});
        let mut rpc = json!({"config":{"marketplaces":config().sources},"origins":{
            "marketplaces.personal.source":user,
            "marketplaces.personal.source_type":user
        }});
        assert!(read_only(&market(), &config_view(home, rpc.clone()).unwrap()).is_none());
        for origin_type in ["system", "sessionFlags", "cloud"] {
            rpc["origins"]["marketplaces.personal.source"]["name"]["type"] = json!(origin_type);
            assert!(read_only(&market(), &config_view(home, rpc.clone()).unwrap()).is_some());
        }
        rpc["origins"]["marketplaces.personal.source"] = user;
        rpc["origins"]["marketplaces.personal.ref"] = json!({"name":{"type":"system"}});
        assert!(read_only(&market(), &config_view(home, rpc).unwrap()).is_some());
    }

    #[test]
    fn unknown_sources_mismatched_names_and_changed_addresses_are_read_only() {
        let mut current = market();
        current.marketplace_source = Value::Null;
        assert!(read_only(&current, &config()).is_some());
        current = market();
        current.name = "catalog-alias".into();
        assert!(read_only(&current, &config()).is_some());
        current = market();
        current.marketplace_source["source"] = json!("https://elsewhere.test/market.git");
        assert!(read_only(&current, &config()).is_some());
    }

    #[test]
    fn config_failure_preserves_visible_markets_without_write_approval() {
        let state = MarketplacesState::default();
        let result = state
            .scan_with(
                Ok(PathBuf::from("/fixture/home")),
                &|_| Ok(vec![market()]),
                &|_| Err("无法核实来源".into()),
            )
            .unwrap();
        assert_eq!(result.marketplaces.len(), 1);
        assert!(result.snapshot_id.is_none());
        assert!(result.marketplaces[0].read_only_reason.is_some());
    }

    #[test]
    fn stale_snapshot_changed_home_and_changed_sources_never_execute() {
        for scenario in 0..5 {
            let state = MarketplacesState::default();
            let before = scan(&state);
            let mut req = request(&before, Operation::Remove);
            if scenario == 0 {
                req.snapshot_id = "old".into();
            }
            let home = if scenario == 1 {
                "/other/home"
            } else {
                "/fixture/home"
            };
            let mut changed_config = config();
            if scenario == 2 {
                changed_config.owned.clear();
            }
            if scenario == 3 {
                changed_config.target = PathBuf::from("/other/config.toml");
            }
            let mut changed_market = market();
            if scenario == 4 {
                changed_market.root = "/changed/root".into();
            }
            let result = state
                .change_with(
                    req,
                    Ok(PathBuf::from(home)),
                    &|_| Ok(vec![changed_market.clone()]),
                    &|_| Ok(changed_config.clone()),
                    &|_, _| panic!("must not execute"),
                )
                .unwrap();
            assert_eq!(result.status, ChangeStatus::Conflict);
            assert!(!result.executed);
        }
    }

    #[test]
    fn configuration_changed_during_list_recheck_prevents_execution() {
        let state = MarketplacesState::default();
        let before = scan(&state);
        let changed = Cell::new(false);
        let result = state
            .change_with(
                request(&before, Operation::Remove),
                Ok(PathBuf::from("/fixture/home")),
                &|_| {
                    changed.set(true);
                    Ok(vec![market()])
                },
                &|_| {
                    let mut current = config();
                    if changed.get() {
                        current.owned.clear();
                    }
                    Ok(current)
                },
                &|_, _| panic!("must not execute changed source"),
            )
            .unwrap();
        assert_eq!(result.status, ChangeStatus::Conflict);
    }

    #[test]
    fn refresh_and_remove_use_only_the_confirmed_market_and_consume_approval() {
        for operation in [Operation::Refresh, Operation::Remove] {
            let state = MarketplacesState::default();
            let before = scan(&state);
            let calls = Cell::new(0);
            let result = state.change_with(request(&before, operation.clone()), Ok(PathBuf::from("/fixture/home")), &|_| Ok(vec![market()]), &|_| Ok(config()), &|home,args| {
                calls.set(calls.get()+1);
                assert_eq!(home, Path::new("/fixture/home"));
                assert_eq!(args, &["plugin", "marketplace", if operation == Operation::Refresh { "upgrade" } else { "remove" }, "--json", "--", "personal"]);
                Ok(output(if operation == Operation::Refresh { json!({"selectedMarketplaces":["personal"],"upgradedRoots":["/fixture/market"],"errors":[]}) } else { json!({"marketplaceName":"personal","installedRoot":null}) }))
            }).unwrap();
            assert_eq!(result.status, ChangeStatus::Succeeded);
            assert_eq!(calls.get(), 1);
            assert_eq!(
                state
                    .change_with(
                        request(&before, operation),
                        Ok(PathBuf::from("/fixture/home")),
                        &|_| unreachable!(),
                        &|_| unreachable!(),
                        &|_, _| unreachable!()
                    )
                    .unwrap()
                    .status,
                ChangeStatus::Conflict
            );
        }
    }

    #[test]
    fn failed_reads_invalidate_old_approvals_instead_of_creating_empty_success() {
        let state = MarketplacesState::default();
        let before = scan(&state);
        let failed = state
            .scan_with(
                Ok(PathBuf::from("/fixture/home")),
                &|_| Err("未找到 Codex CLI".into()),
                &|_| unreachable!(),
            )
            .unwrap();
        assert_eq!(failed.status, PluginScanStatus::MissingCli);
        assert_eq!(
            state
                .change_with(
                    request(&before, Operation::Remove),
                    Ok(PathBuf::from("/fixture/home")),
                    &|_| unreachable!(),
                    &|_| unreachable!(),
                    &|_, _| unreachable!()
                )
                .unwrap()
                .status,
            ChangeStatus::Conflict
        );
    }

    #[test]
    fn validates_input_and_does_not_allow_flags_credentials_or_arbitrary_files() {
        for source in [
            "--help",
            "",
            "https://user:secret@host/repo",
            "/tmp/not-a-git-repo",
            "repo\n--config=x",
        ] {
            assert!(
                validate_source(Some("git"), Some(source)).is_err(),
                "{source}"
            );
        }
        for source in [
            "owner/repo",
            "https://example.test/repo.git",
            "git@example.test:owner/repo.git",
        ] {
            assert!(validate_source(Some("git"), Some(source)).is_ok());
        }
        assert!(validate_source(Some("local"), Some("relative/path")).is_err());
        assert!(validate_source(Some("local"), Some("/tmp/not-a-market.json")).is_err());
    }

    #[test]
    fn handles_idempotence_partial_failure_and_unconfirmed_results() {
        assert_eq!(
            operation_result(
                &Operation::Add,
                "owner/repo",
                output(json!({"marketplaceName":"market","alreadyAdded":true}))
            )
            .status,
            ChangeStatus::AlreadyExists
        );
        for success in [true, false] {
            for (roots, expected) in [
                (json!([]), ChangeStatus::Failed),
                (json!(["/fixture/market"]), ChangeStatus::Partial),
            ] {
                let result = operation_result(
                    &Operation::Refresh,
                    "personal",
                    Output {
                        success,
                        stdout: json!({"selectedMarketplaces":["personal"],"upgradedRoots":roots,"errors":["cannot fetch"]}).to_string(),
                        stderr: "marketplace refresh failed".into(),
                    },
                );
                assert_eq!(result.status, expected);
                assert!(result.message.contains("cannot fetch"));
            }
        }
        for value in [
            json!({}),
            json!({"selectedMarketplaces":["other"],"upgradedRoots":["/x"],"errors":[]}),
            json!({"selectedMarketplaces":["personal"],"upgradedRoots":[],"errors":[]}),
        ] {
            assert_eq!(
                operation_result(&Operation::Refresh, "personal", output(value)).status,
                ChangeStatus::Failed
            );
        }
        let result = operation_result(
            &Operation::Add,
            "owner/repo",
            Output {
                success: false,
                stdout: String::new(),
                stderr: "already added from a different source".into(),
            },
        );
        assert_eq!(result.status, ChangeStatus::Failed);
        assert!(result.message.contains("先明确移除"));
        assert!(
            !codex_cli::diagnostic("failed https://user:secret@example.test/repo")
                .contains("secret")
        );
    }

    #[test]
    fn invalid_inventory_is_not_an_empty_success() {
        for source in ["{}", "null", "{\"marketplaces\":[{}]}", "not-json"] {
            assert!(parse_markets(source).is_err());
        }
        assert!(parse_markets(
            &json!({"marketplaces":[{"name":"x","root":"/a"},{"name":"x","root":"/b"}]})
                .to_string()
        )
        .is_err());
    }

    #[test]
    #[ignore = "requires Codex CLI; all mutations use an isolated temporary home and source"]
    fn real_cli_marketplace_lifecycle_in_temporary_home() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("codex");
        fs::create_dir_all(&home).unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(source.join(".agents/plugins")).unwrap();
        fs::write(
            source.join(".agents/plugins/marketplace.json"),
            json!({"name":"fixture-market","plugins":[]}).to_string(),
        )
        .unwrap();
        fs::write(
            home.join("config.toml"),
            "# user setting\n[plugins.\"fixture-plugin@fixture-market\"]\nenabled=false\n",
        )
        .unwrap();
        check_capabilities(&home).unwrap();
        let state = MarketplacesState::default();
        let runner =
            |home: &Path, args: &[&str]| codex_cli::run(home, args, Duration::from_secs(15));
        for expected_status in [ChangeStatus::Succeeded, ChangeStatus::AlreadyExists] {
            let before = state
                .scan_with(Ok(home.clone()), &list, &read_config_view)
                .unwrap();
            assert!(before.snapshot_id.is_some(), "{:?}", before.config_error);
            let req = MarketplaceRequest {
                snapshot_id: before.snapshot_id.unwrap(),
                operation: Operation::Add,
                marketplace_id: None,
                source_kind: Some("local".into()),
                source: Some(source.display().to_string()),
            };
            let result = state
                .change_with(req, Ok(home.clone()), &list, &read_config_view, &runner)
                .unwrap();
            assert_eq!(result.status, expected_status, "{}", result.message);
        }
        let before = state
            .scan_with(Ok(home.clone()), &list, &read_config_view)
            .unwrap();
        assert!(
            before.marketplaces[0].read_only_reason.is_none(),
            "{:?}",
            before.marketplaces
        );
        let result = state
            .change_with(
                MarketplaceRequest {
                    snapshot_id: before.snapshot_id.unwrap(),
                    operation: Operation::Remove,
                    marketplace_id: Some("fixture-market".into()),
                    source_kind: None,
                    source: None,
                },
                Ok(home.clone()),
                &list,
                &read_config_view,
                &runner,
            )
            .unwrap();
        assert_eq!(result.status, ChangeStatus::Succeeded, "{}", result.message);
        assert!(source.exists());
        assert!(list(&home).unwrap().is_empty());
        assert_eq!(
            read_config(&home.join("config.toml")).unwrap().document["plugins"]
                ["fixture-plugin@fixture-market"]["enabled"]
                .as_bool(),
            Some(false)
        );
    }
}
