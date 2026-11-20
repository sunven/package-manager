//! Explicit selections from one completed disk observation. Paths and evidence stay native.
use super::*;
use crate::maintenance_history::{
    ExecutionSummary, MaintenanceDetail, MaintenanceDomain, MaintenanceHistoryState,
    MaintenanceOperation,
};
use crate::maintenance_operation::{self, OperationEnd, OperationHeader, Receipt};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Identity {
    device: u64,
    inode: u64,
    kind: u32,
    created: Option<SystemTime>,
}

impl Identity {
    pub(super) fn read(metadata: &Metadata) -> Option<Self> {
        #[cfg(unix)]
        {
            Some(Self {
                device: metadata.dev(),
                inode: metadata.ino(),
                kind: metadata.mode() & libc::S_IFMT as u32,
                created: metadata.created().ok(),
            })
        }
        #[cfg(not(unix))]
        {
            let _ = metadata;
            None
        }
    }
}

pub(super) fn observe_chain(path: &Path) -> Result<Vec<(PathBuf, Identity)>, String> {
    let mut chain = Vec::new();
    for path in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("路径包含符号链接".into());
        }
        chain.push((
            path.to_path_buf(),
            Identity::read(&metadata).ok_or("无法核实路径身份")?,
        ));
    }
    Ok(chain)
}

pub(super) fn reason(tree: &Tree, id: usize) -> Option<String> {
    let node = &tree.nodes[id];
    let message = if tree.consumed {
        Some("本轮结果已用于移除，请重新扫描")
    } else if id == 0 {
        Some("扫描起点不能移除")
    } else if !matches!(node.kind, Kind::Directory | Kind::File) {
        Some("仅支持普通文件和目录")
    } else if tree.root_chain.is_empty() || node.identity.is_none() {
        Some("无法核实本轮对象身份，请重新扫描")
    } else if node
        .identity
        .as_ref()
        .is_some_and(|identity| tree.mounts.contains(identity))
    {
        Some("挂载点不能移除")
    } else if let Some(home) = &tree.protected_home {
        if node
            .identity
            .as_ref()
            .is_some_and(|identity| home.contains(identity))
        {
            Some("用户主目录及其祖先不能移除")
        } else {
            None
        }
    } else {
        Some("无法确定用户主目录，不能移除")
    };
    message.map(String::from)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    pub id: usize,
    pub name: String,
    pub path: String,
    pub directory: bool,
    pub partial: bool,
    pub bytes: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Plan {
    pub id: String,
    pub scan_id: String,
    pub root_path: String,
    pub targets: Vec<Target>,
    #[serde(skip)]
    evidence: Vec<Vec<(PathBuf, Identity)>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub id: usize,
    pub path: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Detail {
    pub scan_id: String,
    pub root_path: String,
    pub targets: Vec<Target>,
    pub results: Vec<Item>,
    #[serde(default)]
    pub stopped: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Outcome {
    pub results: Vec<Item>,
    pub stopped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    plan_id: String,
    total: usize,
    completed: usize,
    current_path: Option<String>,
    item: Option<Item>,
}

impl DiskScanState {
    fn prepare_removal(&self, scan_id: &str, ids: Vec<usize>) -> Result<Plan, String> {
        let mut registry = self.registry.lock().unwrap();
        if registry.active.is_some() || registry.pending.is_some() {
            return Err("已有待确认或执行中的移除操作".into());
        }
        let job = registry.job.as_ref().ok_or("请先扫描目录")?;
        let tree = job.tree.lock().unwrap();
        if tree.summary.scan_id != scan_id || tree.consumed {
            return Err("扫描记录已失效，请重新扫描".into());
        }
        if tree.summary.phase == Phase::Running {
            return Err("请先等待扫描结束或停止扫描".into());
        }
        if ids.is_empty() {
            return Err("请先选择条目".into());
        }
        let mut unique = HashSet::new();
        let mut targets = Vec::new();
        let mut evidence = Vec::new();
        let mut parent = None;
        for id in ids {
            if !unique.insert(id) {
                return Err("移除目标不能重复".into());
            }
            let node = tree.nodes.get(id).ok_or("条目不属于本轮扫描")?;
            if let Some(reason) = reason(&tree, id) {
                return Err(reason);
            }
            if parent.is_some() && parent != node.parent {
                return Err("批量选择必须属于同一目录".into());
            }
            parent = node.parent;
            let path = tree.path(id);
            // Lossy display names must never become an execution path.
            if path.to_str().is_none() {
                return Err("此路径无法传给系统废纸篓".into());
            }
            let mut chain = tree.root_chain.clone();
            let mut ancestors = Vec::new();
            let mut next = Some(id);
            while let Some(index) = next {
                if index == 0 {
                    break;
                }
                ancestors.push(index);
                next = tree.nodes[index].parent;
            }
            for index in ancestors.into_iter().rev() {
                chain.push((
                    tree.path(index),
                    tree.nodes[index]
                        .identity
                        .clone()
                        .ok_or("路径身份不完整，请重新扫描")?,
                ));
            }
            targets.push(Target {
                id,
                name: node.name.to_string_lossy().into(),
                path: path.display().to_string(),
                directory: node.kind == Kind::Directory,
                partial: node.partial || !node.finished,
                bytes: node.bytes,
            });
            evidence.push(chain);
        }
        let plan = Plan {
            id: format!("disk-trash-{}", NEXT_SCAN.fetch_add(1, Ordering::Relaxed)),
            scan_id: scan_id.into(),
            root_path: tree.root.display().to_string(),
            targets,
            evidence,
        };
        drop(tree);
        registry.pending = Some(plan.clone());
        Ok(plan)
    }

    fn cancel_removal(&self, id: &str) -> Result<(), String> {
        let mut registry = self.registry.lock().unwrap();
        if registry.pending.as_ref().is_some_and(|plan| plan.id == id) {
            registry.pending = None;
            Ok(())
        } else {
            Err("确认已失效".into())
        }
    }

    fn claim_removal(&self, id: &str) -> Result<(Plan, Arc<AtomicBool>), String> {
        let mut registry = self.registry.lock().unwrap();
        if registry.active.is_some() {
            return Err("移除正在执行".into());
        }
        let plan = registry
            .pending
            .as_ref()
            .filter(|plan| plan.id == id)
            .ok_or("确认已失效")?;
        let job = registry.job.as_ref().ok_or("扫描记录已失效")?;
        let mut tree = job.tree.lock().unwrap();
        if tree.summary.scan_id != plan.scan_id
            || tree.consumed
            || tree.summary.phase == Phase::Running
        {
            return Err("扫描记录已失效，请重新扫描".into());
        }
        tree.consumed = true;
        drop(tree);
        let stop = Arc::new(AtomicBool::new(false));
        let plan = registry.pending.take().unwrap();
        registry.active = Some((id.into(), stop.clone()));
        Ok((plan, stop))
    }
}

fn verify(chain: &[(PathBuf, Identity)]) -> Result<(), String> {
    for (path, expected) in chain {
        let metadata =
            fs::symlink_metadata(path).map_err(|e| format!("目标或路径已不存在或无法核实：{e}"))?;
        if metadata.file_type().is_symlink() || Identity::read(&metadata).as_ref() != Some(expected)
        {
            return Err(format!("对象或所在路径身份已变化：{}", path.display()));
        }
    }
    Ok(())
}

// Read the live mount table rather than relying on traversal completeness or st_dev.
#[cfg(target_os = "macos")]
pub(super) fn mount_paths() -> Result<Vec<PathBuf>, String> {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStrExt;
    for _ in 0..3 {
        let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, libc::MNT_NOWAIT) };
        if count < 0 {
            return Err(format!(
                "无法读取挂载关系：{}",
                std::io::Error::last_os_error()
            ));
        }
        let mut mounts: Vec<libc::statfs> =
            vec![unsafe { std::mem::zeroed() }; count as usize + 16];
        let read = unsafe {
            libc::getfsstat(
                mounts.as_mut_ptr(),
                (mounts.len() * std::mem::size_of::<libc::statfs>()) as i32,
                libc::MNT_NOWAIT,
            )
        };
        if read < 0 {
            return Err(format!(
                "无法读取挂载关系：{}",
                std::io::Error::last_os_error()
            ));
        }
        if read as usize >= mounts.len() {
            continue;
        }
        return mounts[..read as usize]
            .iter()
            .map(|mount| {
                let bytes = unsafe { CStr::from_ptr(mount.f_mntonname.as_ptr()) }.to_bytes();
                let path = PathBuf::from(std::ffi::OsStr::from_bytes(bytes));
                path.canonicalize()
                    .map_err(|e| format!("无法核实挂载目录 {}：{e}", path.display()))
            })
            .collect();
    }
    Err("挂载关系持续变化，请稍后重试".into())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn mount_paths() -> Result<Vec<PathBuf>, String> {
    Err("当前平台不支持此废纸篓操作".into())
}

fn execute(
    plan: &Plan,
    stop: &AtomicBool,
    mut mounts: impl FnMut() -> Result<Vec<PathBuf>, String>,
    mut trash: impl FnMut(&Path) -> Result<(), String>,
    mut record: impl FnMut(&Item),
    mut progress: impl FnMut(Progress),
) -> Outcome {
    let mut results = Vec::new();
    for (target, chain) in plan.targets.iter().zip(&plan.evidence) {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        progress(Progress {
            plan_id: plan.id.clone(),
            total: plan.targets.len(),
            completed: results.len(),
            current_path: Some(target.path.clone()),
            item: None,
        });
        let path = chain.last().unwrap().0.as_path();
        let check = verify(chain).and_then(|_| mounts()).and_then(|mounts| {
            if contains_mount(path, &chain.last().unwrap().1, target.directory, &mounts)? {
                Err("目标是挂载点或包含挂载目录，已跳过；不会自动卸载".into())
            } else {
                verify(chain)
            }
        });
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let (status, message) = match check {
            Err(error) => ("skipped", Some(error)),
            Ok(()) => match trash(path) {
                Ok(()) => ("moved", None),
                Err(error) => ("failed", Some(error)),
            },
        };
        let item = Item {
            id: target.id,
            path: target.path.clone(),
            status: status.into(),
            message,
        };
        record(&item);
        results.push(item.clone());
        progress(Progress {
            plan_id: plan.id.clone(),
            total: plan.targets.len(),
            completed: results.len(),
            current_path: None,
            item: Some(item),
        });
    }
    Outcome {
        stopped: results.len() < plan.targets.len(),
        results,
    }
}

fn contains_mount(
    path: &Path,
    identity: &Identity,
    directory: bool,
    mounts: &[PathBuf],
) -> Result<bool, String> {
    for mount in mounts {
        if mount == path || (directory && mount.starts_with(path)) {
            return Ok(true);
        }
        // macOS firmlinks expose the same directories under /Users and /System/Volumes/Data/Users.
        // Compare ancestor identities as well as paths so a mount alias cannot evade the boundary.
        for ancestor in mount.ancestors() {
            let metadata = fs::symlink_metadata(ancestor)
                .map_err(|error| format!("无法核实挂载路径 {}：{error}", ancestor.display()))?;
            let observed = Identity::read(&metadata).ok_or("无法核实挂载路径身份")?;
            if &observed == identity {
                return Ok(true);
            }
            if !directory {
                break;
            }
        }
    }
    Ok(false)
}

fn run_batch(
    state: &DiskScanState,
    history: &MaintenanceHistoryState,
    id: &str,
    mounts: impl FnMut() -> Result<Vec<PathBuf>, String>,
    trash: impl FnMut(&Path) -> Result<(), String>,
    progress: impl FnMut(Progress),
) -> Result<Receipt<Outcome>, String> {
    let (plan, stop) = state.claim_removal(id)?;
    // Release the operation lock even if execution unwinds; the scan stays consumed.
    struct Release<'a>(&'a DiskScanState);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.0.registry.lock().unwrap().active = None;
        }
    }
    let _release = Release(state);
    maintenance_operation::run(
        history,
        OperationHeader {
            domain: MaintenanceDomain::DiskEntry,
            operation: MaintenanceOperation::RemoveDiskEntries,
            detail: MaintenanceDetail::DiskTrash(Detail {
                scan_id: plan.scan_id.clone(),
                root_path: plan.root_path.clone(),
                targets: plan.targets.clone(),
                results: Vec::new(),
                stopped: None,
            }),
            before_snapshot_id: None,
        },
        |sink| Ok(execute(&plan, &stop, mounts, trash, sink, progress)),
        |history, id, item| {
            history.update(id, |record| {
                let MaintenanceDetail::DiskTrash(detail) = &mut record.detail else {
                    return Err("维护记录类型不匹配".into());
                };
                detail.results.push(item.clone());
                Ok(())
            })
        },
        |history, id, end| {
            let (status, message) = match &end {
                OperationEnd::Aborted(error) => (ExecutionSummary::NotExecuted, error.to_string()),
                OperationEnd::Completed(outcome) => {
                    let moved = outcome
                        .results
                        .iter()
                        .filter(|item| item.status == "moved")
                        .count();
                    let failed = outcome
                        .results
                        .iter()
                        .filter(|item| item.status == "failed")
                        .count();
                    let skipped = outcome.results.len() - moved - failed;
                    let status = if moved == plan.targets.len() {
                        ExecutionSummary::Succeeded
                    } else if moved > 0 {
                        ExecutionSummary::Partial
                    } else if failed > 0 {
                        ExecutionSummary::Failed
                    } else {
                        ExecutionSummary::NotExecuted
                    };
                    (
                        status,
                        format!(
                            "已移入 {moved}，跳过 {skipped}，失败 {failed}，未执行 {}",
                            plan.targets.len() - outcome.results.len()
                        ),
                    )
                }
            };
            if let OperationEnd::Completed(outcome) = end {
                history.update(id, |record| {
                    if let MaintenanceDetail::DiskTrash(detail) = &mut record.detail {
                        detail.stopped = Some(outcome.stopped);
                    }
                    Ok(())
                })?;
            }
            history.finish(id, status, message)
        },
    )
}

#[tauri::command]
pub(crate) async fn prepare_disk_removal(
    scan_id: String,
    ids: Vec<usize>,
    state: tauri::State<'_, DiskScanState>,
) -> Result<Plan, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare_removal(&scan_id, ids))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_disk_removal(
    plan_id: String,
    state: tauri::State<'_, DiskScanState>,
) -> Result<(), String> {
    state.cancel_removal(&plan_id)
}

#[tauri::command]
pub(crate) fn stop_disk_removal(
    plan_id: String,
    state: tauri::State<'_, DiskScanState>,
) -> Result<(), String> {
    let registry = state.registry.lock().unwrap();
    let (_, stop) = registry
        .active
        .as_ref()
        .filter(|(id, _)| id == &plan_id)
        .ok_or("该批次已结束")?;
    stop.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub(crate) async fn run_disk_removal(
    plan_id: String,
    on_progress: tauri::ipc::Channel<Progress>,
    state: tauri::State<'_, DiskScanState>,
    history: tauri::State<'_, MaintenanceHistoryState>,
) -> Result<Receipt<Outcome>, String> {
    let state = state.inner().clone();
    let history = history.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_batch(
            &state,
            &history,
            &plan_id,
            mount_paths,
            crate::session_records::move_path_to_trash,
            |progress| {
                let _ = on_progress.send(progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn locate_disk_scan_directory(
    scan_id: String,
    path: String,
    state: tauri::State<'_, DiskScanState>,
) -> Result<usize, String> {
    let job = state.job(&scan_id)?;
    let tree = job.tree.lock().unwrap();
    let relative = Path::new(&path)
        .strip_prefix(&tree.root)
        .map_err(|_| "目录不在本轮范围内")?;
    let mut id = 0;
    for part in relative.components() {
        let Some(next) = tree.nodes[id].children.iter().find(|child| {
            tree.nodes[**child].kind == Kind::Directory
                && tree.nodes[**child].name == part.as_os_str()
        }) else {
            break;
        };
        id = *next;
    }
    Ok(id)
}

#[cfg(test)]
#[path = "disk_removal_tests.rs"]
mod tests;
