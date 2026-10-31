use crate::claude_cli::{self, Runner};
use crate::claude_documents::Document;
use crate::claude_plugins::{build_markets, installed, list, read_documents, valid_name, ChangeResult, Marketplace};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Default)]
pub(crate) struct MarketplacesState(Arc<Mutex<State>>);
#[derive(Default)]
struct State {
    sequence: u64,
    observation: Option<MarketObservation>,
}

pub(crate) struct MarketObservation {
    id: String,
    home: PathBuf,
    version: String,
    settings: Document,
    known: Document,
    installations: Document,
    raw_markets: Value,
    installed: Value,
    markets: Vec<Marketplace>,
}

impl MarketObservation {
    fn unchanged(&self, next: &Self) -> bool {
        self.home == next.home
            && self.version == next.version
            && self.raw_markets == next.raw_markets
            && self.installed == next.installed
            && self.markets == next.markets
            && self.settings.unchanged()
            && self.known.unchanged()
            && self.installations.unchanged()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) enum MarketOperation {
    AddMarket,
    UpdateMarket,
    RemoveMarket,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketChangeRequest {
    pub snapshot_id: String,
    pub operation: MarketOperation,
    pub target: Option<String>,
    pub source: Option<String>,
    pub source_kind: Option<String>,
    pub ref_name: Option<String>,
    #[serde(default)]
    pub sparse_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketplaceScan {
    pub(crate) snapshot_id: Option<String>,
    pub(crate) directory: String,
    pub(crate) version: Option<String>,
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) write_blocked_reason: Option<String>,
    pub(crate) marketplaces: Vec<Marketplace>,
}

pub(crate) fn load_markets(home: PathBuf, runner: &Runner) -> Result<MarketObservation, String> {
    let version = claude_cli::version(&home, runner)?;
    let raw_markets = list(&home, &["plugin", "marketplace", "list", "--json"], runner)?;
    let raw_installed = list(&home, &["plugin", "list", "--json"], runner)?;
    let records = installed(&raw_installed)?;
    let (settings, known, installations) = read_documents(&home)?;
    let markets = build_markets(&raw_markets, records, &settings.value, &known.value)?;
    Ok(MarketObservation {
        id: String::new(),
        home,
        version,
        settings,
        known,
        installations,
        raw_markets,
        installed: raw_installed,
        markets,
    })
}

impl MarketplacesState {
    pub(crate) fn scan(&self) -> Result<MarketplaceScan, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.scan_with(claude_cli::resolve_home()?, &claude_cli::run)
    }

    pub(crate) fn scan_with(&self, home: PathBuf, runner: &Runner) -> Result<MarketplaceScan, String> {
        let mut state = self.0.lock().map_err(|_| "Claude 状态不可用。")?;
        state.observation = None;
        match load_markets(home.clone(), runner) {
            Ok(mut observation) => {
                state.sequence += 1;
                observation.id = format!("claude-marketplaces-{}", state.sequence);
                let scan = MarketplaceScan {
                    snapshot_id: Some(observation.id.clone()),
                    directory: home.display().to_string(),
                    version: Some(observation.version.clone()),
                    status: "Ready".into(),
                    message: None,
                    write_blocked_reason: claude_cli::write_blocked(&observation.version),
                    marketplaces: observation.markets.clone(),
                };
                state.observation = Some(observation);
                Ok(scan)
            }
            Err(message) => Ok(MarketplaceScan {
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
            }),
        }
    }

    pub(crate) fn change(&self, request: MarketChangeRequest) -> Result<ChangeResult, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.change_with(request, claude_cli::resolve_home()?, &claude_cli::run)
    }

    pub(crate) fn change_with(
        &self,
        request: MarketChangeRequest,
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
        let next = load_markets(home.clone(), runner)?;
        if !previous.unchanged(&next) {
            return Ok(ChangeResult::new(
                "Conflict",
                "来源、配置或安装清单已变化，请重新读取并确认。",
                false,
            ));
        }
        let args = market_arguments(&request, &next)?;
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

pub(crate) fn market_arguments(
    request: &MarketChangeRequest,
    snapshot: &MarketObservation,
) -> Result<Vec<String>, String> {
    match request.operation {
        MarketOperation::AddMarket => {
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
            let mut args = vec!["plugin".to_string()];
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
            Ok(args)
        }
        MarketOperation::UpdateMarket | MarketOperation::RemoveMarket => {
            let market = snapshot
                .markets
                .iter()
                .find(|m| Some(m.name.as_str()) == request.target.as_deref())
                .ok_or("市场已不在清单中。")?;
            if let Some(reason) = &market.read_only_reason {
                return Err(reason.clone());
            }
            if request.operation == MarketOperation::RemoveMarket {
                if let Some(reason) = &market.remove_blocked_reason {
                    return Err(reason.clone());
                }
            }
            let mut args = vec!["plugin".to_string()];
            args.extend([
                "marketplace".into(),
                if request.operation == MarketOperation::RemoveMarket {
                    "remove"
                } else {
                    "update"
                }
                .into(),
                market.name.clone(),
            ]);
            if request.operation == MarketOperation::RemoveMarket {
                args.extend(["--scope".into(), "user".into()]);
            }
            args.push("--json".into());
            Ok(args)
        }
    }
}
