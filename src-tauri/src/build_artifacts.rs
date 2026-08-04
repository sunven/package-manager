use crate::command::{command_failure, envelope_owned};
use crate::types::{CommandEnvelope, CommandFailure, CommandRun, FailureKind};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

pub(crate) const DEFAULT_MAX_DEPTH: u8 = 8;
pub(crate) const MAX_SCAN_DEPTH: u8 = 32;
const CLEAN_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_REPORTED_SCAN_ERRORS: usize = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildArtifactSettings {
    pub(crate) root_id: Option<String>,
    pub(crate) root_path: Option<String>,
    pub(crate) max_depth: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildArtifactScan {
    pub(crate) root_id: String,
    pub(crate) scan_id: String,
    pub(crate) root_path: String,
    pub(crate) max_depth: u8,
    pub(crate) status: BuildArtifactScanStatus,
    pub(crate) candidates: Vec<BuildArtifactCandidate>,
    pub(crate) skipped: usize,
    pub(crate) errors: Vec<BuildArtifactScanError>,
    pub(crate) cargo_available: bool,
    pub(crate) cargo_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum BuildArtifactScanStatus {
    Ready,
    Partial,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildArtifactScanError {
    pub(crate) path: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildArtifactCandidate {
    pub(crate) candidate_id: String,
    pub(crate) project_path: String,
    pub(crate) target_path: String,
    pub(crate) status: BuildArtifactCandidateStatus,
    pub(crate) message: Option<String>,
    pub(crate) measurement: BuildArtifactMeasurement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum BuildArtifactCandidateStatus {
    Ready,
    Symlink,
    NotDirectory,
    Unrecognized,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildArtifactMeasurement {
    pub(crate) status: BuildArtifactMeasurementStatus,
    pub(crate) bytes: Option<u64>,
    pub(crate) human: Option<String>,
    pub(crate) files: u64,
    pub(crate) directories: u64,
    pub(crate) skipped: u64,
    pub(crate) latest_modified_ms: Option<u64>,
    pub(crate) message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum BuildArtifactMeasurementStatus {
    Pending,
    Ready,
    Partial,
    Missing,
    PermissionDenied,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub(crate) enum BuildArtifactOpenTarget {
    Project,
    Target,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildArtifactCleanupResult {
    pub(crate) candidate_id: String,
    pub(crate) status: BuildArtifactCleanupStatus,
    pub(crate) command: Option<CommandEnvelope>,
    pub(crate) before_bytes: u64,
    pub(crate) after_bytes: u64,
    pub(crate) released_bytes: u64,
    pub(crate) measurement: BuildArtifactMeasurement,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) message: Option<String>,
    pub(crate) failure: Option<CommandFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum BuildArtifactCleanupStatus {
    Succeeded,
    PartiallyCompleted,
    Failed,
    Skipped,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    root_path: String,
    max_depth: u8,
}

#[derive(Debug, Clone)]
struct AuthorizedRoot {
    id: String,
    path: PathBuf,
    max_depth: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct CandidateRecord {
    id: String,
    project_path: PathBuf,
    pub(crate) target_path: PathBuf,
    status: BuildArtifactCandidateStatus,
    message: Option<String>,
    measurement: BuildArtifactMeasurement,
}

#[derive(Debug, Clone)]
struct ScanSession {
    id: String,
    root_id: String,
    root_path: PathBuf,
    candidates: HashMap<String, CandidateRecord>,
}

#[derive(Debug)]
struct Registry {
    next_id: u64,
    settings_path: PathBuf,
    persisted_root_path: Option<PathBuf>,
    max_depth: u8,
    root: Option<AuthorizedRoot>,
    scan: Option<ScanSession>,
    pending_scan_id: Option<String>,
}

pub(crate) struct BuildArtifactState(Mutex<Registry>);

impl BuildArtifactState {
    pub(crate) fn load(settings_path: PathBuf) -> Self {
        Self(Mutex::new(Registry::load(settings_path)))
    }

    pub(crate) fn settings(&self) -> Result<BuildArtifactSettings, String> {
        self.lock().map(|registry| registry.settings())
    }

    pub(crate) fn authorize_root(&self, path: PathBuf) -> Result<BuildArtifactSettings, String> {
        self.lock()?.authorize_root(path)
    }

    pub(crate) fn prepare_scan(
        &self,
        root_id: &str,
        max_depth: u8,
    ) -> Result<(PathBuf, u8, String), String> {
        self.lock()?.prepare_scan(root_id, max_depth)
    }

    pub(crate) fn install_scan(
        &self,
        root_id: &str,
        scan_id: String,
        root_path: PathBuf,
        max_depth: u8,
        discovery: Discovery,
        cargo_available: bool,
        cargo_message: Option<String>,
    ) -> Result<BuildArtifactScan, String> {
        self.lock()?.install_scan(
            root_id,
            scan_id,
            root_path,
            max_depth,
            discovery,
            cargo_available,
            cargo_message,
        )
    }

    pub(crate) fn candidate_for_measurement(
        &self,
        scan_id: &str,
        candidate_id: &str,
    ) -> Result<CandidateRecord, String> {
        self.lock()?.candidate(scan_id, candidate_id)
    }

    pub(crate) fn apply_measurement(
        &self,
        scan_id: &str,
        candidate_id: &str,
        measurement: BuildArtifactMeasurement,
    ) -> Result<BuildArtifactMeasurement, String> {
        self.lock()?
            .apply_measurement(scan_id, candidate_id, measurement)
    }

    pub(crate) fn cleanup_context(
        &self,
        scan_id: &str,
        candidate_id: &str,
    ) -> Result<(PathBuf, CandidateRecord), String> {
        self.lock()?.cleanup_context(scan_id, candidate_id)
    }

    pub(crate) fn apply_cleanup_result(
        &self,
        scan_id: &str,
        result: &BuildArtifactCleanupResult,
    ) -> Result<(), String> {
        self.lock()?.apply_cleanup_result(scan_id, result)
    }

    pub(crate) fn root_path(&self, root_id: &str) -> Result<PathBuf, String> {
        self.lock()?.root_path(root_id)
    }

    pub(crate) fn candidate_path(
        &self,
        scan_id: &str,
        candidate_id: &str,
        target: BuildArtifactOpenTarget,
    ) -> Result<PathBuf, String> {
        self.lock()?.candidate_path(scan_id, candidate_id, target)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Registry>, String> {
        self.0
            .lock()
            .map_err(|_| "Build artifact state is unavailable".to_string())
    }
}

impl Registry {
    fn load(settings_path: PathBuf) -> Self {
        let persisted = fs::read_to_string(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<PersistedSettings>(&raw).ok());
        let persisted_root_path = persisted
            .as_ref()
            .map(|settings| PathBuf::from(&settings.root_path));
        let max_depth = persisted
            .as_ref()
            .map(|settings| settings.max_depth.min(MAX_SCAN_DEPTH))
            .unwrap_or(DEFAULT_MAX_DEPTH);
        let mut registry = Self {
            next_id: 1,
            settings_path,
            persisted_root_path,
            max_depth,
            root: None,
            scan: None,
            pending_scan_id: None,
        };

        if let Some(path) = registry.persisted_root_path.clone() {
            if let Ok(canonical) = canonical_directory(&path) {
                let id = registry.next_identifier("root");
                registry.root = Some(AuthorizedRoot {
                    id,
                    path: canonical,
                    max_depth,
                });
            }
        }
        registry
    }

    fn settings(&self) -> BuildArtifactSettings {
        BuildArtifactSettings {
            root_id: self.root.as_ref().map(|root| root.id.clone()),
            root_path: self
                .root
                .as_ref()
                .map(|root| root.path.display().to_string())
                .or_else(|| {
                    self.persisted_root_path
                        .as_ref()
                        .map(|path| path.display().to_string())
                }),
            max_depth: self.max_depth,
        }
    }

    fn authorize_root(&mut self, path: PathBuf) -> Result<BuildArtifactSettings, String> {
        let canonical = canonical_directory(&path)?;
        let id = self.next_identifier("root");
        self.persisted_root_path = Some(canonical.clone());
        self.root = Some(AuthorizedRoot {
            id,
            path: canonical,
            max_depth: self.max_depth,
        });
        self.scan = None;
        self.pending_scan_id = None;
        self.persist()?;
        Ok(self.settings())
    }

    fn prepare_scan(
        &mut self,
        root_id: &str,
        max_depth: u8,
    ) -> Result<(PathBuf, u8, String), String> {
        if max_depth > MAX_SCAN_DEPTH {
            return Err(format!("Scan depth must be between 0 and {MAX_SCAN_DEPTH}"));
        }
        let root = self
            .root
            .as_mut()
            .filter(|root| root.id == root_id)
            .ok_or_else(|| {
                "The selected build artifact root is no longer authorized".to_string()
            })?;
        let path = canonical_directory(&root.path)?;
        root.path = path.clone();
        root.max_depth = max_depth;
        self.max_depth = max_depth;
        self.persisted_root_path = Some(path.clone());
        self.scan = None;
        let scan_id = self.next_identifier("scan");
        self.pending_scan_id = Some(scan_id.clone());
        self.persist()?;
        Ok((path, max_depth, scan_id))
    }

    fn install_scan(
        &mut self,
        root_id: &str,
        scan_id: String,
        root_path: PathBuf,
        max_depth: u8,
        discovery: Discovery,
        cargo_available: bool,
        cargo_message: Option<String>,
    ) -> Result<BuildArtifactScan, String> {
        let current_root = self
            .root
            .as_ref()
            .filter(|root| root.id == root_id && root.path == root_path)
            .ok_or_else(|| "The build artifact root changed while scanning".to_string())?;
        if current_root.max_depth != max_depth {
            return Err("The scan depth changed while scanning".to_string());
        }
        if self.pending_scan_id.as_deref() != Some(scan_id.as_str()) {
            return Err("A newer build artifact scan replaced this request".to_string());
        }

        let mut candidates = HashMap::new();
        let mut response_candidates = Vec::with_capacity(discovery.candidates.len());
        for discovered in discovery.candidates {
            let candidate_id = self.next_identifier("candidate");
            let record = CandidateRecord {
                id: candidate_id.clone(),
                project_path: discovered.project_path,
                target_path: discovered.target_path,
                status: discovered.status,
                message: discovered.message,
                measurement: pending_measurement(),
            };
            response_candidates.push(record.response());
            candidates.insert(candidate_id, record);
        }

        let status = if discovery.skipped == 0 {
            BuildArtifactScanStatus::Ready
        } else {
            BuildArtifactScanStatus::Partial
        };
        self.scan = Some(ScanSession {
            id: scan_id.clone(),
            root_id: root_id.to_string(),
            root_path: root_path.clone(),
            candidates,
        });
        self.pending_scan_id = None;

        Ok(BuildArtifactScan {
            root_id: root_id.to_string(),
            scan_id,
            root_path: root_path.display().to_string(),
            max_depth,
            status,
            candidates: response_candidates,
            skipped: discovery.skipped,
            errors: discovery.errors,
            cargo_available,
            cargo_message,
        })
    }

    fn candidate(&self, scan_id: &str, candidate_id: &str) -> Result<CandidateRecord, String> {
        let scan = self.current_scan(scan_id)?;
        scan.candidates
            .get(candidate_id)
            .cloned()
            .ok_or_else(|| "The build directory candidate is not part of this scan".to_string())
    }

    fn apply_measurement(
        &mut self,
        scan_id: &str,
        candidate_id: &str,
        measurement: BuildArtifactMeasurement,
    ) -> Result<BuildArtifactMeasurement, String> {
        let scan = self.current_scan_mut(scan_id)?;
        let candidate = scan
            .candidates
            .get_mut(candidate_id)
            .ok_or_else(|| "The build directory candidate is not part of this scan".to_string())?;
        candidate.measurement = measurement.clone();
        Ok(measurement)
    }

    fn cleanup_context(
        &self,
        scan_id: &str,
        candidate_id: &str,
    ) -> Result<(PathBuf, CandidateRecord), String> {
        let scan = self.current_scan(scan_id)?;
        let candidate =
            scan.candidates.get(candidate_id).cloned().ok_or_else(|| {
                "The build directory candidate is not part of this scan".to_string()
            })?;
        Ok((scan.root_path.clone(), candidate))
    }

    fn apply_cleanup_result(
        &mut self,
        scan_id: &str,
        result: &BuildArtifactCleanupResult,
    ) -> Result<(), String> {
        let scan = self.current_scan_mut(scan_id)?;
        let candidate = scan
            .candidates
            .get_mut(&result.candidate_id)
            .ok_or_else(|| "The build directory candidate is not part of this scan".to_string())?;
        candidate.measurement = result.measurement.clone();
        Ok(())
    }

    fn root_path(&self, root_id: &str) -> Result<PathBuf, String> {
        self.root
            .as_ref()
            .filter(|root| root.id == root_id)
            .map(|root| root.path.clone())
            .ok_or_else(|| "The selected build artifact root is no longer authorized".to_string())
    }

    fn candidate_path(
        &self,
        scan_id: &str,
        candidate_id: &str,
        target: BuildArtifactOpenTarget,
    ) -> Result<PathBuf, String> {
        let candidate = self.candidate(scan_id, candidate_id)?;
        Ok(match target {
            BuildArtifactOpenTarget::Project => candidate.project_path,
            BuildArtifactOpenTarget::Target => candidate.target_path,
        })
    }

    fn current_scan(&self, scan_id: &str) -> Result<&ScanSession, String> {
        let scan = self
            .scan
            .as_ref()
            .filter(|scan| scan.id == scan_id)
            .ok_or_else(|| {
                "The build artifact scan is stale; scan again before continuing".to_string()
            })?;
        let root_matches = self
            .root
            .as_ref()
            .is_some_and(|root| root.id == scan.root_id && root.path == scan.root_path);
        if !root_matches {
            return Err("The authorized root changed after this scan".to_string());
        }
        Ok(scan)
    }

    fn current_scan_mut(&mut self, scan_id: &str) -> Result<&mut ScanSession, String> {
        let root = self
            .root
            .as_ref()
            .map(|root| (root.id.clone(), root.path.clone()));
        let scan = self
            .scan
            .as_mut()
            .filter(|scan| scan.id == scan_id)
            .ok_or_else(|| {
                "The build artifact scan is stale; scan again before continuing".to_string()
            })?;
        if root.as_ref() != Some(&(scan.root_id.clone(), scan.root_path.clone())) {
            return Err("The authorized root changed after this scan".to_string());
        }
        Ok(scan)
    }

    fn next_identifier(&mut self, prefix: &str) -> String {
        let value = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        format!("{prefix}-{value}")
    }

    fn persist(&self) -> Result<(), String> {
        let Some(root_path) = self.persisted_root_path.as_ref() else {
            return Ok(());
        };
        if let Some(parent) = self.settings_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                format!("Could not create build artifact settings directory: {err}")
            })?;
        }
        let settings = PersistedSettings {
            root_path: root_path.display().to_string(),
            max_depth: self.max_depth,
        };
        let raw = serde_json::to_vec_pretty(&settings)
            .map_err(|err| format!("Could not serialize build artifact settings: {err}"))?;
        fs::write(&self.settings_path, raw)
            .map_err(|err| format!("Could not save build artifact settings: {err}"))
    }
}

impl CandidateRecord {
    fn response(&self) -> BuildArtifactCandidate {
        BuildArtifactCandidate {
            candidate_id: self.id.clone(),
            project_path: self.project_path.display().to_string(),
            target_path: self.target_path.display().to_string(),
            status: self.status,
            message: self.message.clone(),
            measurement: self.measurement.clone(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct Discovery {
    candidates: Vec<DiscoveredCandidate>,
    skipped: usize,
    errors: Vec<BuildArtifactScanError>,
}

#[derive(Debug)]
struct DiscoveredCandidate {
    project_path: PathBuf,
    target_path: PathBuf,
    status: BuildArtifactCandidateStatus,
    message: Option<String>,
}

pub(crate) fn discover_build_artifacts(root: &Path, max_depth: u8) -> Discovery {
    let mut discovery = Discovery {
        candidates: Vec::new(),
        skipped: 0,
        errors: Vec::new(),
    };
    let mut pending = vec![(root.to_path_buf(), 0_u8)];

    while let Some((directory, depth)) = pending.pop() {
        if is_cargo_project(&directory) {
            if let Some(candidate) = inspect_candidate(&directory) {
                discovery.candidates.push(candidate);
            }
        }
        if depth >= max_depth {
            continue;
        }

        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(err) => {
                discovery.record_error(&directory, err.to_string());
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    discovery.record_error(&directory, err.to_string());
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(err) => {
                    discovery.record_error(&path, err.to_string());
                    continue;
                }
            };
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }
            if should_prune(entry.file_name().to_string_lossy().as_ref()) {
                continue;
            }
            pending.push((path, depth.saturating_add(1)));
        }
    }

    discovery
        .candidates
        .sort_by(|left, right| left.target_path.cmp(&right.target_path));
    discovery
}

impl Discovery {
    fn record_error(&mut self, path: &Path, message: String) {
        self.skipped = self.skipped.saturating_add(1);
        if self.errors.len() < MAX_REPORTED_SCAN_ERRORS {
            self.errors.push(BuildArtifactScanError {
                path: path.display().to_string(),
                message,
            });
        }
    }
}

fn should_prune(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "target"
                | "node_modules"
                | "dist"
                | "build"
                | "__pycache__"
                | ".tox"
                | "venv"
                | ".venv"
                | ".idea"
                | ".vscode"
        )
}

fn is_cargo_project(directory: &Path) -> bool {
    is_regular_file(&directory.join("Cargo.toml"))
}

fn inspect_candidate(project_path: &Path) -> Option<DiscoveredCandidate> {
    let target_path = project_path.join("target");
    let metadata = match fs::symlink_metadata(&target_path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            return Some(DiscoveredCandidate {
                project_path: project_path.to_path_buf(),
                target_path,
                status: BuildArtifactCandidateStatus::Unrecognized,
                message: Some(format!("Could not inspect target: {err}")),
            })
        }
    };

    let (status, message) = if metadata.file_type().is_symlink() {
        (
            BuildArtifactCandidateStatus::Symlink,
            Some("The target path is a symbolic link".to_string()),
        )
    } else if !metadata.is_dir() {
        (
            BuildArtifactCandidateStatus::NotDirectory,
            Some("The target path is not a directory".to_string()),
        )
    } else if has_cargo_marker(&target_path) {
        (BuildArtifactCandidateStatus::Ready, None)
    } else {
        (
            BuildArtifactCandidateStatus::Unrecognized,
            Some("No root-level CACHEDIR.TAG or .rustc_info.json was found".to_string()),
        )
    };

    Some(DiscoveredCandidate {
        project_path: project_path.to_path_buf(),
        target_path,
        status,
        message,
    })
}

fn has_cargo_marker(target_path: &Path) -> bool {
    ["CACHEDIR.TAG", ".rustc_info.json"]
        .iter()
        .any(|name| is_regular_file(&target_path.join(name)))
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

pub(crate) fn measure_build_artifact(path: &Path) -> BuildArtifactMeasurement {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return missing_measurement(),
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return failed_measurement(BuildArtifactMeasurementStatus::PermissionDenied, err)
        }
        Err(err) => return failed_measurement(BuildArtifactMeasurementStatus::Error, err),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return BuildArtifactMeasurement {
            status: BuildArtifactMeasurementStatus::Error,
            bytes: None,
            human: None,
            files: 0,
            directories: 0,
            skipped: 0,
            latest_modified_ms: None,
            message: Some("Build artifact target is not a regular directory".to_string()),
        };
    }

    let mut stats = MeasurementStats::default();
    let mut seen = HashSet::new();
    measure_directory(path, &mut stats, &mut seen);
    let status = if stats.skipped == 0 {
        BuildArtifactMeasurementStatus::Ready
    } else {
        BuildArtifactMeasurementStatus::Partial
    };
    BuildArtifactMeasurement {
        status,
        bytes: Some(stats.bytes),
        human: Some(format_bytes(stats.bytes)),
        files: stats.files,
        directories: stats.directories,
        skipped: stats.skipped,
        latest_modified_ms: stats.latest_modified_ms,
        message: stats.first_error,
    }
}

#[derive(Default)]
struct MeasurementStats {
    bytes: u64,
    files: u64,
    directories: u64,
    skipped: u64,
    latest_modified_ms: Option<u64>,
    first_error: Option<String>,
}

fn measure_directory(path: &Path, stats: &mut MeasurementStats, seen: &mut HashSet<(u64, u64)>) {
    stats.directories = stats.directories.saturating_add(1);
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(err) => {
            stats.record_skip(path, err);
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                stats.record_skip(path, err);
                continue;
            }
        };
        let entry_path = entry.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(err) => {
                stats.record_skip(&entry_path, err);
                continue;
            }
        };
        if metadata.file_type().is_symlink() || metadata.is_file() {
            add_measured_file(stats, seen, &metadata);
        } else if metadata.is_dir() {
            measure_directory(&entry_path, stats, seen);
        }
    }
}

impl MeasurementStats {
    fn record_skip(&mut self, path: &Path, error: std::io::Error) {
        self.skipped = self.skipped.saturating_add(1);
        if self.first_error.is_none() {
            self.first_error = Some(format!("Could not measure {}: {error}", path.display()));
        }
    }
}

#[cfg(unix)]
fn add_measured_file(
    stats: &mut MeasurementStats,
    seen: &mut HashSet<(u64, u64)>,
    metadata: &fs::Metadata,
) {
    let key = (metadata.dev(), metadata.ino());
    if seen.insert(key) {
        stats.files = stats.files.saturating_add(1);
        stats.bytes = stats
            .bytes
            .saturating_add(metadata.blocks().saturating_mul(512));
        update_latest_modified(stats, metadata.modified().ok());
    }
}

#[cfg(not(unix))]
fn add_measured_file(
    stats: &mut MeasurementStats,
    _seen: &mut HashSet<(u64, u64)>,
    metadata: &fs::Metadata,
) {
    stats.files = stats.files.saturating_add(1);
    stats.bytes = stats.bytes.saturating_add(metadata.len());
    update_latest_modified(stats, metadata.modified().ok());
}

fn update_latest_modified(stats: &mut MeasurementStats, modified: Option<SystemTime>) {
    let Some(milliseconds) = modified
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
    else {
        return;
    };
    stats.latest_modified_ms = Some(
        stats
            .latest_modified_ms
            .map(|current| current.max(milliseconds))
            .unwrap_or(milliseconds),
    );
}

fn pending_measurement() -> BuildArtifactMeasurement {
    BuildArtifactMeasurement {
        status: BuildArtifactMeasurementStatus::Pending,
        bytes: None,
        human: None,
        files: 0,
        directories: 0,
        skipped: 0,
        latest_modified_ms: None,
        message: None,
    }
}

fn missing_measurement() -> BuildArtifactMeasurement {
    BuildArtifactMeasurement {
        status: BuildArtifactMeasurementStatus::Missing,
        bytes: Some(0),
        human: Some("0 B".to_string()),
        files: 0,
        directories: 0,
        skipped: 0,
        latest_modified_ms: None,
        message: Some("Build directory no longer exists".to_string()),
    }
}

fn failed_measurement(
    status: BuildArtifactMeasurementStatus,
    error: std::io::Error,
) -> BuildArtifactMeasurement {
    BuildArtifactMeasurement {
        status,
        bytes: None,
        human: None,
        files: 0,
        directories: 0,
        skipped: 0,
        latest_modified_ms: None,
        message: Some(error.to_string()),
    }
}

pub(crate) fn run_build_artifact_cleanup_with_runner<F>(
    root: &Path,
    candidate: &CandidateRecord,
    runner: &F,
) -> BuildArtifactCleanupResult
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let before_bytes = candidate.measurement.bytes.unwrap_or(0);
    if candidate.status != BuildArtifactCandidateStatus::Ready
        || candidate.measurement.status != BuildArtifactMeasurementStatus::Ready
        || candidate.measurement.skipped != 0
    {
        return rejected_cleanup(
            candidate,
            before_bytes,
            "The candidate is not verified and fully measured",
        );
    }

    match validate_for_cleanup(root, candidate) {
        Ok(Validation::Missing) => {
            return BuildArtifactCleanupResult {
                candidate_id: candidate.id.clone(),
                status: BuildArtifactCleanupStatus::Skipped,
                command: None,
                before_bytes,
                after_bytes: 0,
                released_bytes: 0,
                measurement: missing_measurement(),
                stdout: String::new(),
                stderr: String::new(),
                message: Some("Build directory no longer exists; nothing was run".to_string()),
                failure: None,
            }
        }
        Err(message) => return rejected_cleanup(candidate, before_bytes, &message),
        Ok(Validation::Ready) => {}
    }

    let manifest_path = candidate.project_path.join("Cargo.toml");
    let args = vec![
        "clean".to_string(),
        "--offline".to_string(),
        "--manifest-path".to_string(),
        manifest_path.display().to_string(),
        "--target-dir".to_string(),
        candidate.target_path.display().to_string(),
    ];
    let command = envelope_owned("cargo", args.clone(), CLEAN_TIMEOUT.as_millis() as u64);
    let run = runner("cargo", &args, CLEAN_TIMEOUT);
    let measurement = measure_build_artifact(&candidate.target_path);
    let measurement_complete = matches!(
        measurement.status,
        BuildArtifactMeasurementStatus::Ready | BuildArtifactMeasurementStatus::Missing
    );
    let after_bytes = if measurement_complete {
        measurement.bytes.unwrap_or(before_bytes)
    } else {
        before_bytes
    };
    let released_bytes = before_bytes.saturating_sub(after_bytes);

    match run {
        Ok(run) if run.exit_code == Some(0) => BuildArtifactCleanupResult {
            candidate_id: candidate.id.clone(),
            status: if measurement_complete {
                BuildArtifactCleanupStatus::Succeeded
            } else {
                BuildArtifactCleanupStatus::PartiallyCompleted
            },
            command: Some(command),
            before_bytes,
            after_bytes,
            released_bytes,
            measurement,
            stdout: run.stdout,
            stderr: run.stderr,
            message: (!measurement_complete).then(|| {
                "cargo clean succeeded, but remaining disk usage could not be measured completely"
                    .to_string()
            }),
            failure: None,
        },
        Ok(run) => {
            let stdout = run.stdout.clone();
            let stderr = run.stderr.clone();
            let failure = command_failure(FailureKind::CommandFailed, "cargo clean failed", run);
            failed_cleanup(
                candidate,
                command,
                before_bytes,
                after_bytes,
                released_bytes,
                measurement,
                stdout,
                stderr,
                failure,
            )
        }
        Err(failure) => {
            let stdout = failure.stdout.clone();
            let stderr = failure.stderr.clone();
            failed_cleanup(
                candidate,
                command,
                before_bytes,
                after_bytes,
                released_bytes,
                measurement,
                stdout,
                stderr,
                failure,
            )
        }
    }
}

fn failed_cleanup(
    candidate: &CandidateRecord,
    command: CommandEnvelope,
    before_bytes: u64,
    after_bytes: u64,
    released_bytes: u64,
    measurement: BuildArtifactMeasurement,
    stdout: String,
    stderr: String,
    failure: CommandFailure,
) -> BuildArtifactCleanupResult {
    BuildArtifactCleanupResult {
        candidate_id: candidate.id.clone(),
        status: if released_bytes > 0 {
            BuildArtifactCleanupStatus::PartiallyCompleted
        } else {
            BuildArtifactCleanupStatus::Failed
        },
        command: Some(command),
        before_bytes,
        after_bytes,
        released_bytes,
        measurement,
        stdout,
        stderr,
        message: Some(failure.message.clone()),
        failure: Some(failure),
    }
}

fn rejected_cleanup(
    candidate: &CandidateRecord,
    before_bytes: u64,
    message: &str,
) -> BuildArtifactCleanupResult {
    BuildArtifactCleanupResult {
        candidate_id: candidate.id.clone(),
        status: BuildArtifactCleanupStatus::Rejected,
        command: None,
        before_bytes,
        after_bytes: before_bytes,
        released_bytes: 0,
        measurement: candidate.measurement.clone(),
        stdout: String::new(),
        stderr: String::new(),
        message: Some(message.to_string()),
        failure: None,
    }
}

enum Validation {
    Ready,
    Missing,
}

fn validate_for_cleanup(root: &Path, candidate: &CandidateRecord) -> Result<Validation, String> {
    let root = canonical_directory(root)?;
    let metadata = match fs::symlink_metadata(&candidate.target_path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Validation::Missing),
        Err(err) => return Err(format!("Could not revalidate target: {err}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The target path changed and is no longer a regular directory".to_string());
    }
    if candidate
        .target_path
        .file_name()
        .and_then(|name| name.to_str())
        != Some("target")
        || candidate.target_path.parent() != Some(candidate.project_path.as_path())
    {
        return Err(
            "The target path is no longer directly owned by the scanned project".to_string(),
        );
    }
    let manifest_path = candidate.project_path.join("Cargo.toml");
    if !is_regular_file(&manifest_path) {
        return Err("The project's Cargo.toml is missing or is not a regular file".to_string());
    }
    if !has_cargo_marker(&candidate.target_path) {
        return Err("The target no longer contains a trusted Cargo marker".to_string());
    }

    let project = fs::canonicalize(&candidate.project_path)
        .map_err(|err| format!("Could not resolve project directory: {err}"))?;
    let target = fs::canonicalize(&candidate.target_path)
        .map_err(|err| format!("Could not resolve target directory: {err}"))?;
    if !project.starts_with(&root)
        || !target.starts_with(&root)
        || target.parent() != Some(project.as_path())
    {
        return Err("The project or target escaped the authorized scan root".to_string());
    }
    Ok(Validation::Ready)
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|err| format!("Could not resolve {}: {err}", path.display()))?;
    let metadata = fs::symlink_metadata(&canonical)
        .map_err(|err| format!("Could not inspect {}: {err}", canonical.display()))?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    Ok(canonical)
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::envelope;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn discovers_only_direct_target_candidates_and_prunes_hidden_directories() {
        let root = temp_dir("discover");
        let _guard = TempDirGuard(root.clone());
        create_project(&root.join("valid"), Some("CACHEDIR.TAG"));
        create_project(&root.join("unknown"), None);
        create_project(&root.join(".hidden/project"), Some("CACHEDIR.TAG"));
        fs::create_dir_all(root.join("bare/target")).expect("create bare target");

        let discovery = discover_build_artifacts(&root, 8);

        assert_eq!(discovery.candidates.len(), 2);
        assert_eq!(
            discovery.candidates[0].status,
            BuildArtifactCandidateStatus::Unrecognized
        );
        assert_eq!(
            discovery.candidates[1].status,
            BuildArtifactCandidateStatus::Ready
        );
        assert!(discovery
            .candidates
            .iter()
            .all(|candidate| !candidate.target_path.to_string_lossy().contains(".hidden")));
    }

    #[test]
    fn scan_depth_zero_checks_only_the_root_project() {
        let root = temp_dir("depth");
        let _guard = TempDirGuard(root.clone());
        create_project(&root, Some("CACHEDIR.TAG"));
        create_project(&root.join("nested"), Some("CACHEDIR.TAG"));

        let discovery = discover_build_artifacts(&root, 0);

        assert_eq!(discovery.candidates.len(), 1);
        assert_eq!(discovery.candidates[0].project_path, root);
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_target_is_never_ready() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("symlink");
        let _guard = TempDirGuard(root.clone());
        fs::create_dir_all(root.join("project")).expect("create project");
        fs::write(
            root.join("project/Cargo.toml"),
            "[package]\nname='x'\nversion='0.1.0'",
        )
        .expect("write manifest");
        fs::create_dir_all(root.join("shared")).expect("create shared");
        symlink(root.join("shared"), root.join("project/target")).expect("link target");

        let discovery = discover_build_artifacts(&root, 8);

        assert_eq!(discovery.candidates.len(), 1);
        assert_eq!(
            discovery.candidates[0].status,
            BuildArtifactCandidateStatus::Symlink
        );
    }

    #[test]
    fn measurement_reports_latest_file_time_and_complete_size() {
        let root = temp_dir("measurement");
        let _guard = TempDirGuard(root.clone());
        fs::create_dir_all(root.join("debug")).expect("create directory");
        fs::write(root.join("CACHEDIR.TAG"), "cache").expect("write marker");
        fs::write(root.join("debug/app"), vec![1_u8; 2048]).expect("write artifact");

        let measurement = measure_build_artifact(&root);

        assert_eq!(measurement.status, BuildArtifactMeasurementStatus::Ready);
        assert!(measurement.bytes.unwrap_or(0) > 0);
        assert!(measurement.latest_modified_ms.is_some());
        assert_eq!(measurement.skipped, 0);
    }

    #[test]
    fn registry_invalidates_old_scan_when_root_changes() {
        let first = temp_dir("registry-first");
        let second = temp_dir("registry-second");
        let _first_guard = TempDirGuard(first.clone());
        let _second_guard = TempDirGuard(second.clone());
        create_project(&first.join("project"), Some("CACHEDIR.TAG"));
        let settings = first.join("settings.json");
        let mut registry = Registry::load(settings);
        let first_settings = registry
            .authorize_root(first.clone())
            .expect("authorize first");
        let root_id = first_settings.root_id.expect("root id");
        let (root_path, depth, scan_id) = registry.prepare_scan(&root_id, 8).expect("prepare scan");
        let scan = registry
            .install_scan(
                &root_id,
                scan_id,
                root_path,
                depth,
                discover_build_artifacts(&first, 8),
                true,
                None,
            )
            .expect("install scan");

        registry.authorize_root(second).expect("authorize second");

        assert!(registry.current_scan(&scan.scan_id).is_err());
    }

    #[test]
    fn newer_scan_request_prevents_an_older_result_from_overwriting_it() {
        let root = temp_dir("scan-race");
        let _guard = TempDirGuard(root.clone());
        create_project(&root.join("project"), Some("CACHEDIR.TAG"));
        let mut registry = Registry::load(root.join("settings.json"));
        let root_id = registry
            .authorize_root(root.clone())
            .expect("authorize root")
            .root_id
            .expect("root id");
        let (first_root, first_depth, first_scan_id) =
            registry.prepare_scan(&root_id, 8).expect("prepare first");
        let (second_root, second_depth, second_scan_id) =
            registry.prepare_scan(&root_id, 8).expect("prepare second");

        assert!(registry
            .install_scan(
                &root_id,
                first_scan_id,
                first_root,
                first_depth,
                discover_build_artifacts(&root, 8),
                true,
                None,
            )
            .is_err());
        let installed = registry
            .install_scan(
                &root_id,
                second_scan_id.clone(),
                second_root,
                second_depth,
                discover_build_artifacts(&root, 8),
                true,
                None,
            )
            .expect("install latest scan");

        assert_eq!(installed.scan_id, second_scan_id);
    }

    #[test]
    fn cleanup_uses_fixed_offline_cargo_arguments() {
        let root = temp_dir("cleanup");
        let _guard = TempDirGuard(root.clone());
        let project = root.join("project");
        create_project(&project, Some("CACHEDIR.TAG"));
        fs::write(project.join("target/artifact"), vec![1_u8; 1024]).expect("write artifact");
        let target = project.join("target");
        let candidate = CandidateRecord {
            id: "candidate-1".to_string(),
            project_path: project.clone(),
            target_path: target.clone(),
            status: BuildArtifactCandidateStatus::Ready,
            message: None,
            measurement: measure_build_artifact(&target),
        };

        let result =
            run_build_artifact_cleanup_with_runner(&root, &candidate, &|program, args, timeout| {
                assert_eq!(program, "cargo");
                assert_eq!(timeout, Duration::from_secs(300));
                assert_eq!(
                    args,
                    &[
                        "clean".to_string(),
                        "--offline".to_string(),
                        "--manifest-path".to_string(),
                        project.join("Cargo.toml").display().to_string(),
                        "--target-dir".to_string(),
                        target.display().to_string(),
                    ]
                );
                Ok(CommandRun {
                    envelope: envelope(program, &[], timeout.as_millis() as u64),
                    stdout: "cleaned".to_string(),
                    stderr: String::new(),
                    exit_code: Some(0),
                    duration_ms: 1,
                })
            });

        assert_eq!(result.status, BuildArtifactCleanupStatus::Succeeded);
        assert_eq!(
            result.command.expect("command").args,
            vec![
                "clean",
                "--offline",
                "--manifest-path",
                project.join("Cargo.toml").to_str().expect("manifest"),
                "--target-dir",
                target.to_str().expect("target"),
            ]
        );
    }

    #[test]
    fn successful_command_does_not_claim_released_bytes_when_remeasurement_fails() {
        let root = temp_dir("incomplete-remeasurement");
        let _guard = TempDirGuard(root.clone());
        let project = root.join("project");
        create_project(&project, Some("CACHEDIR.TAG"));
        fs::write(project.join("target/artifact"), vec![1_u8; 1024]).expect("write artifact");
        let target = project.join("target");
        let candidate = CandidateRecord {
            id: "candidate-1".to_string(),
            project_path: project,
            target_path: target.clone(),
            status: BuildArtifactCandidateStatus::Ready,
            message: None,
            measurement: measure_build_artifact(&target),
        };

        let result =
            run_build_artifact_cleanup_with_runner(&root, &candidate, &|program, _, timeout| {
                fs::remove_dir_all(&target).expect("remove target");
                fs::write(&target, "not a directory").expect("replace target with file");
                Ok(CommandRun {
                    envelope: envelope(program, &[], timeout.as_millis() as u64),
                    stdout: "cleaned".to_string(),
                    stderr: String::new(),
                    exit_code: Some(0),
                    duration_ms: 1,
                })
            });

        assert_eq!(
            result.status,
            BuildArtifactCleanupStatus::PartiallyCompleted
        );
        assert_eq!(result.released_bytes, 0);
        assert_eq!(
            result.measurement.status,
            BuildArtifactMeasurementStatus::Error
        );
    }

    #[test]
    fn cleanup_skips_a_target_that_disappeared_after_scan() {
        let root = temp_dir("missing-cleanup");
        let _guard = TempDirGuard(root.clone());
        let project = root.join("project");
        create_project(&project, Some("CACHEDIR.TAG"));
        let target = project.join("target");
        let measurement = measure_build_artifact(&target);
        fs::remove_dir_all(&target).expect("remove target");
        let candidate = CandidateRecord {
            id: "candidate-1".to_string(),
            project_path: project,
            target_path: target,
            status: BuildArtifactCandidateStatus::Ready,
            message: None,
            measurement,
        };

        let result = run_build_artifact_cleanup_with_runner(&root, &candidate, &|_, _, _| {
            panic!("cargo must not run for a missing target")
        });

        assert_eq!(result.status, BuildArtifactCleanupStatus::Skipped);
        assert_eq!(result.released_bytes, 0);
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_a_target_replaced_by_a_symbolic_link() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("swapped-target");
        let _guard = TempDirGuard(root.clone());
        let project = root.join("project");
        create_project(&project, Some("CACHEDIR.TAG"));
        let target = project.join("target");
        let candidate = CandidateRecord {
            id: "candidate-1".to_string(),
            project_path: project.clone(),
            target_path: target.clone(),
            status: BuildArtifactCandidateStatus::Ready,
            message: None,
            measurement: measure_build_artifact(&target),
        };
        fs::remove_dir_all(&target).expect("remove original target");
        fs::create_dir_all(root.join("shared")).expect("create shared target");
        fs::write(root.join("shared/CACHEDIR.TAG"), "marker").expect("write shared marker");
        symlink(root.join("shared"), &target).expect("replace target with symlink");

        let result = run_build_artifact_cleanup_with_runner(&root, &candidate, &|_, _, _| {
            panic!("cargo must not run for a symbolic link")
        });

        assert_eq!(result.status, BuildArtifactCleanupStatus::Rejected);
        assert_eq!(result.released_bytes, 0);
    }

    fn create_project(path: &Path, marker: Option<&str>) {
        fs::create_dir_all(path.join("target")).expect("create target");
        fs::write(
            path.join("Cargo.toml"),
            "[package]\nname='x'\nversion='0.1.0'",
        )
        .expect("write manifest");
        if let Some(marker) = marker {
            fs::write(path.join("target").join(marker), "marker").expect("write marker");
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "package-manager-build-artifacts-{label}-{}-{suffix}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp directory");
        path
    }

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
