use crate::manager_history;
use crate::project_cleanup::ProjectDataKind;
use crate::session_records::SessionSourceKind;
use crate::types::ManagerId;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

const CLOSED_RECORD_LIMIT: usize = 500;
const TEXT_LIMIT: usize = 2000;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn next_id() -> String {
    format!(
        "{}-{}-{}",
        now(),
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

pub(crate) fn text(value: String) -> String {
    value.chars().take(TEXT_LIMIT).collect()
}

pub(crate) fn optional_text(value: Option<String>) -> Option<String> {
    value.map(text)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MaintenanceDomain {
    Manager,
    ProjectCleanup,
    VscodeStorage,
    SessionRecord,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MaintenanceOperation {
    CleanupCache,
    UninstallGlobalPackage,
    CleanBatch,
    RemoveWorkspaceStorage,
    RemoveToTrash,
    DeletePermanently,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExecutionSummary {
    Succeeded,
    Partial,
    Failed,
    NotExecuted,
    Unconfirmed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FollowUpReadStatus {
    NotRequested,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VerificationStatus {
    Succeeded,
    Failed,
    NotStarted,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FollowUpRead {
    pub status: FollowUpReadStatus,
    pub recorded_at: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Verification {
    pub status: VerificationStatus,
    pub recorded_at: Option<u64>,
    pub message: Option<String>,
    pub before_snapshot_id: Option<String>,
    pub after_snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaintenanceRecord {
    pub id: String,
    pub domain: MaintenanceDomain,
    pub operation: MaintenanceOperation,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub execution: ExecutionSummary,
    pub interrupted: bool,
    pub message: String,
    pub follow_up_read: Option<FollowUpRead>,
    pub verification: Option<Verification>,
    pub detail: MaintenanceDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum MaintenanceDetail {
    Manager(ManagerDetail),
    ProjectCleanup(ProjectCleanupDetail),
    VscodeStorage(VscodeStorageDetail),
    SessionTrash(SessionTrashDetail),
    OpenCodeDeletion(OpenCodeDeletionDetail),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagerDetail {
    pub manager_id: ManagerId,
    pub target: Option<String>,
    pub steps: Option<Vec<ManagerStep>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagerStep {
    pub label: String,
    pub state: String,
    pub failure_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProjectCleanupFinish {
    Completed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectCleanupDetail {
    pub scope: ProjectCleanupScope,
    pub finish: ProjectCleanupFinish,
    pub results: Vec<ProjectCleanupTargetResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectCleanupScope {
    pub scan_id: String,
    pub scan_root_id: String,
    pub scan_root_path: String,
    pub batch_id: String,
    pub candidates: Vec<ProjectCleanupCandidateSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectCleanupCandidateSnapshot {
    pub candidate_id: String,
    pub kind: ProjectDataKind,
    pub project_path: String,
    pub directory_path: String,
    pub order: usize,
    pub confirmed_bytes: Option<u64>,
    pub confirmed_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectCleanupTargetResult {
    pub candidate_id: String,
    pub status: String,
    pub command: Option<String>,
    pub before_bytes: Option<u64>,
    pub after_bytes: Option<u64>,
    pub cleaned_bytes: Option<u64>,
    pub measurement_status: String,
    pub message: Option<String>,
    pub failure_message: Option<String>,
    pub effect_failure_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeStorageDetail {
    pub scope: VscodeStorageScope,
    pub results: Vec<VscodeStorageItemSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeStorageScope {
    pub workspaces: Vec<VscodeWorkspaceSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeWorkspaceSnapshot {
    pub id: String,
    pub name: String,
    pub project_path: Option<String>,
    pub storage_path: String,
    pub kind: String,
    pub project_status: String,
    pub removable: bool,
    pub removal_block_reason: Option<String>,
    pub bytes: Option<u64>,
    pub usage_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeStorageItemSnapshot {
    pub id: String,
    pub status: String,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SessionRemovalMode {
    Single,
    Selected,
    OlderThan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRecordSnapshot {
    pub id: String,
    pub title: String,
    pub working_directory: Option<String>,
    pub last_activity_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRemovalItemSnapshot {
    pub id: String,
    pub status: String,
    pub reason: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionTrashDetail {
    pub scope: SessionTrashScope,
    pub execution_total: Option<usize>,
    pub results: Vec<SessionRemovalItemSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionTrashScope {
    pub source: SessionSourceKind,
    pub mode: SessionRemovalMode,
    pub days: Option<u64>,
    pub confirmed_count: Option<usize>,
    pub confirmed_records: Option<Vec<SessionRecordSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cutoff_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionDetail {
    pub scope: OpenCodeDeletionScope,
    pub completed_ids: Vec<String>,
    pub results: Vec<OpenCodeDeletionItemSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionScope {
    pub source: String,
    pub mode: SessionRemovalMode,
    pub plan_id: String,
    pub days: Option<u8>,
    pub cutoff_ms: Option<i64>,
    pub confirmed_roots: Vec<OpenCodeSessionSnapshot>,
    pub confirmed_affected: Vec<OpenCodeSessionSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeSessionSnapshot {
    pub id: String,
    pub title: String,
    pub working_directory: Option<String>,
    pub last_activity_ms: i64,
    pub archived: bool,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionItemSnapshot {
    pub id: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummarySubject {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manager_id: Option<ManagerId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<SessionRemovalMode>,
    pub target_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummaryCounts {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub not_attempted: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaintenanceRecordSummary {
    pub id: String,
    pub domain: MaintenanceDomain,
    pub operation: MaintenanceOperation,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub execution: ExecutionSummary,
    pub interrupted: bool,
    pub subject: SummarySubject,
    pub counts: SummaryCounts,
    pub follow_up_read_status: Option<FollowUpReadStatus>,
    pub verification_status: Option<VerificationStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    pub records: Vec<MaintenanceRecordSummary>,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRecord {
    id: String,
    manager_id: ManagerId,
    operation: String,
    target: Option<String>,
    started_at: u64,
    finished_at: Option<u64>,
    execution: String,
    message: String,
    verification: String,
    verification_message: Option<String>,
    before_snapshot_id: Option<String>,
    after_snapshot_id: Option<String>,
}

#[derive(Deserialize)]
struct LegacyDocument {
    version: u8,
    items: Vec<LegacyRecord>,
}

#[derive(Clone)]
pub(crate) struct MaintenanceHistoryState {
    directory: PathBuf,
    lock: Arc<Mutex<()>>,
    startup_warning: Arc<Mutex<Option<String>>>,
}

impl MaintenanceHistoryState {
    pub fn new(directory: PathBuf) -> Self {
        let state = Self {
            directory,
            lock: Arc::new(Mutex::new(())),
            startup_warning: Arc::new(Mutex::new(None)),
        };
        state.prepare();
        state
    }

    fn v2_path(&self) -> PathBuf {
        self.directory.join("maintenance-v2.json")
    }

    fn v1_path(&self) -> PathBuf {
        self.directory.join("maintenance.json")
    }

    fn prepare(&self) {
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut warning = None;
        let records = match self.read_or_migrate() {
            Ok(records) => records,
            Err(error) => {
                *self.startup_warning.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
                return;
            }
        };
        let mut changed = false;
        let mut records = records;
        for record in &mut records {
            if record.finished_at.is_none() && !record.interrupted {
                record.interrupted = true;
                changed = true;
            }
        }
        if changed {
            trim(&mut records);
            if let Err(error) = self.write(&records) {
                warning = Some(error);
            }
        }
        *self.startup_warning.lock().unwrap_or_else(|e| e.into_inner()) = warning;
    }

    fn read_or_migrate(&self) -> Result<Vec<MaintenanceRecord>, String> {
        match read_document::<MaintenanceRecord>(&self.v2_path(), 2) {
            Ok(records) => Ok(records),
            Err(error) if error.kind == ReadErrorKind::NotFound => self.migrate_v1(),
            Err(error) => Err(error.message),
        }
    }

    fn migrate_v1(&self) -> Result<Vec<MaintenanceRecord>, String> {
        let raw = match fs::read(self.v1_path()) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!(
                    "维护历史无法读取（{}）：{error}",
                    self.v1_path().display()
                ))
            }
        };
        let legacy: LegacyDocument = serde_json::from_slice(&raw).map_err(|error| {
            format!(
                "维护历史无法识别，原文件已保留（{}）：{error}",
                self.v1_path().display()
            )
        })?;
        if legacy.version != 1 {
            return Err(format!(
                "维护历史格式版本未支持，原文件已保留：{}",
                self.v1_path().display()
            ));
        }
        let mut records = Vec::new();
        for record in legacy.items {
            let operation = match record.operation.as_str() {
                "cleanupCache" => MaintenanceOperation::CleanupCache,
                "uninstallGlobalPackage" => MaintenanceOperation::UninstallGlobalPackage,
                _ => continue,
            };
            let execution = execution_from_str(&record.execution);
            let verification_status = verification_from_str(&record.verification);
            let interrupted = record.finished_at.is_none();
            records.push(MaintenanceRecord {
                id: record.id,
                domain: MaintenanceDomain::Manager,
                operation,
                started_at: record.started_at,
                finished_at: record.finished_at,
                execution,
                interrupted,
                message: text(record.message),
                follow_up_read: None,
                verification: Some(Verification {
                    status: verification_status,
                    recorded_at: None,
                    message: optional_text(record.verification_message),
                    before_snapshot_id: record.before_snapshot_id,
                    after_snapshot_id: record.after_snapshot_id,
                }),
                detail: MaintenanceDetail::Manager(ManagerDetail {
                    manager_id: record.manager_id,
                    target: record.target,
                    steps: None,
                }),
            });
        }
        trim(&mut records);
        if !records.is_empty() {
            self.write(&records)?;
        }
        Ok(records)
    }

    fn read(&self) -> Result<Vec<MaintenanceRecord>, String> {
        match read_document::<MaintenanceRecord>(&self.v2_path(), 2) {
            Ok(records) => Ok(records),
            Err(error) if error.kind == ReadErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.message),
        }
    }

    fn write(&self, records: &[MaintenanceRecord]) -> Result<(), String> {
        let parent = self
            .v2_path()
            .parent()
            .map(Path::to_path_buf)
            .ok_or("维护历史目录不可用")?;
        fs::create_dir_all(&parent).map_err(|error| format!("无法创建维护历史目录：{error}"))?;
        let mut temporary = tempfile::NamedTempFile::new_in(&parent)
            .map_err(|error| format!("无法保存维护历史：{error}"))?;
        serde_json::to_writer(
            &mut temporary,
            &Document {
                version: 2,
                items: records.to_vec(),
            },
        )
        .map_err(|error| format!("无法编码维护历史：{error}"))?;
        temporary
            .flush()
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| format!("无法保存维护历史：{error}"))?;
        temporary
            .persist(self.v2_path())
            .map_err(|error| format!("无法发布维护历史：{error}"))?;
        Ok(())
    }

    fn mutate<F>(&self, update: F) -> Result<(), String>
    where
        F: FnOnce(&mut Vec<MaintenanceRecord>) -> Result<(), String>,
    {
        let _guard = self.lock.lock().map_err(|_| "维护历史暂不可用")?;
        let mut records = self.read()?;
        update(&mut records)?;
        trim(&mut records);
        self.write(&records)
    }

    pub fn list(&self) -> History {
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut warnings = Vec::new();
        if let Some(warning) = self
            .startup_warning
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
        {
            warnings.push(warning);
        }
        let records = self.read().unwrap_or_else(|error| {
            warnings.push(error);
            Vec::new()
        });
        History {
            records: records.iter().map(summary).collect(),
            warnings,
        }
    }

    pub fn get(&self, id: &str) -> Result<MaintenanceRecord, String> {
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        self.read()?
            .into_iter()
            .find(|record| record.id == id)
            .ok_or_else(|| "维护记录不存在或已超出保留范围".to_string())
    }

    pub fn begin(
        &self,
        domain: MaintenanceDomain,
        operation: MaintenanceOperation,
        detail: MaintenanceDetail,
        before_snapshot_id: Option<String>,
    ) -> Result<String, String> {
        let id = next_id();
        let before = match &detail {
            MaintenanceDetail::Manager(manager) => before_snapshot_id
                .filter(|snapshot| {
                    manager_history::contains_snapshot(&self.directory, manager.manager_id, snapshot)
                }),
            _ => None,
        };
        let record = MaintenanceRecord {
            id: id.clone(),
            domain,
            operation,
            started_at: now(),
            finished_at: None,
            execution: ExecutionSummary::Unconfirmed,
            interrupted: false,
            message: "已开始维护；尚未收到执行结果，请在维护历史中核对。".into(),
            follow_up_read: None,
            verification: match &detail {
                MaintenanceDetail::Manager(_) => Some(Verification {
                    status: VerificationStatus::NotStarted,
                    recorded_at: None,
                    message: None,
                    before_snapshot_id: before,
                    after_snapshot_id: None,
                }),
                _ => None,
            },
            detail,
        };
        self.mutate(|records| {
            records.insert(0, record);
            Ok(())
        })?;
        Ok(id)
    }

    pub fn finish(
        &self,
        id: &str,
        execution: ExecutionSummary,
        message: String,
    ) -> Result<(), String> {
        self.update(id, move |record| {
            record.finished_at = Some(now());
            record.execution = execution;
            record.message = text(message);
            Ok(())
        })
    }

    pub fn update<F>(&self, id: &str, update: F) -> Result<(), String>
    where
        F: FnOnce(&mut MaintenanceRecord) -> Result<(), String>,
    {
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            update(record)
        })
    }

    pub fn snapshot_exists(&self, manager: ManagerId, snapshot_id: &str) -> bool {
        manager_history::contains_snapshot(&self.directory, manager, snapshot_id)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ReadErrorKind {
    NotFound,
    Other,
}

struct ReadError {
    kind: ReadErrorKind,
    message: String,
}

fn read_document<T: DeserializeOwned>(path: &Path, version: u8) -> Result<Vec<T>, ReadError> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ReadError {
                kind: ReadErrorKind::NotFound,
                message: String::new(),
            })
        }
        Err(error) => {
            return Err(ReadError {
                kind: ReadErrorKind::Other,
                message: format!("维护历史无法读取（{}）：{error}", path.display()),
            })
        }
    };
    let document: Document<T> = serde_json::from_slice(&raw).map_err(|error| ReadError {
        kind: ReadErrorKind::Other,
        message: format!(
            "维护历史无法识别，原文件已保留（{}）：{error}",
            path.display()
        ),
    })?;
    if document.version != version {
        return Err(ReadError {
            kind: ReadErrorKind::Other,
            message: format!("维护历史格式版本未支持，原文件已保留：{}", path.display()),
        });
    }
    Ok(document.items)
}

#[derive(Serialize, Deserialize)]
struct Document<T> {
    version: u8,
    items: Vec<T>,
}

fn trim(records: &mut Vec<MaintenanceRecord>) {
    let mut closed = 0usize;
    records.retain(|record| {
        let is_closed = record.finished_at.is_some() || record.interrupted;
        if !is_closed {
            return true;
        }
        closed += 1;
        closed <= CLOSED_RECORD_LIMIT
    });
}

fn summary(record: &MaintenanceRecord) -> MaintenanceRecordSummary {
    let (subject, counts) = match &record.detail {
        MaintenanceDetail::Manager(detail) => {
            let steps = detail.steps.as_deref();
            let total = steps
                .map(|steps| steps.len())
                .unwrap_or(if detail.target.is_some() { 1 } else { 0 });
            let succeeded = steps
                .map(|steps| steps.iter().filter(|step| step.state == "succeeded").count())
                .unwrap_or(if record.execution == ExecutionSummary::Succeeded {
                    total
                } else {
                    0
                });
            let failed = steps
                .map(|steps| steps.iter().filter(|step| step.state == "failed").count())
                .unwrap_or(if record.execution == ExecutionSummary::Failed {
                    total
                } else {
                    0
                });
            let skipped = steps
                .map(|steps| steps.iter().filter(|step| step.state == "skipped").count())
                .unwrap_or(0);
            (
                SummarySubject {
                    manager_id: Some(detail.manager_id),
                    target: detail.target.clone(),
                    root_path: None,
                    source: None,
                    mode: None,
                    target_count: total,
                },
                SummaryCounts {
                    total,
                    succeeded,
                    failed,
                    skipped,
                    not_attempted: total.saturating_sub(succeeded + failed + skipped),
                },
            )
        }
        MaintenanceDetail::ProjectCleanup(detail) => {
            let total = detail.scope.candidates.len();
            let succeeded = detail
                .results
                .iter()
                .filter(|result| result.status == "Succeeded")
                .count();
            let failed = detail
                .results
                .iter()
                .filter(|result| {
                    result.status == "Failed"
                        || result.status == "Rejected"
                        || result.effect_failure_message.is_some()
                })
                .count();
            let skipped = detail
                .results
                .iter()
                .filter(|result| result.status == "Skipped")
                .count();
            (
                SummarySubject {
                    manager_id: None,
                    target: None,
                    root_path: Some(detail.scope.scan_root_path.clone()),
                    source: None,
                    mode: None,
                    target_count: total,
                },
                SummaryCounts {
                    total,
                    succeeded,
                    failed,
                    skipped,
                    not_attempted: total.saturating_sub(detail.results.len()),
                },
            )
        }
        MaintenanceDetail::VscodeStorage(detail) => {
            let total = detail.scope.workspaces.len();
            let succeeded = detail.results.iter().filter(|result| result.status == "Moved").count();
            let failed = detail.results.iter().filter(|result| result.status == "Failed").count();
            let skipped = detail.results.iter().filter(|result| result.status == "Skipped").count();
            (
                SummarySubject {
                    manager_id: None,
                    target: None,
                    root_path: None,
                    source: Some("vscode".into()),
                    mode: None,
                    target_count: total,
                },
                SummaryCounts {
                    total,
                    succeeded,
                    failed,
                    skipped,
                    not_attempted: total.saturating_sub(detail.results.len()),
                },
            )
        }
        MaintenanceDetail::SessionTrash(detail) => {
            let total = detail
                .execution_total
                .unwrap_or_else(|| detail.scope.confirmed_count.unwrap_or(detail.results.len()));
            let succeeded = detail.results.iter().filter(|result| result.status == "Moved").count();
            let failed = detail.results.iter().filter(|result| result.status == "Failed").count();
            let skipped = detail.results.iter().filter(|result| result.status == "Skipped").count();
            (
                SummarySubject {
                    manager_id: None,
                    target: None,
                    root_path: None,
                    source: Some(source_label(detail.scope.source).into()),
                    mode: Some(detail.scope.mode),
                    target_count: total,
                },
                SummaryCounts {
                    total,
                    succeeded,
                    failed,
                    skipped,
                    not_attempted: total.saturating_sub(succeeded + failed + skipped),
                },
            )
        }
        MaintenanceDetail::OpenCodeDeletion(detail) => {
            let total = detail.results.len();
            let succeeded = detail.results.iter().filter(|result| result.status == "Deleted").count();
            let failed = detail.results.iter().filter(|result| result.status == "Failed").count();
            let not_attempted = detail
                .results
                .iter()
                .filter(|result| result.status == "NotAttempted")
                .count();
            (
                SummarySubject {
                    manager_id: None,
                    target: None,
                    root_path: None,
                    source: Some("opencode".into()),
                    mode: Some(detail.scope.mode),
                    target_count: detail.scope.confirmed_roots.len().max(total),
                },
                SummaryCounts {
                    total: detail.scope.confirmed_roots.len().max(total),
                    succeeded,
                    failed,
                    skipped: 0,
                    not_attempted,
                },
            )
        }
    };
    MaintenanceRecordSummary {
        id: record.id.clone(),
        domain: record.domain,
        operation: record.operation,
        started_at: record.started_at,
        finished_at: record.finished_at,
        execution: record.execution,
        interrupted: record.interrupted,
        subject,
        counts,
        follow_up_read_status: record.follow_up_read.as_ref().map(|read| read.status),
        verification_status: record.verification.as_ref().map(|verification| verification.status),
    }
}



fn source_label(source: SessionSourceKind) -> &'static str {
    match source {
        SessionSourceKind::Codex => "codex",
        SessionSourceKind::Claude => "claude",
        SessionSourceKind::Grok => "grok",
    }
}

fn execution_from_str(value: &str) -> ExecutionSummary {
    match value {
        "succeeded" => ExecutionSummary::Succeeded,
        "partial" => ExecutionSummary::Partial,
        "failed" => ExecutionSummary::Failed,
        "notExecuted" => ExecutionSummary::NotExecuted,
        _ => ExecutionSummary::Unconfirmed,
    }
}

fn verification_from_str(value: &str) -> VerificationStatus {
    match value {
        "succeeded" => VerificationStatus::Succeeded,
        "failed" => VerificationStatus::Failed,
        "skipped" => VerificationStatus::Skipped,
        _ => VerificationStatus::NotStarted,
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn manager_record(store: &MaintenanceHistoryState) -> String {
        store
            .begin(
                MaintenanceDomain::Manager,
                MaintenanceOperation::CleanupCache,
                MaintenanceDetail::Manager(ManagerDetail {
                    manager_id: ManagerId::Npm,
                    target: None,
                    steps: None,
                }),
                None,
            )
            .unwrap()
    }

    #[test]
    fn manager_summary_counts_recorded_steps() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let id = manager_record(&store);
        store
            .update(&id, |record| {
                if let MaintenanceDetail::Manager(detail) = &mut record.detail {
                    detail.steps = Some(vec![ManagerStep {
                        label: "清理缓存".into(),
                        state: "succeeded".into(),
                        failure_message: None,
                    }]);
                }
                record.finished_at = Some(1);
                record.execution = ExecutionSummary::Succeeded;
                record.message = "缓存清理已完成".into();
                Ok(())
            })
            .unwrap();
        let summary = store.list().records[0].clone();
        assert_eq!(summary.counts.succeeded, 1);
        assert_eq!(summary.execution, ExecutionSummary::Succeeded);
    }

    #[test]
    fn unfinished_records_are_marked_interrupted_on_restart() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let id = manager_record(&store);
        let reopened = MaintenanceHistoryState::new(directory.path().into());
        let record = reopened.get(&id).unwrap();
        assert!(record.interrupted);
        assert_eq!(record.execution, ExecutionSummary::Unconfirmed);
        assert!(record.finished_at.is_none());
        assert_eq!(reopened.list().records[0].execution, ExecutionSummary::Unconfirmed);
        assert!(reopened.list().records[0].interrupted);
    }

    #[test]
    fn migrates_v1_manager_records_and_keeps_the_original_file() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = serde_json::json!({
            "version": 1,
            "items": [{
                "id": "legacy-1",
                "managerId": "Pip",
                "operation": "cleanupCache",
                "target": null,
                "startedAt": 10,
                "finishedAt": null,
                "execution": "unconfirmed",
                "message": "old message",
                "verification": "notStarted",
                "verificationMessage": null,
                "beforeSnapshotId": null,
                "afterSnapshotId": null
            }]
        });
        fs::write(
            directory.path().join("maintenance.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let record = store.get("legacy-1").unwrap();
        assert_eq!(record.domain, MaintenanceDomain::Manager);
        assert_eq!(record.operation, MaintenanceOperation::CleanupCache);
        assert!(record.interrupted);
        assert!(directory.path().join("maintenance-v2.json").exists());
        assert!(directory.path().join("maintenance.json").exists());
        assert_eq!(store.list().records.len(), 1);
    }

    #[test]
    fn closed_record_limit_keeps_live_records() {
        let mut records = Vec::new();
        for index in 0..505u64 {
            records.push(MaintenanceRecord {
                id: format!("closed-{index}"),
                domain: MaintenanceDomain::Manager,
                operation: MaintenanceOperation::CleanupCache,
                started_at: index,
                finished_at: Some(index + 1),
                execution: ExecutionSummary::Succeeded,
                interrupted: false,
                message: String::new(),
                follow_up_read: None,
                verification: None,
                detail: MaintenanceDetail::Manager(ManagerDetail {
                    manager_id: ManagerId::Npm,
                    target: None,
                    steps: None,
                }),
            });
        }
        for index in 0..2u64 {
            records.push(MaintenanceRecord {
                id: format!("live-{index}"),
                domain: MaintenanceDomain::Manager,
                operation: MaintenanceOperation::CleanupCache,
                started_at: 1000 + index,
                finished_at: None,
                execution: ExecutionSummary::Unconfirmed,
                interrupted: false,
                message: String::new(),
                follow_up_read: None,
                verification: None,
                detail: MaintenanceDetail::Manager(ManagerDetail {
                    manager_id: ManagerId::Npm,
                    target: None,
                    steps: None,
                }),
            });
        }
        trim(&mut records);
        assert_eq!(records.len(), CLOSED_RECORD_LIMIT + 2);
        assert!(records.iter().any(|record| record.id == "live-1"));
    }

    #[test]
    fn summary_counts_streamed_session_results() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let id = store
            .begin(
                MaintenanceDomain::SessionRecord,
                MaintenanceOperation::RemoveToTrash,
                MaintenanceDetail::SessionTrash(SessionTrashDetail {
                    scope: SessionTrashScope {
                        source: SessionSourceKind::Codex,
                        mode: SessionRemovalMode::OlderThan,
                        days: Some(7),
                        confirmed_count: Some(2),
                        confirmed_records: None,
                        directory: None,
                        cutoff_ms: None,
                    },
                    execution_total: None,
                    results: Vec::new(),
                }),
                None,
            )
            .unwrap();
        store
            .update(&id, |record| {
                if let MaintenanceDetail::SessionTrash(detail) = &mut record.detail {
                    detail.execution_total = Some(3);
                    detail.results = vec![
                        SessionRemovalItemSnapshot {
                            id: "a".into(),
                            status: "Moved".into(),
                            reason: None,
                            message: None,
                        },
                        SessionRemovalItemSnapshot {
                            id: "b".into(),
                            status: "Skipped".into(),
                            reason: Some("InUse".into()),
                            message: None,
                        },
                    ];
                }
                record.finished_at = Some(1);
                record.execution = ExecutionSummary::Partial;
                record.message = "done".into();
                Ok(())
            })
            .unwrap();
        let summary = store.list().records[0].clone();
        assert_eq!(summary.counts.total, 3);
        assert_eq!(summary.counts.succeeded, 1);
        assert_eq!(summary.counts.skipped, 1);
        assert_eq!(summary.counts.not_attempted, 1);
    }

    #[test]
    fn grok_history_preserves_confirmed_scope_and_counts_unattempted_items_after_read_failure() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let id = store
            .begin(
                MaintenanceDomain::SessionRecord,
                MaintenanceOperation::RemoveToTrash,
                MaintenanceDetail::SessionTrash(SessionTrashDetail {
                    scope: SessionTrashScope {
                        source: SessionSourceKind::Grok,
                        mode: SessionRemovalMode::OlderThan,
                        days: Some(7),
                        confirmed_count: Some(2),
                        confirmed_records: None,
                        directory: Some("/example/.grok/sessions".into()),
                        cutoff_ms: Some(1000),
                    },
                    execution_total: None,
                    results: Vec::new(),
                }),
                None,
            )
            .unwrap();
        store
            .update(&id, |record| {
                if let MaintenanceDetail::SessionTrash(detail) = &mut record.detail {
                    detail.execution_total = Some(2);
                    detail.results = vec![
                        SessionRemovalItemSnapshot {
                            id: "project/first".into(),
                            status: "Moved".into(),
                            reason: None,
                            message: None,
                        },
                        SessionRemovalItemSnapshot {
                            id: "project/second".into(),
                            status: "NotAttempted".into(),
                            reason: Some("RuntimeBlocked".into()),
                            message: Some("Grok 已启动".into()),
                        },
                    ];
                }
                record.finished_at = Some(1);
                record.execution = ExecutionSummary::Partial;
                record.message = "done".into();
                Ok(())
            })
            .unwrap();
        crate::maintenance_adapters::record_followup(
            &store,
            &id,
            "failed",
            Some("合成读取错误".into()),
        )
        .unwrap();
        let saved = store.get(&id).unwrap();
        let summary = summary(&saved);
        assert_eq!(summary.execution, ExecutionSummary::Partial);
        assert_eq!(summary.subject.source.as_deref(), Some("grok"));
        assert_eq!(
            (
                summary.counts.succeeded,
                summary.counts.failed,
                summary.counts.not_attempted
            ),
            (1, 0, 1)
        );
        assert_eq!(
            saved.follow_up_read.as_ref().unwrap().status,
            FollowUpReadStatus::Failed
        );
        let MaintenanceDetail::SessionTrash(saved) = saved.detail else {
            panic!("wrong detail");
        };
        assert_eq!(
            saved.scope.directory.as_deref(),
            Some("/example/.grok/sessions")
        );
        assert_eq!(saved.scope.cutoff_ms, Some(1000));
        let legacy = serde_json::json!({"source":"codex","mode":"single","days":null,"confirmedCount":1,"confirmedRecords":null});
        let scope: SessionTrashScope = serde_json::from_value(legacy).unwrap();
        assert!(scope.directory.is_none() && scope.cutoff_ms.is_none());
    }

    #[test]
    fn project_summary_counts_untried_candidates() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let candidate = |id: &str, order: usize| ProjectCleanupCandidateSnapshot {
            candidate_id: id.into(),
            kind: ProjectDataKind::RustTarget,
            project_path: format!("/work/{id}"),
            directory_path: format!("/work/{id}/target"),
            order,
            confirmed_bytes: Some(10),
            confirmed_complete: true,
        };
        let id = store
            .begin(
                MaintenanceDomain::ProjectCleanup,
                MaintenanceOperation::CleanBatch,
                MaintenanceDetail::ProjectCleanup(ProjectCleanupDetail {
                    scope: ProjectCleanupScope {
                        scan_id: "scan-1".into(),
                        scan_root_id: "root-1".into(),
                        scan_root_path: "/work".into(),
                        batch_id: "batch-1".into(),
                        candidates: vec![candidate("one", 0), candidate("two", 1)],
                    },
                    finish: ProjectCleanupFinish::Completed,
                    results: Vec::new(),
                }),
                None,
            )
            .unwrap();
        store
            .update(&id, |record| {
                if let MaintenanceDetail::ProjectCleanup(detail) = &mut record.detail {
                    detail.finish = ProjectCleanupFinish::Stopped;
                    detail.results = vec![ProjectCleanupTargetResult {
                        candidate_id: "one".into(),
                        status: "Failed".into(),
                        command: None,
                        before_bytes: None,
                        after_bytes: None,
                        cleaned_bytes: None,
                        measurement_status: "Error".into(),
                        message: None,
                        failure_message: None,
                        effect_failure_message: Some("IPC disconnected".into()),
                    }];
                }
                record.execution = ExecutionSummary::Failed;
                record.finished_at = Some(1);
                record.message = "stopped".into();
                Ok(())
            })
            .unwrap();
        let summary = store.list().records[0].clone();
        assert_eq!(summary.counts.failed, 1);
        assert_eq!(summary.counts.not_attempted, 1);
    }

    #[test]
    fn corruption_does_not_replace_history() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("maintenance-v2.json"), b"not json").unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        assert!(!store.list().warnings.is_empty());
        assert!(store
            .begin(
                MaintenanceDomain::Manager,
                MaintenanceOperation::CleanupCache,
                MaintenanceDetail::Manager(ManagerDetail {
                    manager_id: ManagerId::Npm,
                    target: None,
                    steps: None,
                }),
                None,
            )
            .is_err());
        assert_eq!(
            fs::read_to_string(directory.path().join("maintenance-v2.json")).unwrap(),
            "not json"
        );
    }
}
