use crate::manager_history;
use crate::project_cleanup::{ProjectCleanupResult, ProjectDataKind};
use crate::session_records::{SessionRemovalItem, SessionRemovalResult, SessionSourceKind};
use crate::types::{CacheCleanupRun, CleanupOutcome, CleanupStepState, ManagerId};
use crate::vscode_removal::{VscodeStorageRemovalItem, VscodeStorageRemovalResult};
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

fn now() -> u64 {
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

fn text(value: String) -> String {
    value.chars().take(TEXT_LIMIT).collect()
}

fn optional_text(value: Option<String>) -> Option<String> {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt<T: Serialize> {
    #[serde(flatten)]
    pub result: T,
    pub history_id: Option<String>,
    pub history_warning: Option<String>,
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

    pub fn begin_manager(
        &self,
        manager: ManagerId,
        operation: MaintenanceOperation,
        target: Option<String>,
        before_snapshot_id: Option<String>,
    ) -> Result<String, String> {
        let domain = MaintenanceDomain::Manager;
        self.begin(
            domain,
            operation,
            MaintenanceDetail::Manager(ManagerDetail {
                manager_id: manager,
                target,
                steps: None,
            }),
            before_snapshot_id,
        )
    }

    pub fn finish(
        &self,
        id: &str,
        execution: ExecutionSummary,
        message: String,
    ) -> Result<(), String> {
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            record.finished_at = Some(now());
            record.execution = execution;
            record.message = text(message);
            Ok(())
        })
    }

    pub fn finish_manager(
        &self,
        id: &str,
        execution: ExecutionSummary,
        message: String,
        steps: Option<Vec<ManagerStep>>,
    ) -> Result<(), String> {
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::Manager(detail) = &mut record.detail {
                detail.steps = steps;
            }
            record.finished_at = Some(now());
            record.execution = execution;
            record.message = text(message);
            if execution == ExecutionSummary::NotExecuted {
                if let Some(verification) = &mut record.verification {
                    verification.status = VerificationStatus::Skipped;
                    verification.recorded_at = Some(now());
                    if verification.message.is_none() {
                        verification.message = Some("维护未执行，无需核对。".into());
                    }
                }
            }
            Ok(())
        })
    }

    pub fn append_project_result(
        &self,
        id: &str,
        result: &ProjectCleanupResult,
    ) -> Result<(), String> {
        let snapshot = project_result_snapshot(result);
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::ProjectCleanup(detail) = &mut record.detail {
                detail.results.retain(|item| item.candidate_id != snapshot.candidate_id);
                detail.results.push(snapshot);
            }
            Ok(())
        })
    }

    pub fn finish_project(
        &self,
        id: &str,
        finish: ProjectCleanupFinish,
        effect_failures: Vec<(String, String)>,
        message: String,
    ) -> Result<(), String> {
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            let MaintenanceDetail::ProjectCleanup(detail) = &mut record.detail else {
                return Err("维护记录类型不匹配".into());
            };
            detail.finish = finish;
            for (candidate_id, failure) in effect_failures {
                if !detail
                    .scope
                    .candidates
                    .iter()
                    .any(|candidate| candidate.candidate_id == candidate_id)
                {
                    continue;
                }
                detail.results.retain(|item| item.candidate_id != candidate_id);
                detail.results.push(ProjectCleanupTargetResult {
                    candidate_id,
                    status: "Failed".into(),
                    command: None,
                    before_bytes: None,
                    after_bytes: None,
                    cleaned_bytes: None,
                    measurement_status: "Error".into(),
                    message: None,
                    failure_message: None,
                    effect_failure_message: Some(text(failure)),
                });
            }
            record.execution = project_execution(detail);
            record.finished_at = Some(now());
            record.message = text(message);
            Ok(())
        })
    }

    pub fn append_session_item(
        &self,
        id: &str,
        item: &SessionRemovalItem,
    ) -> Result<(), String> {
        let snapshot = session_item_snapshot(item);
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::SessionTrash(detail) = &mut record.detail {
                detail.results.retain(|row| row.id != snapshot.id);
                detail.results.push(snapshot);
            }
            Ok(())
        })
    }

    pub fn finish_session_trash(
        &self,
        id: &str,
        execution_total: usize,
        result: &SessionRemovalResult,
    ) -> Result<(), String> {
        let execution = session_execution(result);
        let message = result
            .message
            .clone()
            .or_else(|| result.operation_error.clone())
            .unwrap_or_else(|| {
                format!(
                    "已移入 {} 项，跳过 {} 项，失败 {} 项。",
                    result.moved, result.skipped, result.failed
                )
            });
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::SessionTrash(detail) = &mut record.detail {
                detail.execution_total = Some(execution_total);
            }
            record.finished_at = Some(now());
            record.execution = execution;
            record.message = text(message);
            Ok(())
        })
    }

    pub fn append_vscode_item(
        &self,
        id: &str,
        item: &VscodeStorageRemovalItem,
    ) -> Result<(), String> {
        let snapshot = vscode_item_snapshot(item);
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::VscodeStorage(detail) = &mut record.detail {
                detail.results.retain(|row| row.id != snapshot.id);
                detail.results.push(snapshot);
            }
            Ok(())
        })
    }

    pub fn finish_vscode(
        &self,
        id: &str,
        result: &VscodeStorageRemovalResult,
    ) -> Result<(), String> {
        let execution = vscode_execution(result);
        let message = result
            .message
            .clone()
            .or_else(|| result.operation_error.clone())
            .unwrap_or_else(|| {
                format!(
                    "已移入 {} 项，跳过 {} 项，失败 {} 项。",
                    result.moved, result.skipped, result.failed
                )
            });
        self.finish(id, execution, message)
    }

    pub fn append_opencode_item(
        &self,
        id: &str,
        item: &crate::opencode_deletion::OpenCodeDeletionItem,
    ) -> Result<(), String> {
        let snapshot = OpenCodeDeletionItemSnapshot {
            id: item.id.clone(),
            status: format!("{:?}", item.status),
            message: optional_text(item.message.clone()),
        };
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::OpenCodeDeletion(detail) = &mut record.detail {
                detail.results.retain(|row| row.id != snapshot.id);
                detail.results.push(snapshot);
            }
            Ok(())
        })
    }

    pub fn finish_opencode(
        &self,
        id: &str,
        result: &crate::opencode_deletion::OpenCodeDeletionResult,
    ) -> Result<(), String> {
        let execution = opencode_execution(result);
        let message = result
            .preflight_error
            .clone()
            .or_else(|| {
                result
                    .items
                    .iter()
                    .find(|item| item.message.is_some())
                    .and_then(|item| item.message.clone())
            })
            .unwrap_or_else(|| {
                format!(
                    "已删除 {} 项，未完成 {} 项。",
                    result
                        .items
                        .iter()
                        .filter(|item| {
                            formats_item_status(&item.status, "Deleted")
                        })
                        .count(),
                    result
                        .items
                        .iter()
                        .filter(|item| {
                            !formats_item_status(&item.status, "Deleted")
                        })
                        .count()
                )
            });
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if let MaintenanceDetail::OpenCodeDeletion(detail) = &mut record.detail {
                detail.completed_ids = result.completed_ids.clone();
            }
            record.finished_at = Some(now());
            record.execution = execution;
            record.message = text(message);
            Ok(())
        })
    }

    pub fn verify(
        &self,
        id: &str,
        status: &str,
        message: Option<String>,
        after_snapshot_id: Option<String>,
    ) -> Result<(), String> {
        let status = match status {
            "succeeded" => VerificationStatus::Succeeded,
            "failed" => VerificationStatus::Failed,
            "skipped" => VerificationStatus::Skipped,
            "notStarted" => VerificationStatus::NotStarted,
            _ => return Err("无法识别的核对结果".into()),
        };
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if record.domain != MaintenanceDomain::Manager {
                return Err("该维护记录没有核对步骤".into());
            }
            let manager = match &record.detail {
                MaintenanceDetail::Manager(detail) => detail.manager_id,
                _ => return Err("维护记录类型不匹配".into()),
            };
            let verification = record.verification.get_or_insert(Verification {
                status: VerificationStatus::NotStarted,
                recorded_at: None,
                message: None,
                before_snapshot_id: None,
                after_snapshot_id: None,
            });
            verification.status = status;
            verification.recorded_at = Some(now());
            verification.message = optional_text(message);
            verification.after_snapshot_id = after_snapshot_id
                .filter(|snapshot| {
                    manager_history::contains_snapshot(&self.directory, manager, snapshot)
                });
            Ok(())
        })
    }

    pub fn record_followup(
        &self,
        id: &str,
        status: &str,
        message: Option<String>,
    ) -> Result<(), String> {
        let status = match status {
            "notRequested" => FollowUpReadStatus::NotRequested,
            "ready" => FollowUpReadStatus::Ready,
            "failed" => FollowUpReadStatus::Failed,
            _ => return Err("无法识别的后续读取状态".into()),
        };
        self.mutate(|records| {
            let record = records
                .iter_mut()
                .find(|record| record.id == id)
                .ok_or("维护记录已超出保留范围")?;
            if !matches!(
                record.domain,
                MaintenanceDomain::SessionRecord | MaintenanceDomain::VscodeStorage
            ) {
                return Err("该维护记录没有后续读取步骤".into());
            }
            if record.finished_at.is_none() || record.interrupted {
                return Err("维护记录尚未关闭".into());
            }
            if record.follow_up_read.is_some() {
                return Err("后续读取结果已记录".into());
            }
            record.follow_up_read = Some(FollowUpRead {
                status,
                recorded_at: now(),
                message: optional_text(message),
            });
            Ok(())
        })
    }

    pub fn run<T: Serialize>(
        &self,
        manager: ManagerId,
        operation: MaintenanceOperation,
        target: Option<String>,
        before: Option<String>,
        run: impl FnOnce() -> T,
        summarize: impl FnOnce(&T) -> (ExecutionSummary, String, Option<Vec<ManagerStep>>),
    ) -> Receipt<T> {
        let (id, mut warning) = match self.begin_manager(manager, operation, target, before) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let result = run();
        let (status, message, steps) = summarize(&result);
        if let Some(id) = &id {
            if let Err(error) = self.finish_manager(id, status, message, steps) {
                warning = Some(error);
            }
        }
        Receipt {
            result,
            history_id: id,
            history_warning: warning,
        }
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
                    not_attempted: total.saturating_sub(detail.results.len()),
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

fn project_result_snapshot(result: &ProjectCleanupResult) -> ProjectCleanupTargetResult {
    ProjectCleanupTargetResult {
        candidate_id: result.candidate_id.clone(),
        status: format!("{:?}", result.status),
        command: result.command.as_ref().map(|command| command.preview.clone()),
        before_bytes: Some(result.before_bytes),
        after_bytes: Some(result.after_bytes),
        cleaned_bytes: Some(result.cleaned_bytes),
        measurement_status: format!("{:?}", result.measurement.status),
        message: optional_text(result.message.clone()),
        failure_message: optional_text(result.failure.as_ref().map(|failure| failure.message.clone())),
        effect_failure_message: None,
    }
}

fn session_item_snapshot(item: &SessionRemovalItem) -> SessionRemovalItemSnapshot {
    SessionRemovalItemSnapshot {
        id: item.id.clone(),
        status: format!("{:?}", item.status),
        reason: item.reason.as_ref().map(|reason| format!("{reason:?}")),
        message: optional_text(item.message.clone()),
    }
}

fn vscode_item_snapshot(item: &VscodeStorageRemovalItem) -> VscodeStorageItemSnapshot {
    VscodeStorageItemSnapshot {
        id: item.id.clone(),
        status: format!("{:?}", item.status),
        reason: item.reason.as_ref().map(|reason| format!("{reason:?}")),
        message: optional_text(item.message.clone()),
    }
}

fn project_execution(detail: &ProjectCleanupDetail) -> ExecutionSummary {
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
    execution_from_counts(
        total,
        succeeded,
        failed,
        skipped,
        total.saturating_sub(detail.results.len()),
    )
}

fn session_execution(result: &SessionRemovalResult) -> ExecutionSummary {
    if result.operation_error.is_some() {
        return ExecutionSummary::NotExecuted;
    }
    execution_from_counts(
        result.items.len(),
        result.moved as usize,
        result.failed as usize,
        result.skipped as usize,
        0,
    )
}

fn vscode_execution(result: &VscodeStorageRemovalResult) -> ExecutionSummary {
    if result.operation_error.is_some() {
        return ExecutionSummary::NotExecuted;
    }
    execution_from_counts(
        result.items.len(),
        result.moved as usize,
        result.failed as usize,
        result.skipped as usize,
        0,
    )
}

fn opencode_execution(
    result: &crate::opencode_deletion::OpenCodeDeletionResult,
) -> ExecutionSummary {
    if result.preflight_error.is_some() {
        return ExecutionSummary::NotExecuted;
    }
    let total = result.items.len();
    let succeeded = result
        .items
        .iter()
        .filter(|item| formats_item_status(&item.status, "Deleted"))
        .count();
    let failed = result
        .items
        .iter()
        .filter(|item| formats_item_status(&item.status, "Failed"))
        .count();
    let not_attempted = result
        .items
        .iter()
        .filter(|item| formats_item_status(&item.status, "NotAttempted"))
        .count();
    execution_from_counts(total, succeeded, failed, 0, not_attempted)
}

fn execution_from_counts(
    total: usize,
    succeeded: usize,
    failed: usize,
    skipped: usize,
    not_attempted: usize,
) -> ExecutionSummary {
    if succeeded == 0 && failed > 0 {
        return ExecutionSummary::Failed;
    }
    if succeeded > 0 && (failed > 0 || skipped > 0 || not_attempted > 0) {
        return ExecutionSummary::Partial;
    }
    if succeeded > 0 && total == succeeded {
        return ExecutionSummary::Succeeded;
    }
    if total == 0 || succeeded == 0 && failed == 0 {
        return ExecutionSummary::NotExecuted;
    }
    ExecutionSummary::NotExecuted
}

fn formats_item_status<T: std::fmt::Debug>(status: &T, expected: &str) -> bool {
    format!("{status:?}") == expected
}

fn source_label(source: SessionSourceKind) -> &'static str {
    match source {
        SessionSourceKind::Codex => "codex",
        SessionSourceKind::Claude => "claude",
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

pub(crate) fn cleanup_summary(
    run: &CacheCleanupRun,
) -> (ExecutionSummary, String, Option<Vec<ManagerStep>>) {
    let steps = run
        .steps
        .iter()
        .map(|step| ManagerStep {
            label: step.label.clone(),
            state: match step.state {
                CleanupStepState::Succeeded => "succeeded".into(),
                CleanupStepState::Failed => "failed".into(),
                CleanupStepState::Skipped => "skipped".into(),
            },
            failure_message: step
                .failure
                .as_ref()
                .map(|failure| text(failure.message.clone())),
        })
        .collect::<Vec<_>>();
    let execution = match run.outcome {
        CleanupOutcome::Succeeded => ExecutionSummary::Succeeded,
        CleanupOutcome::PartiallyCompleted => ExecutionSummary::Partial,
        CleanupOutcome::Failed => ExecutionSummary::Failed,
        CleanupOutcome::NoPlan => ExecutionSummary::NotExecuted,
    };
    let step_text = steps
        .iter()
        .map(|step| {
            let state = match step.state.as_str() {
                "succeeded" => "已完成",
                "failed" => "失败",
                _ => "已跳过",
            };
            format!(
                "{}：{state}{}",
                step.label,
                step.failure_message
                    .as_ref()
                    .map(|message| format!(" · {message}"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let message = run
        .message
        .as_ref()
        .map(|message| format!("{message}\n{step_text}"))
        .unwrap_or(step_text);
    (execution, text(message), Some(steps))
}

pub(crate) fn uninstall_summary(
    run: &crate::types::MaintenanceRunPreview,
) -> (ExecutionSummary, String, Option<Vec<ManagerStep>>) {
    if matches!(run.status, crate::types::AsyncStatus::Ready) {
        (
            ExecutionSummary::Succeeded,
            "全局包卸载已完成".into(),
            None,
        )
    } else {
        (
            ExecutionSummary::Failed,
            text(
                run.failure
                    .as_ref()
                    .map(|failure| failure.message.clone())
                    .or_else(|| run.message.clone())
                    .unwrap_or_else(|| run.stderr.clone()),
            ),
            None,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager_id(store: &MaintenanceHistoryState) -> String {
        store
            .begin_manager(
                ManagerId::Npm,
                MaintenanceOperation::CleanupCache,
                None,
                None,
            )
            .unwrap()
    }

    #[test]
    fn manager_record_keeps_steps_and_verification() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let id = manager_id(&store);
        store
            .finish_manager(
                &id,
                ExecutionSummary::Succeeded,
                "缓存清理已完成".into(),
                Some(vec![ManagerStep {
                    label: "清理缓存".into(),
                    state: "succeeded".into(),
                    failure_message: None,
                }]),
            )
            .unwrap();
        store.verify(&id, "failed", Some("无法读取".into()), None).unwrap();
        let record = store.get(&id).unwrap();
        assert_eq!(record.domain, MaintenanceDomain::Manager);
        assert_eq!(record.execution, ExecutionSummary::Succeeded);
        assert_eq!(record.verification.as_ref().unwrap().status, VerificationStatus::Failed);
        assert_eq!(record.detail.kind(), "manager");
        let summary = store.list().records[0].clone();
        assert_eq!(summary.counts.succeeded, 1);
        assert_eq!(summary.verification_status, Some(VerificationStatus::Failed));
    }

    #[test]
    fn unfinished_records_are_marked_interrupted_on_restart() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let id = manager_id(&store);
        let reopened = MaintenanceHistoryState::new(directory.path().into());
        let record = reopened.get(&id).unwrap();
        assert!(record.interrupted);
        assert_eq!(record.execution, ExecutionSummary::Unconfirmed);
        assert!(record.finished_at.is_none());
        assert_eq!(reopened.list().records[0].execution, ExecutionSummary::Unconfirmed);
        assert_eq!(reopened.list().records[0].interrupted, true);
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
        assert_eq!(record.detail.kind(), "manager");
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
    fn follow_up_read_is_written_once_for_closed_session_records() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let detail = MaintenanceDetail::SessionTrash(SessionTrashDetail {
            scope: SessionTrashScope {
                source: SessionSourceKind::Codex,
                mode: SessionRemovalMode::Single,
                days: None,
                confirmed_count: Some(1),
                confirmed_records: None,
            },
            execution_total: None,
            results: Vec::new(),
        });
        let id = store
            .begin(
                MaintenanceDomain::SessionRecord,
                MaintenanceOperation::RemoveToTrash,
                detail,
                None,
            )
            .unwrap();
        let result = SessionRemovalResult::default();
        store.finish_session_trash(&id, 1, &result).unwrap();
        store
            .record_followup(&id, "ready", Some("列表已刷新".into()))
            .unwrap();
        let record = store.get(&id).unwrap();
        assert_eq!(
            record.follow_up_read.as_ref().unwrap().status,
            FollowUpReadStatus::Ready
        );
        assert!(store.record_followup(&id, "failed", None).is_err());
    }

    #[test]
    fn project_batch_records_effect_failures_and_untried_candidates() {
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let detail = MaintenanceDetail::ProjectCleanup(ProjectCleanupDetail {
            scope: ProjectCleanupScope {
                scan_id: "scan-1".into(),
                scan_root_id: "root-1".into(),
                scan_root_path: "/work".into(),
                batch_id: "batch-1".into(),
                candidates: vec![
                    ProjectCleanupCandidateSnapshot {
                        candidate_id: "candidate-1".into(),
                        kind: ProjectDataKind::RustTarget,
                        project_path: "/work/one".into(),
                        directory_path: "/work/one/target".into(),
                        order: 0,
                        confirmed_bytes: Some(10),
                        confirmed_complete: true,
                    },
                    ProjectCleanupCandidateSnapshot {
                        candidate_id: "candidate-2".into(),
                        kind: ProjectDataKind::NodeModules,
                        project_path: "/work/two".into(),
                        directory_path: "/work/two/node_modules".into(),
                        order: 1,
                        confirmed_bytes: Some(20),
                        confirmed_complete: true,
                    },
                ],
            },
            finish: ProjectCleanupFinish::Completed,
            results: Vec::new(),
        });
        let id = store
            .begin(
                MaintenanceDomain::ProjectCleanup,
                MaintenanceOperation::CleanBatch,
                detail,
                None,
            )
            .unwrap();
        store
            .finish_project(
                &id,
                ProjectCleanupFinish::Stopped,
                vec![("candidate-1".into(), "IPC disconnected".into())],
                "stopped".into(),
            )
            .unwrap();
        let record = store.get(&id).unwrap();
        assert_eq!(record.execution, ExecutionSummary::Failed);
        let summary = store.list().records[0].clone();
        assert_eq!(summary.counts.failed, 1);
        assert_eq!(summary.counts.not_attempted, 1);
        let MaintenanceDetail::ProjectCleanup(detail) = record.detail else {
            panic!("expected project detail");
        };
        assert_eq!(detail.finish, ProjectCleanupFinish::Stopped);
        assert_eq!(
            detail.results[0].effect_failure_message.as_deref(),
            Some("IPC disconnected")
        );
    }

    #[test]
    fn vscode_record_counts_editor_started_skips_as_partial() {
        use crate::vscode_removal::{
            VscodeStorageRemovalItem, VscodeStorageRemovalReason, VscodeStorageRemovalResult,
            VscodeStorageRemovalStatus,
        };
        let directory = tempfile::tempdir().unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        let workspace = |id: &str| VscodeWorkspaceSnapshot {
            id: id.into(),
            name: id.into(),
            project_path: None,
            storage_path: format!("/Code/workspaceStorage/{id}"),
            kind: "Folder".into(),
            project_status: "Missing".into(),
            removable: true,
            removal_block_reason: None,
            bytes: Some(10),
            usage_complete: true,
        };
        let id = store
            .begin(
                MaintenanceDomain::VscodeStorage,
                MaintenanceOperation::RemoveWorkspaceStorage,
                MaintenanceDetail::VscodeStorage(VscodeStorageDetail {
                    scope: VscodeStorageScope {
                        workspaces: vec![workspace("first"), workspace("second")],
                    },
                    results: Vec::new(),
                }),
                None,
            )
            .unwrap();
        let items = [
            VscodeStorageRemovalItem {
                id: "first".into(),
                status: VscodeStorageRemovalStatus::Moved,
                reason: None,
                message: None,
            },
            VscodeStorageRemovalItem {
                id: "second".into(),
                status: VscodeStorageRemovalStatus::Skipped,
                reason: Some(VscodeStorageRemovalReason::EditorStarted),
                message: None,
            },
        ];
        for item in &items {
            store.append_vscode_item(&id, item).unwrap();
        }
        store
            .finish_vscode(
                &id,
                &VscodeStorageRemovalResult {
                    moved: 1,
                    failed: 0,
                    skipped: 1,
                    items: items.into_iter().collect(),
                    operation_error: None,
                    message: None,
                },
            )
            .unwrap();
        let record = store.get(&id).unwrap();
        assert_eq!(record.execution, ExecutionSummary::Partial);
        assert_eq!(store.list().records[0].counts.skipped, 1);
    }

    #[test]
    fn corruption_does_not_replace_history() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("maintenance-v2.json"), b"not json").unwrap();
        let store = MaintenanceHistoryState::new(directory.path().into());
        assert!(!store.list().warnings.is_empty());
        assert!(store
            .begin_manager(ManagerId::Npm, MaintenanceOperation::CleanupCache, None, None)
            .is_err());
        assert_eq!(
            fs::read_to_string(directory.path().join("maintenance-v2.json")).unwrap(),
            "not json"
        );
    }
}

#[cfg(test)]
impl MaintenanceDetail {
    fn kind(&self) -> &'static str {
        match self {
            MaintenanceDetail::Manager(_) => "manager",
            MaintenanceDetail::ProjectCleanup(_) => "projectCleanup",
            MaintenanceDetail::VscodeStorage(_) => "vscodeStorage",
            MaintenanceDetail::SessionTrash(_) => "sessionTrash",
            MaintenanceDetail::OpenCodeDeletion(_) => "openCodeDeletion",
        }
    }
}
