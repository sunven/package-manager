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

const SNAPSHOT_LIMIT: usize = 20;
const OPERATION_LIMIT: usize = 200;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivedPackage {
    pub observation_id: String,
    pub name: String,
    pub version: String,
    pub observed_versions: Option<Vec<String>>,
    pub path: Option<String>,
    pub kind: String,
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivedPath {
    pub kind: String,
    pub label: String,
    pub path: String,
    pub bytes: Option<u64>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotDraft {
    pub manager_id: ManagerId,
    pub status: String,
    pub version: Option<String>,
    pub scope_key: Option<String>,
    pub complete: bool,
    pub packages: Vec<ArchivedPackage>,
    pub paths: Vec<ArchivedPath>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivedSnapshot {
    pub id: String,
    pub captured_at: u64,
    #[serde(flatten)]
    pub observation: SnapshotDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaintenanceRecord {
    pub id: String,
    pub manager_id: ManagerId,
    pub operation: String,
    pub target: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub execution: String,
    pub message: String,
    pub verification: String,
    pub verification_message: Option<String>,
    pub before_snapshot_id: Option<String>,
    pub after_snapshot_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    pub snapshots: Vec<ArchivedSnapshot>,
    pub operations: Vec<MaintenanceRecord>,
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

#[derive(Serialize, Deserialize)]
struct Document<T> {
    version: u8,
    items: Vec<T>,
}

#[derive(Clone)]
pub(crate) struct HistoryState {
    directory: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl HistoryState {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            lock: Arc::new(Mutex::new(())),
        }
    }

    fn snapshots_path(&self, manager: ManagerId) -> PathBuf {
        self.directory.join(format!("snapshots-{manager:?}.json"))
    }

    fn operations_path(&self) -> PathBuf {
        self.directory.join("maintenance.json")
    }

    pub fn save(&self, draft: SnapshotDraft) -> Result<ArchivedSnapshot, String> {
        let _guard = self.lock.lock().map_err(|_| "历史存储暂不可用")?;
        let path = self.snapshots_path(draft.manager_id);
        let mut records: Vec<ArchivedSnapshot> = read(&path)?;
        let snapshot = ArchivedSnapshot {
            id: next_id(),
            captured_at: now(),
            observation: draft,
        };
        records.insert(0, snapshot.clone());
        records.truncate(SNAPSHOT_LIMIT);
        write(&path, &records)?;
        Ok(snapshot)
    }

    pub fn list(&self, manager: ManagerId) -> History {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut warnings = Vec::new();
        let snapshots = read(&self.snapshots_path(manager)).unwrap_or_else(|e| {
            warnings.push(e);
            Vec::new()
        });
        let operations = read(&self.operations_path()).unwrap_or_else(|e| {
            warnings.push(e);
            Vec::new()
        });
        History {
            snapshots,
            operations,
            warnings,
        }
    }

    fn existing_snapshot(&self, manager: ManagerId, id: Option<String>) -> Option<String> {
        let records: Vec<ArchivedSnapshot> = read(&self.snapshots_path(manager)).ok()?;
        id.filter(|id| records.iter().any(|record| &record.id == id))
    }

    fn begin(
        &self,
        manager: ManagerId,
        operation: &str,
        target: Option<String>,
        before: Option<String>,
    ) -> Result<String, String> {
        let _guard = self.lock.lock().map_err(|_| "历史存储暂不可用")?;
        let mut records: Vec<MaintenanceRecord> = read(&self.operations_path())?;
        let id = next_id();
        records.insert(
            0,
            MaintenanceRecord {
                id: id.clone(),
                manager_id: manager,
                operation: operation.into(),
                target,
                started_at: now(),
                finished_at: None,
                execution: "unconfirmed".into(),
                message: "已开始维护；尚未收到执行结果，请在管理器中重新扫描核对。".into(),
                verification: "notStarted".into(),
                verification_message: None,
                before_snapshot_id: self.existing_snapshot(manager, before),
                after_snapshot_id: None,
            },
        );
        records.truncate(OPERATION_LIMIT);
        write(&self.operations_path(), &records)?;
        Ok(id)
    }

    fn finish(&self, id: &str, status: &str, message: String) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "历史存储暂不可用")?;
        let mut records: Vec<MaintenanceRecord> = read(&self.operations_path())?;
        let record = records
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or("维护记录已超出保留范围")?;
        record.finished_at = Some(now());
        record.execution = status.into();
        record.message = message.chars().take(2000).collect();
        if status == "notExecuted" {
            record.verification = "skipped".into();
        }
        write(&self.operations_path(), &records)
    }

    pub fn verify(
        &self,
        id: &str,
        status: &str,
        message: Option<String>,
        after: Option<String>,
    ) -> Result<(), String> {
        if !["succeeded", "failed"].contains(&status) {
            return Err("无法识别的核对结果".into());
        }
        let _guard = self.lock.lock().map_err(|_| "历史存储暂不可用")?;
        let mut records: Vec<MaintenanceRecord> = read(&self.operations_path())?;
        let record = records
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or("维护记录已超出保留范围")?;
        record.verification = status.into();
        record.verification_message = message.map(|s| s.chars().take(2000).collect());
        record.after_snapshot_id = self.existing_snapshot(record.manager_id, after);
        write(&self.operations_path(), &records)
    }

    // Journal errors never replace the native operation's outcome. The mutex is
    // deliberately released before invoking the manager CLI.
    pub fn run<T: Serialize>(
        &self,
        manager: ManagerId,
        operation: &str,
        target: Option<String>,
        before: Option<String>,
        run: impl FnOnce() -> T,
        summarize: impl FnOnce(&T) -> (&'static str, String),
    ) -> Receipt<T> {
        let (id, mut warning) = match self.begin(manager, operation, target, before) {
            Ok(id) => (Some(id), None),
            Err(error) => (None, Some(error)),
        };
        let result = run();
        let (status, message) = summarize(&result);
        if let Some(id) = &id {
            if let Err(error) = self.finish(id, status, message) {
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

fn read<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("历史文件无法读取（{}）：{e}", path.display())),
    };
    let document: Document<T> = serde_json::from_slice(&raw)
        .map_err(|e| format!("历史文件无法识别，原文件已保留（{}）：{e}", path.display()))?;
    if document.version != 1 {
        return Err(format!(
            "历史格式版本未支持，原文件已保留：{}",
            path.display()
        ));
    }
    Ok(document.items)
}

fn write<T: Serialize>(path: &Path, items: &[T]) -> Result<(), String> {
    let parent = path.parent().ok_or("历史目录不可用")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建历史目录：{e}"))?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法保存历史：{e}"))?;
    serde_json::to_writer(
        &mut temporary,
        &Document {
            version: 1,
            items: items.iter().collect::<Vec<_>>(),
        },
    )
    .map_err(|e| format!("无法编码历史：{e}"))?;
    temporary
        .flush()
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|e| format!("无法保存历史：{e}"))?;
    temporary
        .persist(path)
        .map_err(|e| format!("无法发布历史：{e}"))?;
    Ok(())
}

pub(crate) fn uninstall_summary(
    run: &crate::types::MaintenanceRunPreview,
) -> (&'static str, String) {
    if matches!(run.status, crate::types::AsyncStatus::Ready) {
        ("succeeded", "全局包卸载已完成".into())
    } else {
        (
            "failed",
            run.failure
                .as_ref()
                .map(|f| f.message.clone())
                .or_else(|| run.message.clone())
                .unwrap_or_else(|| run.stderr.clone()),
        )
    }
}

pub(crate) fn cleanup_summary(run: &crate::types::CacheCleanupRun) -> (&'static str, String) {
    use crate::types::CleanupOutcome::*;
    let status = match run.outcome {
        Succeeded => "succeeded",
        PartiallyCompleted => "partial",
        Failed => "failed",
        NoPlan => "notExecuted",
    };
    let steps = run
        .steps
        .iter()
        .map(|step| {
            use crate::types::CleanupStepState::*;
            let state = match step.state {
                Succeeded => "已完成",
                Failed => "失败",
                Skipped => "已跳过",
            };
            format!(
                "{}：{state}{}",
                step.label,
                step.failure
                    .as_ref()
                    .map(|f| format!(" · {}", f.message))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    (
        status,
        run.message
            .as_ref()
            .map(|m| format!("{m}\n{steps}"))
            .unwrap_or(steps),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(manager: ManagerId) -> SnapshotDraft {
        SnapshotDraft {
            manager_id: manager,
            status: "Ready".into(),
            version: Some("1".into()),
            scope_key: Some("root".into()),
            complete: true,
            packages: Vec::new(),
            paths: Vec::new(),
            message: None,
        }
    }

    #[test]
    fn keeps_legacy_new_and_unknown_docker_sources_unchanged_across_restart() {
        let dir = tempfile::tempdir().unwrap();
        let sources = [
            Some(r#"["Docker","unix:///var/run/docker.sock",null,null]"#.to_string()),
            Some(
                r#"["docker-observation-source-v2","unix:///var/run/docker.sock","engine-a"]"#
                    .to_string(),
            ),
            None,
        ];
        let store = HistoryState::new(dir.path().into());
        for source in &sources {
            let mut observation = draft(ManagerId::Docker);
            observation.scope_key = source.clone();
            observation.packages.push(ArchivedPackage {
                observation_id: "image-a".into(),
                name: "visible".into(),
                version: "1".into(),
                observed_versions: None,
                path: None,
                kind: "DockerImage".into(),
                signals: Vec::new(),
            });
            store.save(observation).unwrap();
        }
        let reopened = HistoryState::new(dir.path().into());
        let history = reopened.list(ManagerId::Docker);
        assert_eq!(history.snapshots.len(), 3);
        for (snapshot, source) in history.snapshots.iter().zip(sources.iter().rev()) {
            assert_eq!(&snapshot.observation.scope_key, source);
            assert_eq!(snapshot.observation.packages[0].name, "visible");
        }
    }

    #[test]
    fn snapshots_survive_restart_and_keep_the_latest_twenty_per_manager() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        for _ in 0..22 {
            store.save(draft(ManagerId::Npm)).unwrap();
        }
        let newest = store.save(draft(ManagerId::Npm)).unwrap();
        store.save(draft(ManagerId::Pip)).unwrap();
        let reopened = HistoryState::new(dir.path().into());
        assert_eq!(reopened.list(ManagerId::Npm).snapshots.len(), 20);
        assert_eq!(reopened.list(ManagerId::Npm).snapshots[0].id, newest.id);
        assert_eq!(reopened.list(ManagerId::Pip).snapshots.len(), 1);
    }

    #[test]
    fn records_native_result_before_verification_and_preserves_it_on_verification_failure() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        let before = store.save(draft(ManagerId::Npm)).unwrap();
        let receipt = store.run(
            ManagerId::Npm,
            "cleanupCache",
            None,
            Some(before.id.clone()),
            || 42,
            |_| ("partial", "second step failed".into()),
        );
        assert_eq!(receipt.result, 42);
        let id = receipt.history_id.unwrap();
        let reopened = HistoryState::new(dir.path().into());
        let record = &reopened.list(ManagerId::Npm).operations[0];
        assert_eq!(record.execution, "partial");
        assert!(record.finished_at.is_some());
        assert_eq!(record.verification, "notStarted");
        let after = reopened.save(draft(ManagerId::Npm)).unwrap();
        reopened
            .verify(
                &id,
                "failed",
                Some("measurement incomplete".into()),
                Some(after.id.clone()),
            )
            .unwrap();
        let records = reopened.list(ManagerId::Npm).operations;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].execution, "partial");
        assert_eq!(records[0].before_snapshot_id, Some(before.id));
        assert_eq!(records[0].after_snapshot_id, Some(after.id));
        reopened.verify(&id, "succeeded", None, None).unwrap();
        assert_eq!(reopened.list(ManagerId::Npm).operations.len(), 1);
    }

    #[test]
    fn interrupted_execution_remains_unconfirmed_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        store
            .begin(ManagerId::Npm, "cleanupCache", None, None)
            .unwrap();
        let record = &HistoryState::new(dir.path().into())
            .list(ManagerId::Npm)
            .operations[0];
        assert_eq!(record.execution, "unconfirmed");
        assert!(record.finished_at.is_none());
    }

    #[test]
    fn corruption_and_future_versions_are_not_overwritten_and_do_not_stop_maintenance() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        for raw in ["invalid", "{\"version\":9,\"items\":[]}"] {
            fs::write(store.operations_path(), raw).unwrap();
            fs::write(store.snapshots_path(ManagerId::Npm), raw).unwrap();
            let receipt = store.run(
                ManagerId::Npm,
                "cleanupCache",
                None,
                None,
                || "native success",
                |_| ("succeeded", "ok".into()),
            );
            assert_eq!(receipt.result, "native success");
            assert!(receipt.history_warning.is_some());
            assert_eq!(fs::read_to_string(store.operations_path()).unwrap(), raw);
            assert!(store.save(draft(ManagerId::Npm)).is_err());
            assert_eq!(
                fs::read_to_string(store.snapshots_path(ManagerId::Npm)).unwrap(),
                raw
            );
            assert_eq!(store.list(ManagerId::Npm).warnings.len(), 2);
        }
    }

    #[test]
    fn unwritable_directory_does_not_replace_native_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file");
        fs::write(&path, "not a directory").unwrap();
        let receipt = HistoryState::new(path).run(
            ManagerId::Npm,
            "cleanupCache",
            None,
            None,
            || true,
            |_| ("succeeded", "ok".into()),
        );
        assert!(receipt.result);
        assert!(receipt.history_warning.is_some());
    }

    #[test]
    fn concurrent_archives_do_not_overwrite_each_other_and_unpublished_files_do_not_replace_history(
    ) {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || {
                    for _ in 0..4 {
                        store.save(draft(ManagerId::Npm)).unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let mut unfinished = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        unfinished.write_all(b"incomplete").unwrap();
        let records = store.list(ManagerId::Npm).snapshots;
        assert_eq!(records.len(), 16);
        assert_eq!(
            records
                .iter()
                .map(|s| &s.id)
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            16
        );
    }

    #[test]
    fn retention_does_not_delete_operation_facts_or_accept_cross_manager_snapshot_links() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        let other = store.save(draft(ManagerId::Pip)).unwrap();
        let id = store
            .begin(ManagerId::Npm, "cleanupCache", None, Some(other.id))
            .unwrap();
        assert!(store.list(ManagerId::Npm).operations[0]
            .before_snapshot_id
            .is_none());
        let mut records = store.list(ManagerId::Npm).operations;
        records = (0..201)
            .map(|n| {
                let mut r = records[0].clone();
                r.id = format!("old-{n}");
                r
            })
            .collect();
        write(&store.operations_path(), &records).unwrap();
        let newest = store
            .begin(ManagerId::Npm, "cleanupCache", None, None)
            .unwrap();
        let records = store.list(ManagerId::Npm).operations;
        assert_eq!(records.len(), 200);
        assert_eq!(records[0].id, newest);
        assert!(store.verify(&id, "succeeded", None, None).is_err());
    }
}
