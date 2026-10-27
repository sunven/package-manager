use crate::claude_cli;
use crate::codex_plugins;
use crate::environment_inspection;
use crate::session_records;
use crate::types::ManagerId;
use crate::vscode_storage;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const ITEM_IDS: &[&str] = &[
    "manager:npm",
    "manager:pnpm",
    "manager:yarn",
    "manager:nvm",
    "manager:homebrew",
    "manager:maven",
    "manager:pip",
    "manager:cargo",
    "manager:docker",
    "manager:bun",
    "manager:uv",
    "manager:fvm",
    "environment",
    "project-scan",
    "vscode-storage",
    "session:codex",
    "session:claude",
    "session:opencode",
    "session:grok",
    "codex:marketplaces",
    "codex:plugins",
    "codex:hooks",
    "codex:skills",
    "claude:extensions",
    "claude:hooks",
    "claude:skills",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservationScope {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservationSuccess {
    pub at: u64,
    pub scope: Option<String>,
    pub scope_label: Option<String>,
    pub completeness: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservationAttempt {
    pub at: u64,
    pub outcome: String,
    pub scope: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservationInvalidation {
    pub at: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservationRecord {
    pub item_id: String,
    pub last_success: Option<ObservationSuccess>,
    pub last_attempt: Option<ObservationAttempt>,
    pub invalidated: Option<ObservationInvalidation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservationEvent {
    pub kind: String,
    pub item_id: String,
    pub at: u64,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub scope_label: Option<String>,
    #[serde(default)]
    pub completeness: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LedgerLoad {
    pub records: Vec<ObservationRecord>,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LedgerWrite {
    pub warning: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Document {
    version: u8,
    items: Vec<ObservationRecord>,
}

#[derive(Clone)]
pub(crate) struct ObservationLedgerState {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl ObservationLedgerState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn load(&self) -> LedgerLoad {
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        match read_document(&self.path) {
            Ok(document) => LedgerLoad {
                records: known_records(document.items),
                warnings: Vec::new(),
            },
            Err(warning) => LedgerLoad {
                records: Vec::new(),
                warnings: vec![warning],
            },
        }
    }

    pub fn record(&self, event: ObservationEvent) -> Result<LedgerWrite, String> {
        validate(&event)?;
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut document = match read_document(&self.path) {
            Ok(document) => document,
            Err(warning) => {
                return Ok(LedgerWrite {
                    warning: Some(warning),
                })
            }
        };
        apply(&mut document.items, event);
        match write_document(&self.path, &document) {
            Ok(()) => Ok(LedgerWrite { warning: None }),
            Err(warning) => Ok(LedgerWrite {
                warning: Some(warning),
            }),
        }
    }
}

pub(crate) fn scopes(enabled_managers: &[ManagerId]) -> BTreeMap<String, Option<ObservationScope>> {
    let mut scopes: BTreeMap<String, Option<ObservationScope>> = ITEM_IDS
        .iter()
        .map(|id| ((*id).to_string(), None))
        .collect();
    scopes.insert(
        "environment".into(),
        Some(ObservationScope {
            key: environment_inspection::scope_key(enabled_managers),
            label: "应用 PATH 与已启用管理器".into(),
        }),
    );
    if let Ok(root) = vscode_storage::default_storage_root() {
        scopes.insert(
            "vscode-storage".into(),
            Some(ObservationScope {
                key: format!("vscode:{}", root.display()),
                label: "VS Code 工作区存储".into(),
            }),
        );
    }
    if let Ok(directory) = session_records::codex_sessions_dir() {
        scopes.insert(
            "session:codex".into(),
            Some(ObservationScope {
                key: format!("session:codex:{}", directory.display()),
                label: "Codex 会话目录".into(),
            }),
        );
    }
    if let Ok(directory) = session_records::claude_projects_dir() {
        scopes.insert(
            "session:claude".into(),
            Some(ObservationScope {
                key: format!("session:claude:{}", directory.display()),
                label: "Claude 会话目录".into(),
            }),
        );
    }
    if let Ok(directory) = crate::grok_sessions::sessions_dir() {
        scopes.insert(
            "session:grok".into(),
            Some(ObservationScope {
                key: format!("session:grok:{}", directory.display()),
                label: "Grok Build 会话目录".into(),
            }),
        );
    }
    if let Ok(home) = codex_plugins::resolve_home() {
        let config = home.join("config.toml");
        let base = format!("codex:{}", home.display());
        for id in ["codex:marketplaces", "codex:plugins", "codex:hooks"] {
            scopes.insert(
                id.into(),
                Some(ObservationScope {
                    key: format!("{base}\n{}", config.display()),
                    label: "Codex home + 配置".into(),
                }),
            );
        }
        scopes.insert(
            "codex:skills".into(),
            Some(ObservationScope {
                key: base,
                label: "Codex home".into(),
            }),
        );
    }
    if let Ok(home) = claude_cli::resolve_home() {
        let base = format!("claude:{}", home.display());
        for id in ["claude:extensions", "claude:skills"] {
            scopes.insert(
                id.into(),
                Some(ObservationScope {
                    key: base.clone(),
                    label: "Claude 配置目录".into(),
                }),
            );
        }
        scopes.insert(
            "claude:hooks".into(),
            Some(ObservationScope {
                key: format!("{base}\n{}", home.join("settings.json").display()),
                label: "Claude 配置目录 + settings.json".into(),
            }),
        );
    }
    scopes
}

fn validate(event: &ObservationEvent) -> Result<(), String> {
    if !ITEM_IDS.contains(&event.item_id.as_str()) {
        return Err(format!("未知观察项：{}", event.item_id));
    }
    if event.at == 0 {
        return Err("观察时间无效".into());
    }
    match event.kind.as_str() {
        "success" => {
            if !matches!(
                event.completeness.as_deref(),
                Some("complete" | "partial" | "unknown")
            ) {
                return Err("观察完整性无效".into());
            }
        }
        "attempt" => {
            if !matches!(event.outcome.as_deref(), Some("failed" | "unavailable")) {
                return Err("观察尝试结果无效".into());
            }
            if event.reason.as_deref().unwrap_or("").trim().is_empty() {
                return Err("观察尝试缺少原因".into());
            }
        }
        "invalidate" => {
            if event.reason.as_deref().unwrap_or("").trim().is_empty() {
                return Err("观察失效缺少原因".into());
            }
        }
        _ => return Err(format!("未知观察事件：{}", event.kind)),
    }
    Ok(())
}

fn apply(items: &mut Vec<ObservationRecord>, event: ObservationEvent) {
    let scope = clean(event.scope, 500);
    let scope_label = clean(event.scope_label, 300);
    let position = items.iter().position(|item| item.item_id == event.item_id);
    let index = match position {
        Some(index) => index,
        None => {
            items.push(ObservationRecord {
                item_id: event.item_id.clone(),
                last_success: None,
                last_attempt: None,
                invalidated: None,
            });
            items.len() - 1
        }
    };
    let record = &mut items[index];
    match event.kind.as_str() {
        "success" => {
            record.last_success = Some(ObservationSuccess {
                at: event.at,
                scope: scope.clone(),
                scope_label,
                completeness: event.completeness.unwrap_or_else(|| "unknown".into()),
                note: clean(event.note, 500),
            });
            record.last_attempt = Some(ObservationAttempt {
                at: event.at,
                outcome: "succeeded".into(),
                scope,
                reason: None,
            });
            record.invalidated = None;
        }
        "attempt" => {
            record.last_attempt = Some(ObservationAttempt {
                at: event.at,
                outcome: event.outcome.unwrap_or_else(|| "failed".into()),
                scope,
                reason: clean(event.reason, 500),
            });
        }
        "invalidate" => {
            record.invalidated = Some(ObservationInvalidation {
                at: event.at,
                reason: clean(event.reason, 500).unwrap_or_default(),
            });
        }
        _ => {}
    }
}

fn clean(value: Option<String>, limit: usize) -> Option<String> {
    value.map(|value| value.chars().take(limit).collect())
}

fn known_records(items: Vec<ObservationRecord>) -> Vec<ObservationRecord> {
    let mut known: Vec<ObservationRecord> = items
        .into_iter()
        .filter(|item| ITEM_IDS.contains(&item.item_id.as_str()))
        .collect();
    known.sort_by_key(|item| {
        ITEM_IDS
            .iter()
            .position(|id| *id == item.item_id)
            .unwrap_or(usize::MAX)
    });
    known
}

fn read_document(path: &Path) -> Result<Document, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Document {
                version: 1,
                items: Vec::new(),
            })
        }
        Err(error) => return Err(format!("观察台账无法读取（{}）：{error}", path.display())),
    };
    let document: Document = serde_json::from_slice(&raw).map_err(|error| {
        format!(
            "观察台账无法识别，原文件已保留（{}）：{error}",
            path.display()
        )
    })?;
    if document.version != 1 {
        return Err(format!(
            "观察台账格式版本未支持，原文件已保留：{}",
            path.display()
        ));
    }
    Ok(document)
}

fn write_document(path: &Path, document: &Document) -> Result<(), String> {
    let parent = path.parent().ok_or("观察台账目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建观察台账目录：{error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("无法保存观察台账：{error}"))?;
    serde_json::to_writer(&mut temporary, document)
        .map_err(|error| format!("无法编码观察台账：{error}"))?;
    temporary
        .flush()
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("无法保存观察台账：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("无法发布观察台账：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success(item: &str, at: u64, scope: &str) -> ObservationEvent {
        ObservationEvent {
            kind: "success".into(),
            item_id: item.into(),
            at,
            scope: Some(scope.into()),
            scope_label: Some("scope".into()),
            completeness: Some("complete".into()),
            note: None,
            outcome: None,
            reason: None,
        }
    }

    fn attempt(item: &str, at: u64, scope: &str) -> ObservationEvent {
        ObservationEvent {
            kind: "attempt".into(),
            item_id: item.into(),
            at,
            scope: Some(scope.into()),
            scope_label: None,
            completeness: None,
            note: None,
            outcome: Some("failed".into()),
            reason: Some("failed".into()),
        }
    }

    fn invalidate(item: &str, at: u64) -> ObservationEvent {
        ObservationEvent {
            kind: "invalidate".into(),
            item_id: item.into(),
            at,
            scope: None,
            scope_label: None,
            completeness: None,
            note: None,
            outcome: None,
            reason: Some("changed".into()),
        }
    }

    #[test]
    fn success_and_failed_attempt_keep_separate_scopes() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservationLedgerState::new(dir.path().join("observation-ledger.json"));
        state.record(success("manager:npm", 10, "old")).unwrap();
        state.record(attempt("manager:npm", 20, "new")).unwrap();
        let load = state.load();
        let record = &load.records[0];
        assert_eq!(
            record.last_success.as_ref().unwrap().scope.as_deref(),
            Some("old")
        );
        assert_eq!(record.last_success.as_ref().unwrap().at, 10);
        assert_eq!(
            record.last_attempt.as_ref().unwrap().scope.as_deref(),
            Some("new")
        );
        assert_eq!(record.last_attempt.as_ref().unwrap().outcome, "failed");
    }

    #[test]
    fn success_clears_invalidation_and_attempt_keeps_it() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservationLedgerState::new(dir.path().join("observation-ledger.json"));
        state.record(success("codex:hooks", 10, "scope")).unwrap();
        state.record(invalidate("codex:hooks", 20)).unwrap();
        assert!(state.load().records[0].invalidated.is_some());
        state.record(attempt("codex:hooks", 30, "scope")).unwrap();
        assert!(state.load().records[0].invalidated.is_some());
        state.record(success("codex:hooks", 40, "scope")).unwrap();
        assert!(state.load().records[0].invalidated.is_none());
        assert_eq!(
            state.load().records[0]
                .last_attempt
                .as_ref()
                .unwrap()
                .outcome,
            "succeeded"
        );
    }

    #[test]
    fn unknown_items_kinds_and_missing_reasons_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservationLedgerState::new(dir.path().join("observation-ledger.json"));
        let mut unknown = success("manager:unknown", 10, "scope");
        assert!(state.record(unknown.clone()).is_err());
        unknown.item_id = "manager:npm".into();
        unknown.kind = "unknown".into();
        assert!(state.record(unknown).is_err());
        let mut missing_reason = attempt("manager:npm", 10, "scope");
        missing_reason.reason = None;
        assert!(state.record(missing_reason).is_err());
    }

    #[test]
    fn corruption_and_future_versions_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("observation-ledger.json");
        for raw in ["invalid", "{\"version\":9,\"items\":[]}"] {
            fs::write(&path, raw).unwrap();
            let state = ObservationLedgerState::new(path.clone());
            assert!(state.load().records.is_empty());
            assert_eq!(state.load().warnings.len(), 1);
            let write = state.record(success("manager:npm", 10, "scope")).unwrap();
            assert!(write.warning.is_some());
            assert_eq!(fs::read_to_string(&path).unwrap(), raw);
        }
    }

    #[test]
    fn unknown_existing_ids_are_preserved_and_known_ids_are_sorted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("observation-ledger.json");
        let document = Document {
            version: 1,
            items: vec![
                ObservationRecord {
                    item_id: "future:item".into(),
                    last_success: None,
                    last_attempt: None,
                    invalidated: None,
                },
                ObservationRecord {
                    item_id: "manager:npm".into(),
                    last_success: None,
                    last_attempt: None,
                    invalidated: None,
                },
            ],
        };
        write_document(&path, &document).unwrap();
        let state = ObservationLedgerState::new(path.clone());
        assert_eq!(state.load().records.len(), 1);
        state.record(success("manager:pnpm", 10, "scope")).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("future:item"));
        assert!(raw.contains("manager:npm"));
        assert!(raw.contains("manager:pnpm"));
    }

    #[test]
    fn values_are_truncated_and_scopes_are_filled_for_static_sources() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservationLedgerState::new(dir.path().join("observation-ledger.json"));
        let mut event = success("manager:npm", 10, &"x".repeat(600));
        event.note = Some("n".repeat(600));
        state.record(event).unwrap();
        let record = &state.load().records[0];
        assert_eq!(
            record
                .last_success
                .as_ref()
                .unwrap()
                .scope
                .as_ref()
                .unwrap()
                .chars()
                .count(),
            500
        );
        assert_eq!(
            record
                .last_success
                .as_ref()
                .unwrap()
                .note
                .as_ref()
                .unwrap()
                .chars()
                .count(),
            500
        );
        let scopes = scopes(&[ManagerId::Npm]);
        assert!(scopes["environment"].is_some());
        assert!(scopes["vscode-storage"].is_some());
        assert!(scopes["manager:npm"].is_none());
        assert!(scopes["project-scan"].is_none());
        assert!(scopes["session:opencode"].is_none());
    }
}
