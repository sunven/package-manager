use crate::project_cleanup::{ProjectCounts, ProjectDataKind, MAX_SCAN_DEPTH};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

const RECORD_LIMIT: usize = 20;
const DOCUMENT_VERSION: u8 = 1;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn next_id(finished_at: u64) -> String {
    format!(
        "scan-record-{}-{}-{}",
        finished_at,
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn scope_key(root_path: &str, max_depth: u8) -> String {
    format!("{root_path}\n{max_depth}")
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CandidateKey {
    pub(crate) kind: ProjectDataKind,
    pub(crate) directory_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MeasurementState {
    Finished,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryState {
    pub(crate) complete: bool,
    pub(crate) skipped: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CandidateCounts {
    pub(crate) total: usize,
    pub(crate) rust_target: usize,
    pub(crate) maven_target: usize,
    pub(crate) node_modules: usize,
}

impl CandidateCounts {
    fn from_keys(keys: &[CandidateKey]) -> Self {
        let mut counts = Self::default();
        for key in keys {
            counts.total = counts.total.saturating_add(1);
            match key.kind {
                ProjectDataKind::RustTarget => {
                    counts.rust_target = counts.rust_target.saturating_add(1)
                }
                ProjectDataKind::MavenTarget => {
                    counts.maven_target = counts.maven_target.saturating_add(1)
                }
                ProjectDataKind::NodeModules => {
                    counts.node_modules = counts.node_modules.saturating_add(1)
                }
            }
        }
        counts
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BaselineSummary {
    pub(crate) finished_at: u64,
    pub(crate) projects: ProjectCounts,
    pub(crate) candidates: CandidateCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CandidateChanges {
    pub(crate) added: Vec<CandidateKey>,
    pub(crate) removed: Vec<CandidateKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectScanRecord {
    pub(crate) id: String,
    pub(crate) preset_id: String,
    pub(crate) scan_id: String,
    pub(crate) root_path: String,
    pub(crate) max_depth: u8,
    pub(crate) finished_at: u64,
    pub(crate) discovery: DiscoveryState,
    pub(crate) measurement: MeasurementState,
    pub(crate) projects: ProjectCounts,
    pub(crate) candidates: CandidateCounts,
    pub(crate) baseline: Option<BaselineSummary>,
    pub(crate) changes: Option<CandidateChanges>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectScanRecordDraft {
    pub(crate) preset_id: String,
    pub(crate) scan_id: String,
    pub(crate) root_path: String,
    pub(crate) max_depth: u8,
    pub(crate) finished_at: u64,
    pub(crate) skipped: usize,
    pub(crate) measurement: MeasurementState,
    pub(crate) projects: ProjectCounts,
    pub(crate) candidates: Vec<CandidateKey>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetHistory {
    records: Vec<ProjectScanRecord>,
    baselines: BTreeMap<String, Baseline>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Baseline {
    finished_at: u64,
    projects: ProjectCounts,
    candidates: CandidateCounts,
    keys: Vec<CandidateKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Document {
    version: u8,
    presets: BTreeMap<String, PresetHistory>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: DOCUMENT_VERSION,
            presets: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetScanHistory {
    pub(crate) records: Vec<ProjectScanRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectScanHistoryRead {
    pub(crate) histories: BTreeMap<String, PresetScanHistory>,
    pub(crate) warning: Option<String>,
}

#[derive(Clone)]
pub(crate) struct ProjectScanHistoryState {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl ProjectScanHistoryState {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn list(&self, preset_ids: &[String]) -> ProjectScanHistoryRead {
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut histories = BTreeMap::new();
        let warning = match read_document(&self.path) {
            Ok(document) => {
                for preset_id in preset_ids {
                    histories.insert(preset_id.clone(), preset_history(&document, preset_id));
                }
                None
            }
            Err(warning) => {
                for preset_id in preset_ids {
                    histories.insert(
                        preset_id.clone(),
                        PresetScanHistory {
                            records: Vec::new(),
                        },
                    );
                }
                Some(warning)
            }
        };
        ProjectScanHistoryRead { histories, warning }
    }

    pub(crate) fn record(
        &self,
        draft: ProjectScanRecordDraft,
    ) -> Result<ProjectScanRecord, String> {
        if draft.preset_id.trim().is_empty() {
            return Err("扫描记录缺少目录预设".to_string());
        }
        if draft.root_path.trim().is_empty() {
            return Err("扫描记录缺少扫描根目录".to_string());
        }
        if draft.max_depth > MAX_SCAN_DEPTH {
            return Err(format!("扫描深度必须在 0 到 {MAX_SCAN_DEPTH} 之间"));
        }
        let type_sum = draft
            .projects
            .rust
            .saturating_add(draft.projects.node)
            .saturating_add(draft.projects.maven);
        if draft.projects.total > type_sum {
            return Err("项目计数不一致：总数大于各类型之和".to_string());
        }

        let keys: Vec<CandidateKey> = draft
            .candidates
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let candidate_counts = CandidateCounts::from_keys(&keys);
        let discovery_complete = draft.skipped == 0;
        let scope = scope_key(&draft.root_path, draft.max_depth);
        let finished_at = if draft.finished_at == 0 {
            now_ms()
        } else {
            draft.finished_at
        };

        let _guard = self.lock.lock().map_err(|_| "扫描记录存储暂不可用")?;
        let mut document = read_document(&self.path)?;
        let preset = document.presets.entry(draft.preset_id.clone()).or_default();
        let baseline_finished_at = preset
            .baselines
            .get(&scope)
            .map(|baseline| baseline.finished_at);
        let baseline_is_newer = baseline_finished_at.is_some_and(|time| time > finished_at);
        let comparable = discovery_complete && !baseline_is_newer;
        let (baseline_summary, changes) = {
            let baseline = preset.baselines.get(&scope);
            let baseline_summary = baseline.map(|baseline| BaselineSummary {
                finished_at: baseline.finished_at,
                projects: baseline.projects,
                candidates: baseline.candidates,
            });
            let changes = if comparable {
                baseline.map(|baseline| {
                    let baseline_keys: BTreeSet<CandidateKey> =
                        baseline.keys.iter().cloned().collect();
                    let current_keys: BTreeSet<CandidateKey> = keys.iter().cloned().collect();
                    CandidateChanges {
                        added: current_keys.difference(&baseline_keys).cloned().collect(),
                        removed: baseline_keys.difference(&current_keys).cloned().collect(),
                    }
                })
            } else {
                None
            };
            (baseline_summary, changes)
        };

        let record = ProjectScanRecord {
            id: next_id(finished_at),
            preset_id: draft.preset_id,
            scan_id: draft.scan_id,
            root_path: draft.root_path,
            max_depth: draft.max_depth,
            finished_at,
            discovery: DiscoveryState {
                complete: discovery_complete,
                skipped: draft.skipped,
            },
            measurement: draft.measurement,
            projects: draft.projects,
            candidates: candidate_counts,
            baseline: baseline_summary,
            changes,
        };
        preset.records.push(record.clone());
        preset
            .records
            .sort_by(|left, right| right.finished_at.cmp(&left.finished_at));
        preset.records.truncate(RECORD_LIMIT);
        if comparable {
            preset.baselines.insert(
                scope,
                Baseline {
                    finished_at,
                    projects: record.projects,
                    candidates: record.candidates,
                    keys,
                },
            );
        }
        write_document(&self.path, &document)?;
        Ok(record)
    }

    pub(crate) fn remove_preset(&self, preset_id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "扫描记录存储暂不可用")?;
        let mut document = read_document(&self.path)?;
        if document.presets.remove(preset_id).is_some() {
            write_document(&self.path, &document)?;
        }
        Ok(())
    }

    pub(crate) fn prune_presets(&self, preset_ids: &[String]) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "扫描记录存储暂不可用")?;
        let mut document = read_document(&self.path)?;
        let keep: BTreeSet<&str> = preset_ids.iter().map(String::as_str).collect();
        let previous = document.presets.len();
        document
            .presets
            .retain(|preset_id, _| keep.contains(preset_id.as_str()));
        if document.presets.len() != previous {
            write_document(&self.path, &document)?;
        }
        Ok(())
    }
}

fn preset_history(document: &Document, preset_id: &str) -> PresetScanHistory {
    PresetScanHistory {
        records: document
            .presets
            .get(preset_id)
            .map(|preset| preset.records.clone())
            .unwrap_or_default(),
    }
}

fn read_document(path: &Path) -> Result<Document, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Document::default())
        }
        Err(error) => {
            return Err(format!(
                "扫描记录文件无法读取（{}）：{error}",
                path.display()
            ))
        }
    };
    let document: Document = serde_json::from_slice(&raw).map_err(|error| {
        format!(
            "扫描记录文件无法识别，原文件已保留（{}）：{error}",
            path.display()
        )
    })?;
    if document.version != DOCUMENT_VERSION {
        return Err(format!(
            "扫描记录格式版本未支持，原文件已保留：{}",
            path.display()
        ));
    }
    Ok(document)
}

fn write_document(path: &Path, document: &Document) -> Result<(), String> {
    let parent = path.parent().ok_or("扫描记录目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建扫描记录目录：{error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("无法保存扫描记录：{error}"))?;
    serde_json::to_writer(&mut temporary, document)
        .map_err(|error| format!("无法编码扫描记录：{error}"))?;
    temporary
        .flush()
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("无法保存扫描记录：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("无法发布扫描记录：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(kind: ProjectDataKind, directory_path: &str) -> CandidateKey {
        CandidateKey {
            kind,
            directory_path: directory_path.to_string(),
        }
    }

    fn draft(
        preset_id: &str,
        finished_at: u64,
        skipped: usize,
        candidates: Vec<CandidateKey>,
    ) -> ProjectScanRecordDraft {
        draft_at(preset_id, finished_at, skipped, 8, candidates)
    }

    fn draft_at(
        preset_id: &str,
        finished_at: u64,
        skipped: usize,
        max_depth: u8,
        candidates: Vec<CandidateKey>,
    ) -> ProjectScanRecordDraft {
        ProjectScanRecordDraft {
            preset_id: preset_id.to_string(),
            scan_id: format!("scan-{finished_at}"),
            root_path: "/code".to_string(),
            max_depth,
            finished_at,
            skipped,
            measurement: MeasurementState::Finished,
            projects: ProjectCounts {
                total: 2,
                rust: 1,
                node: 1,
                maven: 0,
            },
            candidates,
        }
    }

    #[test]
    fn records_changes_against_last_discovery_complete_scan_for_same_scope() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        let rust = key(ProjectDataKind::RustTarget, "/code/a/target");
        let node_a = key(ProjectDataKind::NodeModules, "/code/a/node_modules");
        let node_b = key(ProjectDataKind::NodeModules, "/code/b/node_modules");
        let rust_c = key(ProjectDataKind::RustTarget, "/code/c/target");

        let first = store
            .record(draft(
                "preset-1",
                100,
                0,
                vec![rust.clone(), node_a.clone()],
            ))
            .unwrap();
        assert!(first.changes.is_none());
        assert!(first.baseline.is_none());
        assert_eq!(first.candidates.total, 2);

        let second = store
            .record(draft(
                "preset-1",
                200,
                0,
                vec![node_a.clone(), node_b.clone()],
            ))
            .unwrap();
        assert_eq!(second.baseline.as_ref().unwrap().finished_at, 100);
        let changes = second.changes.unwrap();
        assert_eq!(changes.added, vec![node_b.clone()]);
        assert_eq!(changes.removed, vec![rust.clone()]);

        let incomplete = store
            .record(draft("preset-1", 300, 1, vec![node_b.clone()]))
            .unwrap();
        assert!(incomplete.changes.is_none());
        assert_eq!(incomplete.baseline.as_ref().unwrap().finished_at, 200);
        assert_eq!(incomplete.discovery.skipped, 1);

        let fourth = store
            .record(draft("preset-1", 400, 0, vec![rust_c.clone()]))
            .unwrap();
        let changes = fourth.changes.unwrap();
        assert_eq!(changes.added, vec![rust_c]);
        assert_eq!(changes.removed, vec![node_a, node_b]);

        let other_depth = store
            .record(draft_at("preset-1", 500, 0, 6, vec![]))
            .unwrap();
        assert!(other_depth.baseline.is_none());
        assert!(other_depth.changes.is_none());

        let other_preset = store.record(draft("preset-2", 600, 0, vec![])).unwrap();
        assert!(other_preset.baseline.is_none());
        assert!(other_preset.changes.is_none());
    }

    #[test]
    fn older_complete_scan_does_not_replace_a_newer_baseline() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        let newer = key(ProjectDataKind::NodeModules, "/code/b/node_modules");
        let older = key(ProjectDataKind::RustTarget, "/code/a/target");
        store
            .record(draft("preset-1", 200, 0, vec![newer.clone()]))
            .unwrap();

        let out_of_order = store
            .record(draft("preset-1", 100, 0, vec![older]))
            .unwrap();
        assert!(out_of_order.changes.is_none());
        assert_eq!(out_of_order.baseline.as_ref().unwrap().finished_at, 200);

        let records = store.list(&["preset-1".to_string()]).histories["preset-1"]
            .records
            .clone();
        assert_eq!(
            records
                .iter()
                .map(|record| record.finished_at)
                .collect::<Vec<_>>(),
            vec![200, 100]
        );

        let next = store
            .record(draft(
                "preset-1",
                300,
                0,
                vec![key(ProjectDataKind::NodeModules, "/code/c/node_modules")],
            ))
            .unwrap();
        let changes = next.changes.unwrap();
        assert_eq!(changes.added.len(), 1);
        assert_eq!(changes.removed, vec![newer]);
    }

    #[test]
    fn draft_and_record_match_the_frontend_camel_case_contract() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        let draft: ProjectScanRecordDraft = serde_json::from_value(serde_json::json!({
            "presetId": "preset-1",
            "scanId": "scan-1",
            "rootPath": "/code",
            "maxDepth": 8,
            "finishedAt": 100,
            "skipped": 0,
            "measurement": "stopped",
            "projects": { "total": 1, "rust": 1, "node": 0, "maven": 0 },
            "candidates": [
                { "kind": "RustTarget", "directoryPath": "/code/a/target" }
            ]
        }))
        .unwrap();

        let record = store.record(draft).unwrap();
        let serialized = serde_json::to_value(&record).unwrap();

        assert_eq!(serialized["presetId"], "preset-1");
        assert_eq!(serialized["scanId"], "scan-1");
        assert_eq!(serialized["rootPath"], "/code");
        assert_eq!(serialized["maxDepth"], 8);
        assert_eq!(serialized["finishedAt"], 100);
        assert_eq!(serialized["measurement"], "stopped");
        assert_eq!(serialized["discovery"]["complete"], true);
        assert_eq!(serialized["discovery"]["skipped"], 0);
        assert_eq!(serialized["projects"]["rust"], 1);
        assert_eq!(serialized["candidates"]["total"], 1);
        assert_eq!(serialized["candidates"]["rustTarget"], 1);
        assert_eq!(serialized["changes"], serde_json::Value::Null);
    }

    #[test]
    fn dedupes_candidate_keys_and_counts_by_kind() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        let node = key(ProjectDataKind::NodeModules, "/code/a/node_modules");
        let rust = key(ProjectDataKind::RustTarget, "/code/a/target");

        let record = store
            .record(draft(
                "preset-1",
                100,
                0,
                vec![
                    node.clone(),
                    node,
                    rust,
                    key(ProjectDataKind::MavenTarget, "/code/a/target"),
                ],
            ))
            .unwrap();

        assert_eq!(record.candidates.total, 3);
        assert_eq!(record.candidates.rust_target, 1);
        assert_eq!(record.candidates.maven_target, 1);
        assert_eq!(record.candidates.node_modules, 1);
        assert_eq!(record.projects.total, 2);
    }

    #[test]
    fn keeps_twenty_records_and_removes_preset_history() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        for index in 0..22 {
            store
                .record(draft(
                    "preset-1",
                    100 + index,
                    0,
                    vec![key(
                        ProjectDataKind::NodeModules,
                        &format!("/code/{index}/node_modules"),
                    )],
                ))
                .unwrap();
        }
        let history = store.list(&["preset-1".to_string()]);
        assert!(history.warning.is_none());
        assert_eq!(history.histories["preset-1"].records.len(), 20);
        assert_eq!(history.histories["preset-1"].records[0].finished_at, 121);

        store.remove_preset("preset-1").unwrap();
        assert!(store.list(&["preset-1".to_string()]).histories["preset-1"]
            .records
            .is_empty());
    }

    #[test]
    fn corruption_and_future_versions_are_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.json");
        let store = ProjectScanHistoryState::new(path.clone());
        for raw in ["invalid", "{\"version\":9,\"presets\":{}}"] {
            fs::write(&path, raw).unwrap();
            assert!(store.record(draft("preset-1", 100, 0, vec![])).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), raw);
            assert!(store.list(&["preset-1".to_string()]).warning.is_some());
        }
    }

    #[test]
    fn prunes_orphaned_presets() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        store.record(draft("preset-1", 100, 0, vec![])).unwrap();
        store.record(draft("preset-2", 200, 0, vec![])).unwrap();

        store.prune_presets(&["preset-2".to_string()]).unwrap();

        let history = store.list(&["preset-1".to_string(), "preset-2".to_string()]);
        assert!(history.histories["preset-1"].records.is_empty());
        assert_eq!(history.histories["preset-2"].records.len(), 1);
    }

    #[test]
    fn rejects_inconsistent_project_counts() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        let mut record = draft("preset-1", 100, 0, vec![]);
        record.projects = ProjectCounts {
            total: 3,
            rust: 1,
            node: 0,
            maven: 0,
        };
        assert!(store.record(record).is_err());
    }

    #[test]
    fn concurrent_records_do_not_overwrite_each_other() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectScanHistoryState::new(directory.path().join("history.json"));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || {
                    for _ in 0..4 {
                        store.record(draft("preset-1", 100, 0, vec![])).unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(
            store.list(&["preset-1".to_string()]).histories["preset-1"]
                .records
                .len(),
            16
        );
    }
}
