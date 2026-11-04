//! Conservative, scoped POM reference analysis. This deliberately protects all
//! versions of a referenced GA; it does not emulate Maven's effective model.

use crate::observed_file::ObservedFile;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_DIRECTORIES: usize = 100_000;
const MAX_CANDIDATES: usize = 2_000;
const MAX_SELECTION: usize = 200;
const MAX_MODELS: usize = 10_000;
const MAX_SCAN_TIME: Duration = Duration::from_secs(30);

#[path = "maven_model.rs"]
mod models;

struct ModelBudget {
    started: Instant,
    models: usize,
    max_models: usize,
}

impl ModelBudget {
    fn check_time(&self, phase: &str) -> Result<(), String> {
        let elapsed = self.started.elapsed();
        if elapsed > MAX_SCAN_TIME {
            return Err(format!(
                "{phase}已耗时 {:.1} 秒，超过 {} 秒上限（已读取 {} 个 POM）；未生成清理候选",
                elapsed.as_secs_f64(),
                MAX_SCAN_TIME.as_secs(),
                self.models,
            ));
        }
        Ok(())
    }

    fn before_read(&mut self, phase: &str) -> Result<(), String> {
        self.check_time(phase)?;
        if self.models >= self.max_models {
            return Err(format!(
                "{phase}已读取 {} 个 POM，达到 {} 个上限；未生成清理候选",
                self.models, self.max_models,
            ));
        }
        self.models += 1;
        Ok(())
    }
}

#[derive(Clone, Default)]
pub(crate) struct MavenUnusedState(Arc<Mutex<Option<Session>>>);

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReferenceMode {
    #[default]
    Complete,
    Available,
}

struct Session {
    id: String,
    analysis: Analysis,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Scan {
    pub scan_id: String,
    pub scanned_at: u64,
    pub repository: String,
    pub roots: Vec<String>,
    pub projects: usize,
    pub versions: usize,
    pub protected_versions: usize,
    pub excluded_versions: usize,
    pub reference_mode: ReferenceMode,
    pub missing_models: Vec<String>,
    pub blockers: Vec<String>,
    pub candidates: Vec<Candidate>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    pub id: String,
    pub coordinate: String,
    pub version: String,
    pub path: String,
    pub bytes: u64,
    #[serde(skip)]
    signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Outcome {
    pub moved: usize,
    pub skipped: usize,
    pub failed: usize,
    pub items: Vec<RemovalItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemovalItem {
    pub id: String,
    pub status: &'static str,
    pub message: Option<String>,
}

struct Analysis {
    repository: PathBuf,
    roots: Vec<PathBuf>,
    projects: usize,
    versions: usize,
    protected_versions: usize,
    excluded_versions: usize,
    reference_mode: ReferenceMode,
    missing_models: Vec<String>,
    blockers: Vec<String>,
    candidates: Vec<Candidate>,
    inputs: Vec<ObservedFile>,
    archives: Vec<models::ArchiveObservation>,
    directories: Vec<ObservedDirectory>,
}

struct ObservedDirectory {
    path: PathBuf,
    metadata: fs::Metadata,
    names: BTreeSet<std::ffi::OsString>,
    project: bool,
}

impl ObservedDirectory {
    fn unchanged(&self, moved: &[PathBuf]) -> bool {
        if moved.iter().any(|path| self.path.starts_with(path)) {
            return true;
        }
        let Ok(next) = fs::symlink_metadata(&self.path) else {
            return false;
        };
        if !next.is_dir() || next.file_type().is_symlink() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if (self.metadata.dev(), self.metadata.ino()) != (next.dev(), next.ino()) {
                return false;
            }
        }
        if self.metadata.modified().ok() == next.modified().ok()
            && !moved
                .iter()
                .any(|path| path.parent() == Some(self.path.as_path()))
        {
            return true;
        }
        let Ok(entries) = fs::read_dir(&self.path) else {
            return false;
        };
        let Ok(names) = entries
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<Result<BTreeSet<_>, _>>()
        else {
            return false;
        };
        let names: BTreeSet<_> = names
            .into_iter()
            .filter(|name| !self.project || !ignored_project_name(name))
            .collect();
        let expected: BTreeSet<_> = self
            .names
            .iter()
            .filter(|name| !moved.contains(&self.path.join(name)))
            .cloned()
            .collect();
        names == expected
    }
}

fn ignored_project_name(name: &std::ffi::OsStr) -> bool {
    // Agent directories contain linked skills and example projects, rather than
    // automatically discovered Maven projects. Explicit POM modules are read
    // separately even when their paths are under one of these directories.
    matches!(
        name.to_str(),
        Some(
            ".git"
                | "target"
                | "node_modules"
                | ".fvm"
                | ".dart_tool"
                | ".symlinks"
                | ".agents"
                | ".claude"
                | ".codex"
                | ".grok"
                | ".opencode"
                | ".workbuddy"
                | ".superpowers"
        )
    )
}

struct Version {
    ga: String,
    version: String,
    path: PathBuf,
    poms: Vec<PathBuf>,
    remote: bool,
    bytes: u64,
    signature: String,
}

#[derive(Clone, Default)]
struct Pom {
    ga: Option<String>,
    version: Option<String>,
    properties: BTreeMap<String, BTreeSet<String>>,
    raw_references: Vec<(String, String)>,
    references: BTreeSet<String>,
    parent_path: Option<PathBuf>,
    modules: Vec<PathBuf>,
    plugin: bool,
}

impl MavenUnusedState {
    pub fn scan(&self, roots: Vec<PathBuf>, mode: ReferenceMode) -> Result<Scan, String> {
        let mut session = self.0.try_lock().map_err(|_| "Maven 分析或清理正在执行")?;
        // A failed new scan must not leave the previous deletion authorization live.
        *session = None;
        let repository = crate::managers::maven_repository_for_maintenance()?;
        let analysis = analyze_with_mode(&repository, &roots, mode)?;
        let id = format!("maven-{}", random_id());
        let scan = analysis.view(id.clone());
        *session = Some(Session { id, analysis });
        Ok(scan)
    }

    pub fn remove(
        &self,
        scan_id: &str,
        ids: &[String],
        history: &crate::maintenance_history::MaintenanceHistoryState,
    ) -> Result<crate::maintenance_operation::Receipt<Outcome>, String> {
        let repository = crate::managers::maven_repository_for_maintenance()?;
        let (scope, selected) = {
            let state = self.0.try_lock().map_err(|_| "Maven 分析或清理正在执行")?;
            let session = state
                .as_ref()
                .filter(|session| session.id == scan_id)
                .ok_or("扫描已失效，请重新扫描")?;
            if ids.is_empty()
                || ids.len() > MAX_SELECTION
                || ids.iter().collect::<HashSet<_>>().len() != ids.len()
            {
                return Err("请选择不重复的构件版本，每批最多 200 个".into());
            }
            let selected = ids
                .iter()
                .map(|id| {
                    session
                        .analysis
                        .candidates
                        .iter()
                        .find(|candidate| &candidate.id == id)
                        .cloned()
                        .ok_or("选择不属于扫描范围")
                })
                .collect::<Result<Vec<_>, _>>()?;
            (
                format!(
                    "本地仓库：{}；检查方式：{}；缺失模型：{} 个；项目：{}",
                    session.analysis.repository.display(),
                    if session.analysis.reference_mode == ReferenceMode::Complete {
                        "完整传递引用"
                    } else {
                        "仅本地已有 POM"
                    },
                    session.analysis.missing_models.len(),
                    session
                        .analysis
                        .roots
                        .iter()
                        .map(|path| path.display().to_string())
                        .collect::<Vec<_>>()
                        .join("、")
                ),
                selected,
            )
        };
        crate::maintenance_adapters::remove_maven_artifacts(history, scope, &selected, |report| {
            self.remove_reporting(
                scan_id,
                ids,
                &repository,
                &mut |path| crate::session_records::move_path_to_trash(path),
                &artifact_in_use,
                report,
            )
        })
    }

    #[cfg(test)]
    fn remove_with(
        &self,
        scan_id: &str,
        ids: &[String],
        repository: &Path,
        trash: &mut dyn FnMut(&Path) -> Result<(), String>,
        in_use: &dyn Fn(&Path) -> Result<bool, String>,
    ) -> Result<Outcome, String> {
        self.remove_reporting(scan_id, ids, repository, trash, in_use, &mut |_| {})
    }

    fn remove_reporting(
        &self,
        scan_id: &str,
        ids: &[String],
        repository: &Path,
        trash: &mut dyn FnMut(&Path) -> Result<(), String>,
        in_use: &dyn Fn(&Path) -> Result<bool, String>,
        report: &mut dyn FnMut(&RemovalItem),
    ) -> Result<Outcome, String> {
        let canonical_repository = repository
            .canonicalize()
            .map_err(|_| "本地仓库位置无法确认")?;
        let repository = canonical_repository.as_path();
        if ids.is_empty() || ids.len() > MAX_SELECTION {
            return Err(format!("每批请选择 1–{MAX_SELECTION} 个构件版本"));
        }
        let mut state = self.0.try_lock().map_err(|_| "Maven 分析或清理正在执行")?;
        let session = state.as_ref().ok_or("请先扫描 Maven 项目")?;
        if session.id != scan_id || session.analysis.repository != repository {
            return Err("扫描已失效或本地仓库位置发生变化，请重新扫描".into());
        }
        let selected: Vec<Candidate> = ids
            .iter()
            .map(|id| {
                session
                    .analysis
                    .candidates
                    .iter()
                    .find(|candidate| &candidate.id == id)
                    .cloned()
                    .ok_or_else(|| "选择包含不属于本次扫描的构件".to_string())
            })
            .collect::<Result<_, _>>()?;
        if ids.iter().collect::<HashSet<_>>().len() != ids.len() {
            return Err("不能重复选择同一个构件版本".into());
        }
        // Rebuild the closure rather than trusting an earlier observation.
        let current = analyze_with_mode(
            repository,
            &session.analysis.roots,
            session.analysis.reference_mode,
        )?;
        if !current.blockers.is_empty() {
            return Err("引用分析不完整，请重新扫描并查看诊断".into());
        }
        if current.missing_models != session.analysis.missing_models {
            return Err("缺失模型范围已变化，请重新扫描并确认清理范围".into());
        }
        *state = None; // Consume this authorization before any filesystem mutation.
        let mut outcome = Outcome {
            moved: 0,
            skipped: 0,
            failed: 0,
            items: Vec::new(),
        };
        let mut moved_paths = Vec::new();
        for candidate in selected {
            let unchanged = current
                .candidates
                .iter()
                .any(|next| next.path == candidate.path && next.signature == candidate.signature);
            let path = Path::new(&candidate.path);
            let check = (|| {
                if !unchanged
                    || !current.inputs.iter().all(|input| {
                        moved_paths.iter().any(|path| input.path.starts_with(path))
                            || input.unchanged()
                    })
                    || !current
                        .directories
                        .iter()
                        .all(|directory| directory.unchanged(&moved_paths))
                    || !current.archives.iter().all(|archive| archive.unchanged())
                {
                    return Err("构件或项目引用已变化，请重新扫描".to_string());
                }
                checked_path(repository, path)?;
                if version_signature(path)?.1 != candidate.signature {
                    return Err("构件内容已变化，请重新扫描".into());
                }
                if in_use(path)? {
                    return Err("构件正在使用，请停止相关构建后重新扫描".into());
                }
                Ok(())
            })();
            let (status, message) = match check {
                Err(message) => {
                    outcome.skipped += 1;
                    ("Skipped", Some(message))
                }
                Ok(()) => match trash(path) {
                    Ok(())
                        if fs::symlink_metadata(path)
                            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
                    {
                        outcome.moved += 1;
                        moved_paths.push(path.to_path_buf());
                        ("Moved", None)
                    }
                    Ok(()) => {
                        outcome.failed += 1;
                        (
                            "Failed",
                            Some("移入操作返回成功，但原目录仍存在或无法核实".into()),
                        )
                    }
                    Err(message) => {
                        outcome.failed += 1;
                        ("Failed", Some(message))
                    }
                },
            };
            let item = RemovalItem {
                id: candidate.id,
                status,
                message,
            };
            report(&item);
            outcome.items.push(item);
        }
        Ok(outcome)
    }
}

impl Analysis {
    fn view(&self, scan_id: String) -> Scan {
        Scan {
            scan_id,
            scanned_at: crate::maintenance_history::now(),
            repository: self.repository.display().to_string(),
            roots: self
                .roots
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
            projects: self.projects,
            versions: self.versions,
            protected_versions: self.protected_versions,
            excluded_versions: self.excluded_versions,
            reference_mode: self.reference_mode,
            missing_models: self.missing_models.clone(),
            blockers: self.blockers.clone(),
            candidates: self.candidates.clone(),
        }
    }
}

fn random_id() -> String {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

fn artifact_in_use(path: &Path) -> Result<bool, String> {
    let path = path.to_str().ok_or("构件路径无法确认")?;
    let run = crate::command::run_command(
        "lsof",
        &["-Fn", "-n", "-P", "+D", path],
        Duration::from_secs(5),
    )
    .map_err(|_| "无法确认构件是否正在使用".to_string())?;
    open_file_probe_result(&run)
}

fn open_file_probe_result(run: &crate::types::CommandRun) -> Result<bool, String> {
    if !matches!(run.exit_code, Some(0 | 1)) || !run.stderr.trim().is_empty() {
        return Err("无法确认构件是否正在使用".into());
    }
    // Only a clean no-match result authorizes moving the directory.
    Ok(run.exit_code != Some(1) || !run.stdout.trim().is_empty())
}

#[cfg(test)]
fn analyze(repository: &Path, roots: &[PathBuf]) -> Result<Analysis, String> {
    analyze_with_mode(repository, roots, ReferenceMode::Complete)
}

fn analyze_with_mode(
    repository: &Path,
    roots: &[PathBuf],
    reference_mode: ReferenceMode,
) -> Result<Analysis, String> {
    if roots.is_empty() || roots.len() > 20 {
        return Err("请选择 1–20 个 Maven 项目目录或项目所在目录".into());
    }
    let repository = repository
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let roots: Vec<PathBuf> = roots
        .iter()
        .map(|root| {
            let root = root
                .canonicalize()
                .map_err(|error| format!("无法读取项目目录：{error}"))?;
            if !root.is_dir() || root.starts_with(&repository) || repository.starts_with(&root) {
                return Err("项目扫描目录不能包含 Maven 本地仓库".into());
            }
            Ok(root)
        })
        .collect::<Result<BTreeSet<_>, String>>()?
        .into_iter()
        .collect();
    let mut analysis = Analysis {
        repository: repository.clone(),
        roots: roots.clone(),
        projects: 0,
        versions: 0,
        protected_versions: 0,
        excluded_versions: 0,
        reference_mode,
        missing_models: Vec::new(),
        blockers: Vec::new(),
        candidates: Vec::new(),
        inputs: Vec::new(),
        archives: Vec::new(),
        directories: Vec::new(),
    };
    let started = Instant::now();
    let mut version_dirs = Vec::new();
    let mut project_poms = BTreeSet::new();
    let mut extensions = BTreeSet::new();
    for root in &roots {
        for ancestor in root.ancestors() {
            let extension = ancestor.join(".mvn/extensions.xml");
            let observed = ObservedFile::read(&extension)
                .map_err(|_| format!("{} 的扩展定义无法确认", extension.display()))?;
            if observed.text.is_some() {
                extensions.insert(extension);
            }
            analysis.inputs.push(observed);
        }
        walk(
            root,
            started,
            true,
            &mut analysis.directories,
            &mut |path, entries| {
                if entries.iter().any(|entry| entry.file_name() == "pom.xml") {
                    project_poms.insert(path.join("pom.xml"));
                }
                if path.file_name().is_some_and(|name| name == ".mvn") {
                    if entries
                        .iter()
                        .any(|entry| entry.file_name() == "extensions.xml")
                    {
                        extensions.insert(path.join("extensions.xml"));
                    }
                }
                Ok(false)
            },
        )
        .map_err(|error| format!("项目扫描不完整：{error}"))?;
    }
    analysis.projects = project_poms.len();
    if project_poms.is_empty() {
        analysis
            .blockers
            .push("扫描范围内没有发现 pom.xml；请调整项目目录".into());
    }
    walk(
        &repository,
        started,
        false,
        &mut analysis.directories,
        &mut |path, entries| {
            if entries.iter().any(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext == "pom" || ext == "jar" || ext == "aar")
            }) {
                match inspect_version(&repository, path) {
                    Ok(version) => version_dirs.push(version),
                    Err(error) => analysis.blockers.push(error),
                }
                Ok(true)
            } else {
                Ok(false)
            }
        },
    )
    .map_err(|error| format!("本地仓库扫描不完整：{error}"))?;
    analysis.versions = version_dirs.len();
    let model_budget = ModelBudget {
        started,
        models: 0,
        max_models: MAX_MODELS,
    };
    let mut models = models::ModelReader::new(&repository, model_budget);
    for version in &mut version_dirs {
        if version.poms.is_empty() {
            let artifact = version.ga.split_once(':').unwrap().1;
            let jar = version
                .path
                .join(format!("{artifact}-{}.jar", version.version));
            if jar.is_file() {
                let pom = version
                    .path
                    .join(format!("{artifact}-{}.pom", version.version));
                models.register_embedded(pom.clone(), jar, &version.ga);
                version.poms.push(pom);
            }
        }
    }
    let mut references: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut protected = BTreeSet::new();
    let mut seen = BTreeSet::new();
    let mut pending: Vec<_> = project_poms.into_iter().collect();
    pending.extend(extensions);
    // Every local/unknown artifact and Maven plugin is retained, together with
    // its declared dependency closure. Known provider families are implicit.
    for version in &version_dirs {
        models.budget.check_time("本地仓库模型分析")?;
        analysis.inputs.push(
            ObservedFile::read(&version.path.join("_remote.repositories"))
                .map_err(|_| "构件来源元数据无法确认")?,
        );
        if !version.remote
            || version.ga.starts_with("org.apache.maven.plugins:")
            || version.ga.starts_with("org.apache.maven.surefire:")
        {
            protected.insert(version.ga.clone());
        }
        for path in &version.poms {
            match models.read(path) {
                Ok(pom) => {
                    if pom.ga.as_deref() != Some(&version.ga) {
                        analysis
                            .blockers
                            .push(format!("{} 的目录坐标与 POM 不一致", path.display()));
                    }
                    if pom.plugin {
                        protected.insert(version.ga.clone());
                    }
                    references
                        .entry(version.ga.clone())
                        .or_default()
                        .extend(pom.references);
                }
                Err(error) => analysis.blockers.push(error),
            }
        }
        if version.poms.is_empty() {
            analysis.blockers.push(format!(
                "{}:{} 缺少 POM，无法核对传递引用",
                version.ga, version.version
            ));
        }
    }
    while let Some(path) = pending.pop() {
        if !seen.insert(path.clone()) {
            continue;
        }
        match models.read(&path) {
            Ok(pom) => {
                if let Some(ga) = pom.ga {
                    protected.insert(ga.clone());
                    references
                        .entry(ga)
                        .or_default()
                        .extend(pom.references.clone());
                }
                protected.extend(pom.references);
                if let Some(parent) = pom.parent_path {
                    pending.push(parent);
                }
                pending.extend(pom.modules);
            }
            Err(error) => analysis.blockers.push(error),
        }
    }
    let mut queue: Vec<String> = protected.iter().cloned().collect();
    let installed: BTreeSet<_> = version_dirs
        .iter()
        .map(|version| version.ga.as_str())
        .collect();
    while let Some(ga) = queue.pop() {
        models.budget.check_time("引用闭包分析")?;
        if let Some(dependencies) = references.get(&ga) {
            for dependency in dependencies {
                if protected.insert(dependency.clone()) {
                    queue.push(dependency.clone());
                }
            }
        } else if !installed.contains(ga.as_str()) {
            analysis.missing_models.push(ga.clone());
            if reference_mode == ReferenceMode::Complete {
                analysis.blockers.push(format!(
                    "{ga} 的 POM 不在扫描范围或本地仓库中，无法核对传递引用"
                ));
            }
        } else {
            analysis
                .blockers
                .push(format!("{ga} 已有构件的 POM 无法读取，无法核对传递引用"));
        }
    }
    analysis.inputs.extend(models.inputs);
    analysis.archives = models.archives;
    analysis.missing_models.sort();
    for version in version_dirs {
        if !version.remote {
            analysis.excluded_versions += 1;
        } else if protected.contains(&version.ga) {
            analysis.protected_versions += 1;
        } else {
            let id = version
                .path
                .strip_prefix(&repository)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .into_owned();
            analysis.candidates.push(Candidate {
                id,
                coordinate: version.ga,
                version: version.version,
                path: version.path.display().to_string(),
                bytes: version.bytes,
                signature: version.signature,
            });
        }
    }
    analysis
        .candidates
        .sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.id.cmp(&b.id)));
    if analysis.candidates.len() > MAX_CANDIDATES {
        analysis
            .blockers
            .push("候选超过 2000 个，未生成清理授权".into());
    }
    analysis.blockers.sort();
    analysis.blockers.dedup();
    analysis.blockers.truncate(50);
    if !analysis.blockers.is_empty() {
        analysis.candidates.clear();
    }
    Ok(analysis)
}

fn walk(
    root: &Path,
    started: Instant,
    project: bool,
    directories: &mut Vec<ObservedDirectory>,
    visit: &mut dyn FnMut(&Path, &[fs::DirEntry]) -> Result<bool, String>,
) -> Result<(), String> {
    let mut queue = vec![root.to_path_buf()];
    let mut count = 0;
    while let Some(path) = queue.pop() {
        count += 1;
        if count > MAX_DIRECTORIES || started.elapsed() > MAX_SCAN_TIME {
            return Err("目录扫描达到上限".into());
        }
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| format!("{}：{error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("{} 是符号链接，无法确认扫描覆盖", path.display()));
        }
        let entries: Vec<_> = fs::read_dir(&path)
            .map_err(|error| error.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?;
        let next = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.modified().ok() != next.modified().ok() {
            return Err(format!("{} 在扫描中发生变化", path.display()));
        }
        directories.push(ObservedDirectory {
            path: path.clone(),
            metadata,
            names: entries
                .iter()
                .map(fs::DirEntry::file_name)
                .filter(|name| !project || !ignored_project_name(name))
                .collect(),
            project,
        });
        if visit(&path, &entries)? {
            continue;
        }
        for entry in entries {
            if project && ignored_project_name(&entry.file_name()) {
                continue;
            }
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                return Err(format!(
                    "{} 是符号链接，无法确认扫描覆盖",
                    entry.path().display()
                ));
            }
            if kind.is_dir() {
                queue.push(entry.path());
            }
        }
    }
    Ok(())
}

fn checked_path(repository: &Path, path: &Path) -> Result<(), String> {
    let root = fs::symlink_metadata(repository).map_err(|error| error.to_string())?;
    if !root.is_dir() || root.file_type().is_symlink() {
        return Err("本地仓库路径身份已变化".into());
    }
    let relative = path
        .strip_prefix(repository)
        .map_err(|_| "构件不在本地仓库内")?;
    if relative.components().count() < 3 {
        return Err("构件目录布局无法确认".into());
    }
    let mut current = repository.to_path_buf();
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err("构件目录布局无法确认".into());
        }
        current.push(component);
        let metadata = fs::symlink_metadata(&current).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("构件路径身份已变化".into());
        }
    }
    Ok(())
}

fn inspect_version(repository: &Path, path: &Path) -> Result<Version, String> {
    checked_path(repository, path)?;
    let parts: Vec<_> = path
        .strip_prefix(repository)
        .unwrap()
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect();
    let version = parts[parts.len() - 1].clone();
    let artifact = &parts[parts.len() - 2];
    let ga = format!("{}:{artifact}", parts[..parts.len() - 2].join("."));
    let mut poms = Vec::new();
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path().extension().is_some_and(|ext| ext == "pom") {
            poms.push(entry.path());
        }
    }
    let (bytes, signature) = version_signature(path)?;
    let remote = remote_only(path)?;
    Ok(Version {
        ga,
        version,
        path: path.into(),
        poms,
        remote,
        bytes,
        signature,
    })
}

fn version_signature(path: &Path) -> Result<(u64, String), String> {
    let mut entries: Vec<_> = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    let mut hash = Sha256::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let directory = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        hash.update(directory.dev().to_le_bytes());
        hash.update(directory.ino().to_le_bytes());
    }
    let mut bytes: u64 = 0;
    for entry in entries {
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(format!("{} 含目录、符号链接或特殊文件", path.display()));
        }
        bytes = bytes.saturating_add(metadata.len());
        hash.update(entry.file_name().to_string_lossy().as_bytes());
        hash.update(metadata.len().to_le_bytes());
        hash.update(format!("{:?}", metadata.modified()).as_bytes());
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            hash.update(metadata.dev().to_le_bytes());
            hash.update(metadata.ino().to_le_bytes());
        }
        if entry.path().extension().is_some_and(|ext| ext == "pom")
            || entry.file_name() == "_remote.repositories"
        {
            if metadata.len() > 4 * 1024 * 1024 {
                return Err("构件元数据超过读取上限".into());
            }
            hash.update(fs::read(entry.path()).map_err(|error| error.to_string())?);
        }
    }
    Ok((bytes, format!("{:x}", hash.finalize())))
}

fn remote_only(path: &Path) -> Result<bool, String> {
    let metadata_path = path.join("_remote.repositories");
    let observed = ObservedFile::read(&metadata_path).map_err(|_| "来源元数据无法读取")?;
    let Some(text) = observed.text else {
        return Ok(false);
    };
    let mut tracked = BTreeSet::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with(['#', '!']))
    {
        // Unsupported Java-properties escapes/continuations are unknown, never
        // treated as proof that a payload was downloaded.
        if line.contains('\\') {
            return Ok(false);
        }
        let Some((key, _)) = line.split_once('=') else {
            return Ok(false);
        };
        let Some((file, repository)) = key.rsplit_once('>') else {
            return Ok(false);
        };
        if repository.trim().is_empty() {
            return Ok(false);
        }
        tracked.insert(file.trim().to_string());
    }
    let mut payloads = 0;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let name = entry
            .map_err(|error| error.to_string())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if name == "maven-metadata-local.xml" {
            return Ok(false);
        }
        if name == "_remote.repositories"
            || name == "resolver-status.properties"
            || name.ends_with(".lastUpdated")
            || [".sha1", ".sha256", ".sha512", ".md5"]
                .iter()
                .any(|suffix| name.ends_with(suffix))
            || name.starts_with("maven-metadata-") && name.ends_with(".xml")
        {
            continue;
        }
        payloads += 1;
        if !tracked.contains(&name) {
            return Ok(false);
        }
    }
    Ok(payloads > 0)
}

fn child_text<'a, 'input>(node: roxmltree::Node<'a, 'input>, name: &str) -> Option<&'a str> {
    node.children()
        .find(|child| child.has_tag_name(name))
        .and_then(|child| child.text())
        .map(str::trim)
}

fn interpolate(
    value: &str,
    properties: &BTreeMap<String, BTreeSet<String>>,
) -> Result<BTreeSet<String>, String> {
    let mut results = BTreeSet::from([value.to_string()]);
    for _ in 0..20 {
        let mut expanded = BTreeSet::new();
        let mut complete = true;
        for result in results {
            let Some(start) = result.find("${") else {
                if result.is_empty() || result.contains(['/', '\\', ':']) {
                    return Err("构件坐标无法确认".into());
                }
                expanded.insert(result);
                continue;
            };
            complete = false;
            let end = result[start..].find('}').ok_or("构件坐标属性无法解析")? + start;
            let key = &result[start + 2..end];
            let replacements = properties
                .get(key)
                .ok_or_else(|| format!("构件坐标中的属性 {key} 无法确认"))?;
            for replacement in replacements {
                let mut value = result.clone();
                value.replace_range(start..=end, replacement);
                expanded.insert(value);
                if expanded.len() > 64 {
                    return Err("构件坐标属性组合超过 64 个上限".into());
                }
            }
        }
        if complete {
            return Ok(expanded);
        }
        results = expanded;
    }
    Err("构件坐标属性递归或继承关系无法确认".into())
}

#[cfg(test)]
#[path = "maven_unused_tests.rs"]
mod tests;
