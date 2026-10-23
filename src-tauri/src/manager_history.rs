use crate::types::ManagerId;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

const SNAPSHOT_LIMIT: usize = 20;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    pub snapshots: Vec<ArchivedSnapshot>,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Document {
    version: u8,
    items: Vec<ArchivedSnapshot>,
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
        History {
            snapshots,
            warnings,
        }
    }
}

pub(crate) fn contains_snapshot(directory: &Path, manager: ManagerId, id: &str) -> bool {
    let path = directory.join(format!("snapshots-{manager:?}.json"));
    read(&path)
        .map(|records| records.iter().any(|record| record.id == id))
        .unwrap_or(false)
}

fn read(path: &Path) -> Result<Vec<ArchivedSnapshot>, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(format!(
                "历史文件无法读取（{}）：{e}",
                path.display()
            ))
        }
    };
    let document: Document = serde_json::from_slice(&raw).map_err(|e| {
        format!(
            "历史文件无法识别，原文件已保留（{}）：{e}",
            path.display()
        )
    })?;
    if document.version != 1 {
        return Err(format!(
            "历史格式版本未支持，原文件已保留：{}",
            path.display()
        ));
    }
    Ok(document.items)
}

fn write(path: &Path, items: &[ArchivedSnapshot]) -> Result<(), String> {
    let parent = path.parent().ok_or("历史目录不可用")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建历史目录：{e}"))?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法保存历史：{e}"))?;
    serde_json::to_writer(
        &mut temporary,
        &Document {
            version: 1,
            items: items.to_vec(),
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
        assert!(contains_snapshot(dir.path(), ManagerId::Npm, &newest.id));
    }

    #[test]
    fn corruption_and_future_versions_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryState::new(dir.path().into());
        for raw in ["invalid", "{\"version\":9,\"items\":[]}"] {
            fs::write(store.snapshots_path(ManagerId::Npm), raw).unwrap();
            assert!(store.save(draft(ManagerId::Npm)).is_err());
            assert_eq!(
                fs::read_to_string(store.snapshots_path(ManagerId::Npm)).unwrap(),
                raw
            );
            assert_eq!(store.list(ManagerId::Npm).warnings.len(), 1);
        }
    }

    #[test]
    fn concurrent_archives_do_not_overwrite_each_other() {
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
}
