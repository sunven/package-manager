//! Read-only directory observations. The tree stays native; IPC returns one visible directory.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, Metadata, ReadDir};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::DialogExt;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

#[path = "disk_removal.rs"]
pub(crate) mod removal;

const MAX_ENTRIES: usize = 1_000_000;
const CHART_LIMIT: usize = 200;
const UPDATE_INTERVAL: Duration = Duration::from_millis(200);
static NEXT_SCAN: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    Directory,
    File,
    Symlink,
    Mount,
    Special,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Running,
    Completed,
    Partial,
    Stopped,
    Limited,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    scan_id: String,
    revision: u64,
    root_path: String,
    phase: Phase,
    started_at: u64,
    finished_at: Option<u64>,
    elapsed_ms: u64,
    entries: usize,
    bytes: Option<u64>,
    errors: u64,
    excluded: u64,
    message: Option<String>,
    warning: Option<String>,
}

struct Node {
    parent: Option<usize>,
    depth: usize,
    name: OsString,
    kind: Kind,
    bytes: Option<u64>,
    finished: bool,
    partial: bool,
    message: Option<String>,
    children: Vec<usize>,
    identity: Option<removal::Identity>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    id: usize,
    name: String,
    path: String,
    kind: Kind,
    bytes: Option<u64>,
    status: &'static str,
    message: Option<String>,
    removal_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryPage {
    scan_id: String,
    directory: Entry,
    ancestors: Vec<Entry>,
    entries: Vec<Entry>,
    total: usize,
}

#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ListGroup {
    #[default]
    All,
    Other,
    Unmeasured,
    Zero,
    Excluded,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartOther {
    count: usize,
    bytes: u64,
    partial: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartCounts {
    unmeasured: usize,
    zero: usize,
    excluded: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryChart {
    scan_id: String,
    revision: u64,
    phase: Phase,
    directory: Entry,
    ancestors: Vec<Entry>,
    entries: Vec<Entry>,
    total: usize,
    other: ChartOther,
    counts: ChartCounts,
}

impl Node {
    fn excluded(&self) -> bool {
        matches!(self.kind, Kind::Symlink | Kind::Mount | Kind::Special)
    }

    fn positive(&self) -> bool {
        !self.excluded() && self.bytes.is_some_and(|bytes| bytes > 0)
    }

    fn zero(&self) -> bool {
        !self.excluded() && self.finished && !self.partial && self.bytes == Some(0)
    }
}

struct Listing {
    directory: usize,
    view: u64,
    terminal: bool,
    ids: Vec<usize>,
}

struct Tree {
    root: PathBuf,
    nodes: Vec<Node>,
    summary: Summary,
    listing: Option<Listing>,
    root_chain: Vec<(PathBuf, removal::Identity)>,
    protected_home: Option<Vec<removal::Identity>>,
    consumed: bool,
    mounts: Vec<removal::Identity>,
}

impl Tree {
    fn path(&self, mut id: usize) -> PathBuf {
        let mut names = Vec::new();
        while let Some(parent) = self.nodes[id].parent {
            names.push(&self.nodes[id].name);
            id = parent;
        }
        let mut path = self.root.clone();
        for name in names.into_iter().rev() {
            path.push(name);
        }
        path
    }

    fn entry(&self, id: usize) -> Entry {
        let node = &self.nodes[id];
        let status = if matches!(node.kind, Kind::Symlink | Kind::Mount | Kind::Special) {
            "excluded"
        } else if node.partial || (!node.finished && self.summary.phase != Phase::Running) {
            "partial"
        } else if node.finished {
            "complete"
        } else if node.bytes.is_some() {
            "scanning"
        } else {
            "pending"
        };
        Entry {
            id,
            name: node.name.to_string_lossy().into(),
            path: self.path(id).display().to_string(),
            kind: node.kind,
            bytes: node.bytes,
            status,
            message: node.message.clone(),
            removal_reason: removal::reason(self, id),
        }
    }

    fn error(&mut self, mut id: usize, message: String) {
        self.summary.errors += 1;
        loop {
            let node = &mut self.nodes[id];
            node.partial = true;
            if node.message.is_none() {
                node.message = Some(message.clone());
            }
            match node.parent {
                Some(parent) => id = parent,
                None => break,
            }
        }
    }

    fn common_ancestor(&self, mut a: usize, mut b: usize) -> usize {
        while a != b {
            if self.nodes[a].depth >= self.nodes[b].depth {
                a = self.nodes[a].parent.unwrap();
            } else {
                b = self.nodes[b].parent.unwrap();
            }
        }
        a
    }

    fn add_bytes(&mut self, parent: usize, bytes: u64, previous_parent: Option<usize>) {
        // DFS visits each subtree contiguously. Ancestors shared with the previous
        // occurrence already counted this inode; only the new branch gains bytes.
        let stop = previous_parent.map(|previous| self.common_ancestor(parent, previous));
        let mut current = Some(parent);
        while current != stop {
            let node = &mut self.nodes[current.unwrap()];
            node.bytes = Some(node.bytes.unwrap_or(0).saturating_add(bytes));
            current = node.parent;
        }
    }

    fn validate_directory(&self, directory: usize) -> Result<(), String> {
        if self.nodes.get(directory).map(|node| node.kind) != Some(Kind::Directory) {
            return Err("该条目不是本轮可浏览的目录。".into());
        }
        Ok(())
    }

    fn ancestors(&self, directory: usize) -> Vec<Entry> {
        let mut ancestors = Vec::new();
        let mut next = self.nodes[directory].parent;
        while let Some(id) = next {
            ancestors.push(self.entry(id));
            next = self.nodes[id].parent;
        }
        ancestors.reverse();
        ancestors
    }

    fn compare_size(&self, a: &usize, b: &usize) -> std::cmp::Ordering {
        self.nodes[*b]
            .bytes
            .cmp(&self.nodes[*a].bytes)
            .then_with(|| self.nodes[*a].name.cmp(&self.nodes[*b].name))
            .then(a.cmp(b))
    }

    // Select from the entire current level, independent of the visible list page.
    // Only the 200 largest entries need sorting; the rest contribute display weight.
    fn chart_parts(&self, directory: usize) -> (Vec<usize>, ChartOther, ChartCounts) {
        let mut ids = Vec::new();
        let mut counts = ChartCounts::default();
        for &id in &self.nodes[directory].children {
            let node = &self.nodes[id];
            if node.excluded() {
                counts.excluded += 1;
            } else if node.positive() {
                ids.push(id);
            } else if node.zero() {
                counts.zero += 1;
            } else {
                counts.unmeasured += 1;
            }
        }
        let mut other = ChartOther::default();
        if ids.len() > CHART_LIMIT {
            ids.select_nth_unstable_by(CHART_LIMIT, |a, b| self.compare_size(a, b));
            for &id in &ids[CHART_LIMIT..] {
                let node = &self.nodes[id];
                other.count += 1;
                // Sibling footprints may overlap: never subtract from the parent.
                other.bytes = other.bytes.saturating_add(node.bytes.unwrap());
                other.partial |= !node.finished || node.partial;
            }
            ids.truncate(CHART_LIMIT);
        }
        ids.sort_unstable_by(|a, b| self.compare_size(a, b));
        (ids, other, counts)
    }

    fn chart(&self, directory: usize) -> Result<DirectoryChart, String> {
        self.validate_directory(directory)?;
        let (ids, other, counts) = self.chart_parts(directory);
        Ok(DirectoryChart {
            scan_id: self.summary.scan_id.clone(),
            revision: self.summary.revision,
            phase: self.summary.phase,
            directory: self.entry(directory),
            ancestors: self.ancestors(directory),
            entries: ids.into_iter().map(|id| self.entry(id)).collect(),
            total: self.nodes[directory].children.len(),
            other,
            counts,
        })
    }

    fn page(
        &mut self,
        directory: usize,
        view: u64,
        limit: usize,
        group: ListGroup,
    ) -> Result<DirectoryPage, String> {
        self.validate_directory(directory)?;
        let terminal = self.summary.phase != Phase::Running;
        let reset = self.listing.as_ref().is_none_or(|list| {
            list.directory != directory || list.view != view || list.terminal != terminal
        });
        if reset {
            let mut ids = self.nodes[directory].children.clone();
            ids.sort_unstable_by(|a, b| self.compare_size(a, b));
            self.listing = Some(Listing {
                directory,
                view,
                terminal,
                ids,
            });
        } else {
            let list = self.listing.as_mut().unwrap();
            list.ids
                .extend_from_slice(&self.nodes[directory].children[list.ids.len()..]);
        }
        let list = self.listing.as_ref().unwrap();
        let top: HashSet<usize> = if group == ListGroup::Other {
            self.chart_parts(directory).0.into_iter().collect()
        } else {
            HashSet::new()
        };
        let mut total = 0;
        let mut entries = Vec::new();
        for &id in &list.ids {
            let node = &self.nodes[id];
            let matches = match group {
                ListGroup::All => true,
                ListGroup::Other => node.positive() && !top.contains(&id),
                ListGroup::Unmeasured => !node.excluded() && !node.positive() && !node.zero(),
                ListGroup::Zero => node.zero(),
                ListGroup::Excluded => node.excluded(),
            };
            if matches {
                total += 1;
                if entries.len() < limit.clamp(1, MAX_ENTRIES) {
                    entries.push(self.entry(id));
                }
            }
        }
        Ok(DirectoryPage {
            scan_id: self.summary.scan_id.clone(),
            directory: self.entry(directory),
            ancestors: self.ancestors(directory),
            entries,
            total,
        })
    }
}

struct Job {
    tree: Mutex<Tree>,
    cancel: AtomicBool,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Settings {
    pub(crate) last_path: Option<String>,
    #[serde(skip_deserializing)]
    warning: Option<String>,
}

struct Registry {
    settings: Settings,
    job: Option<Arc<Job>>,
    pending: Option<removal::Plan>,
    active: Option<(String, Arc<AtomicBool>)>,
}

#[derive(Clone)]
pub(crate) struct DiskScanState {
    registry: Arc<Mutex<Registry>>,
    settings_path: PathBuf,
}

struct Prepared {
    root: PathBuf,
    entries: ReadDir,
    device: u64,
    root_chain: Vec<(PathBuf, removal::Identity)>,
}

fn prepare(path: &str) -> Result<Prepared, String> {
    let path = if let Some(relative) = path.strip_prefix("~/") {
        PathBuf::from(std::env::var_os("HOME").ok_or("无法确定用户主目录。")?).join(relative)
    } else {
        PathBuf::from(path)
    };
    if !path.is_absolute() {
        return Err("请输入绝对路径或以 ~/ 开头的路径。".into());
    }
    let root = path
        .canonicalize()
        .map_err(|e| format!("无法读取扫描起点：{e}"))?;
    let metadata = fs::metadata(&root).map_err(|e| format!("无法读取扫描起点：{e}"))?;
    if !metadata.is_dir() {
        return Err("扫描起点必须是目录。".into());
    }
    let entries = fs::read_dir(&root).map_err(|e| format!("无法读取扫描起点：{e}"))?;
    Ok(Prepared {
        root: root.clone(),
        entries,
        device: device(&metadata),
        root_chain: removal::observe_chain(&root).unwrap_or_default(),
    })
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[cfg(unix)]
fn device(metadata: &Metadata) -> u64 {
    metadata.dev()
}
#[cfg(not(unix))]
fn device(_: &Metadata) -> u64 {
    0
}
#[cfg(unix)]
fn allocated(metadata: &Metadata) -> u64 {
    metadata.blocks().saturating_mul(512)
}
#[cfg(not(unix))]
fn allocated(metadata: &Metadata) -> u64 {
    metadata.len()
}
#[cfg(unix)]
fn shared_identity(metadata: &Metadata) -> Option<(u64, u64)> {
    (metadata.nlink() > 1).then(|| (metadata.dev(), metadata.ino()))
}
#[cfg(not(unix))]
fn shared_identity(_: &Metadata) -> Option<(u64, u64)> {
    None
}

impl DiskScanState {
    pub(crate) fn load(settings_path: PathBuf) -> Self {
        let settings = match fs::read(&settings_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| Settings {
                warning: Some("上次扫描路径无法读取，请重新选择。".into()),
                ..Settings::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => Settings {
                warning: Some(format!("上次扫描路径无法读取：{e}")),
                ..Settings::default()
            },
        };
        Self {
            registry: Arc::new(Mutex::new(Registry {
                settings,
                job: None,
                pending: None,
                active: None,
            })),
            settings_path,
        }
    }

    pub(crate) fn settings(&self) -> Settings {
        self.registry.lock().unwrap().settings.clone()
    }

    fn install(&self, prepared: &Prepared) -> Result<Arc<Job>, String> {
        let mut registry = self.registry.lock().unwrap();
        if registry.pending.is_some() || registry.active.is_some() {
            return Err("请先结束或取消移除操作。".into());
        }
        if let Some(old) = &registry.job {
            old.cancel.store(true, Ordering::Relaxed);
        }
        registry.settings = Settings {
            last_path: Some(prepared.root.display().to_string()),
            warning: None,
        };
        if let Err(e) = self.save(&registry.settings) {
            registry.settings.warning = Some(format!("上次扫描路径未保存：{e}"));
        }
        let summary = Summary {
            scan_id: NEXT_SCAN.fetch_add(1, Ordering::Relaxed).to_string(),
            revision: 0,
            root_path: prepared.root.display().to_string(),
            phase: Phase::Running,
            started_at: now(),
            finished_at: None,
            elapsed_ms: 0,
            entries: 0,
            bytes: Some(0),
            errors: 0,
            excluded: 0,
            message: None,
            warning: registry.settings.warning.clone(),
        };
        let root = Node {
            parent: None,
            depth: 0,
            name: prepared
                .root
                .file_name()
                .unwrap_or(prepared.root.as_os_str())
                .into(),
            kind: Kind::Directory,
            bytes: Some(0),
            finished: false,
            partial: false,
            message: None,
            children: Vec::new(),
            identity: prepared
                .root_chain
                .last()
                .map(|(_, identity)| identity.clone()),
        };
        let job = Arc::new(Job {
            tree: Mutex::new(Tree {
                root: prepared.root.clone(),
                nodes: vec![root],
                summary,
                listing: None,
                root_chain: prepared.root_chain.clone(),
                protected_home: std::env::var_os("HOME")
                    .and_then(|path| PathBuf::from(path).canonicalize().ok())
                    .and_then(|path| removal::observe_chain(&path).ok())
                    .map(|chain| chain.into_iter().map(|(_, identity)| identity).collect()),
                consumed: false,
                mounts: removal::mount_paths()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|path| {
                        fs::symlink_metadata(path)
                            .ok()
                            .and_then(|metadata| removal::Identity::read(&metadata))
                    })
                    .collect(),
            }),
            cancel: AtomicBool::new(false),
        });
        registry.job = Some(job.clone());
        Ok(job)
    }

    fn save(&self, settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
        let parent = self.settings_path.parent().ok_or("无法确定配置目录")?;
        fs::create_dir_all(parent)?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(&serde_json::to_vec(settings)?)?;
        file.persist(&self.settings_path)?;
        Ok(())
    }

    fn job(&self, scan_id: &str) -> Result<Arc<Job>, String> {
        let job = self
            .registry
            .lock()
            .unwrap()
            .job
            .clone()
            .ok_or("请先扫描目录。")?;
        if job.tree.lock().unwrap().summary.scan_id != scan_id {
            return Err("扫描记录已替换，请查看新一轮结果。".into());
        }
        Ok(job)
    }
}

struct Frame {
    id: usize,
    path: PathBuf,
    entries: ReadDir,
}

fn run(job: &Job, prepared: Prepared, max_entries: usize, mut progress: impl FnMut(Summary)) {
    let started = Instant::now();
    let mut last_update = Instant::now();
    let mut stack = vec![Frame {
        id: 0,
        path: prepared.root,
        entries: prepared.entries,
    }];
    let mut shared: HashMap<(u64, u64), (usize, u64)> = HashMap::new();
    let mut phase = Phase::Completed;
    while let Some(frame) = stack.last_mut() {
        if job.cancel.load(Ordering::Relaxed) {
            phase = Phase::Stopped;
            break;
        }
        if job.tree.lock().unwrap().nodes.len() - 1 >= max_entries {
            phase = Phase::Limited;
            break;
        }
        let parent = frame.id;
        let entry = match frame.entries.next() {
            None => {
                job.tree.lock().unwrap().nodes[parent].finished = true;
                stack.pop();
                continue;
            }
            Some(Err(e)) => {
                job.tree.lock().unwrap().error(
                    parent,
                    format!("无法完整读取 {}：{e}", frame.path.display()),
                );
                continue;
            }
            Some(Ok(entry)) => entry,
        };
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path);
        let mut tree = job.tree.lock().unwrap();
        let mut node = Node {
            parent: Some(parent),
            depth: tree.nodes[parent].depth + 1,
            name: entry.file_name(),
            kind: Kind::Unknown,
            bytes: None,
            finished: true,
            partial: false,
            message: None,
            children: Vec::new(),
            identity: metadata.as_ref().ok().and_then(removal::Identity::read),
        };
        let id = tree.nodes.len();
        match metadata {
            Err(e) => {
                node.partial = true;
                node.message = Some(format!("无法读取 {}：{e}", path.display()));
            }
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    node.kind = Kind::Symlink;
                    node.message = Some("符号链接，未计入且不跟随目标。".into());
                } else if device(&metadata) != prepared.device {
                    node.kind = Kind::Mount;
                    node.message = Some("其他磁盘，未扫描；可另选为扫描起点。".into());
                } else if metadata.is_dir() {
                    node.kind = Kind::Directory;
                    node.finished = false;
                } else if metadata.is_file() {
                    node.kind = Kind::File;
                    let mut bytes = allocated(&metadata);
                    let mut previous = None;
                    if let Some(identity) = shared_identity(&metadata) {
                        if let Some((last, observed_bytes)) = shared.get(&identity) {
                            previous = Some(*last);
                            bytes = *observed_bytes;
                        }
                        shared.insert(identity, (parent, bytes));
                    }
                    node.bytes = Some(bytes);
                    tree.add_bytes(parent, bytes, previous);
                } else {
                    node.kind = Kind::Special;
                    node.message = Some("特殊条目，未计入。".into());
                }
            }
        }
        let directory = node.kind == Kind::Directory;
        if node.partial {
            tree.error(parent, node.message.clone().unwrap());
        }
        if matches!(node.kind, Kind::Symlink | Kind::Mount | Kind::Special) {
            tree.summary.excluded += 1;
        }
        tree.nodes.push(node);
        tree.nodes[parent].children.push(id);
        drop(tree);
        if directory && !job.cancel.load(Ordering::Relaxed) {
            // Recheck the directory immediately before opening it, including replacements by links.
            let entries = fs::symlink_metadata(&path).and_then(|metadata| {
                if !metadata.is_dir()
                    || metadata.file_type().is_symlink()
                    || device(&metadata) != prepared.device
                {
                    return Err(std::io::Error::other("目录身份已变化"));
                }
                fs::read_dir(&path)
            });
            match entries {
                Ok(entries) => {
                    job.tree.lock().unwrap().nodes[id].bytes = Some(0);
                    stack.push(Frame { id, path, entries });
                }
                Err(e) => {
                    let mut tree = job.tree.lock().unwrap();
                    tree.error(id, format!("无法读取 {}：{e}", path.display()));
                    tree.nodes[id].finished = true;
                }
            }
        }
        if last_update.elapsed() >= UPDATE_INTERVAL {
            progress(update(job, started, Phase::Running));
            last_update = Instant::now();
        }
    }
    progress(update(job, started, phase));
}

fn update(job: &Job, started: Instant, mut phase: Phase) -> Summary {
    let mut tree = job.tree.lock().unwrap();
    if phase == Phase::Completed && tree.nodes[0].partial {
        phase = Phase::Partial;
    }
    tree.summary.bytes = tree.nodes[0].bytes;
    tree.summary.entries = tree.nodes.len() - 1;
    tree.summary.elapsed_ms = started.elapsed().as_millis() as u64;
    tree.summary.phase = phase;
    tree.summary.revision += 1;
    if phase != Phase::Running {
        tree.summary.finished_at = Some(now());
        tree.summary.message = match phase {
            Phase::Stopped => Some("扫描已停止，未完成目录的结果不完整。".into()),
            Phase::Limited => Some("已达到条目上限，结果不完整。".into()),
            Phase::Partial => tree.nodes[0].message.clone(),
            _ => None,
        };
    }
    tree.summary.clone()
}

#[tauri::command]
pub(crate) fn get_disk_scan_settings(state: tauri::State<'_, DiskScanState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub(crate) async fn choose_disk_scan_directory(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|path| path.display().to_string())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn start_disk_scan(
    path: String,
    on_progress: tauri::ipc::Channel<Summary>,
    state: tauri::State<'_, DiskScanState>,
) -> Result<Summary, String> {
    let state = state.inner().clone();
    let (prepared, job) = tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare(&path)?;
        let job = state.install(&prepared)?;
        Ok::<_, String>((prepared, job))
    })
    .await
    .map_err(|e| e.to_string())??;
    let summary = job.tree.lock().unwrap().summary.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run(&job, prepared, MAX_ENTRIES, |progress| {
            let _ = on_progress.send(progress);
        })
    });
    Ok(summary)
}

#[tauri::command]
pub(crate) fn stop_disk_scan(
    scan_id: String,
    state: tauri::State<'_, DiskScanState>,
) -> Result<(), String> {
    state.job(&scan_id)?.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub(crate) async fn read_disk_scan_directory(
    scan_id: String,
    directory_id: usize,
    view: u64,
    limit: usize,
    group: Option<ListGroup>,
    state: tauri::State<'_, DiskScanState>,
) -> Result<DirectoryPage, String> {
    let job = state.job(&scan_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        job.tree
            .lock()
            .unwrap()
            .page(directory_id, view, limit, group.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn read_disk_scan_chart(
    scan_id: String,
    directory_id: usize,
    state: tauri::State<'_, DiskScanState>,
) -> Result<DirectoryChart, String> {
    let job = state.job(&scan_id)?;
    tauri::async_runtime::spawn_blocking(move || job.tree.lock().unwrap().chart(directory_id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "disk_scan_tests.rs"]
mod tests;
