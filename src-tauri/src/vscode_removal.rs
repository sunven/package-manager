use crate::session_records;
use crate::vscode_storage::{self, ProjectStatus};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum VscodeEditorStatus {
    Stopped,
    Running,
    Unknown,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeStorageRemovalResult {
    pub moved: u32,
    pub failed: u32,
    pub skipped: u32,
    pub items: Vec<VscodeStorageRemovalItem>,
    pub operation_error: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeStorageRemovalItem {
    pub(crate) id: String,
    pub(crate) status: VscodeStorageRemovalStatus,
    pub(crate) reason: Option<VscodeStorageRemovalReason>,
    pub(crate) message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) enum VscodeStorageRemovalStatus {
    Moved,
    Skipped,
    Failed,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) enum VscodeStorageRemovalReason {
    NoLongerRecord,
    ProjectAvailable,
    ProjectRemote,
    ProjectUnavailable,
    NotRegularDirectory,
    TargetUnreadable,
    EditorStarted,
    TrashFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub(crate) enum VscodeStorageRemovalProgress {
    Preparing,
    Started {
        total: usize,
    },
    Advanced {
        processed: usize,
        total: usize,
        moved: u32,
        skipped: u32,
        failed: u32,
    },
}

fn record_vscode_item(
    result: &mut VscodeStorageRemovalResult,
    on_item: &mut dyn FnMut(&VscodeStorageRemovalItem),
    id: &str,
    status: VscodeStorageRemovalStatus,
    reason: Option<VscodeStorageRemovalReason>,
    message: Option<String>,
) {
    result.record(id, status, reason, message);
    if let Some(item) = result.items.last() {
        on_item(item);
    }
}

impl VscodeStorageRemovalResult {
    fn aborted(message: String) -> Self {
        Self {
            operation_error: Some(message),
            ..Self::default()
        }
    }

    fn record(
        &mut self,
        id: &str,
        status: VscodeStorageRemovalStatus,
        reason: Option<VscodeStorageRemovalReason>,
        message: Option<String>,
    ) {
        match status {
            VscodeStorageRemovalStatus::Moved => self.moved += 1,
            VscodeStorageRemovalStatus::Skipped => self.skipped += 1,
            VscodeStorageRemovalStatus::Failed => self.failed += 1,
        }
        self.items.push(VscodeStorageRemovalItem {
            id: id.to_string(),
            status,
            reason,
            message,
        });
    }
}

pub(crate) fn detect_editor_status() -> VscodeEditorStatus {
    match Command::new("pgrep").arg("-x").arg("Code").status() {
        Ok(status) => editor_status_from_code(status.code()),
        Err(_) => VscodeEditorStatus::Unknown,
    }
}

fn editor_status_from_code(code: Option<i32>) -> VscodeEditorStatus {
    match code {
        Some(0) => VscodeEditorStatus::Running,
        Some(1) => VscodeEditorStatus::Stopped,
        _ => VscodeEditorStatus::Unknown,
    }
}

pub(crate) fn remove_selected_default_with_reporter(
    ids: &[String],
    report: &mut dyn FnMut(VscodeStorageRemovalProgress),
    on_item: &mut dyn FnMut(&VscodeStorageRemovalItem),
) -> Result<VscodeStorageRemovalResult, String> {
    let root = vscode_storage::default_storage_root()?;
    let editor_status = || detect_editor_status();
    let mut trash = |path: &Path| session_records::move_path_to_trash(path);
    Ok(remove_selected_with_reporter(
        &root,
        ids,
        &editor_status,
        &mut trash,
        report,
        on_item,
    ))
}

#[cfg(test)]
fn remove_selected(
    root: &Path,
    ids: &[String],
    editor_status: &dyn Fn() -> VscodeEditorStatus,
    trash: &mut dyn FnMut(&Path) -> Result<(), String>,
    report: &mut dyn FnMut(VscodeStorageRemovalProgress),
) -> VscodeStorageRemovalResult {
    remove_selected_with_reporter(root, ids, editor_status, trash, report, &mut |_| {})
}

fn remove_selected_with_reporter(
    root: &Path,
    ids: &[String],
    editor_status: &dyn Fn() -> VscodeEditorStatus,
    trash: &mut dyn FnMut(&Path) -> Result<(), String>,
    report: &mut dyn FnMut(VscodeStorageRemovalProgress),
    on_item: &mut dyn FnMut(&VscodeStorageRemovalItem),
) -> VscodeStorageRemovalResult {
    report(VscodeStorageRemovalProgress::Preparing);

    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return VscodeStorageRemovalResult::aborted(
                "工作区存储路径不是普通目录，未跟随符号链接".into(),
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return VscodeStorageRemovalResult::aborted("工作区存储目录不存在".into())
        }
        Err(_) => {
            return VscodeStorageRemovalResult::aborted("无法读取工作区存储目录".into())
        }
    }

    match editor_status() {
        VscodeEditorStatus::Stopped => {}
        VscodeEditorStatus::Running => {
            return VscodeStorageRemovalResult::aborted(
                "VS Code 正在运行，请先退出 VS Code".into(),
            )
        }
        VscodeEditorStatus::Unknown => {
            return VscodeStorageRemovalResult::aborted(
                "无法确认 VS Code 是否运行，请退出 VS Code 后重试".into(),
            )
        }
    }

    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for id in ids {
        if seen.insert(id.clone()) {
            unique.push(id.clone());
        }
    }
    let total = unique.len();
    report(VscodeStorageRemovalProgress::Started { total });

    let mut result = VscodeStorageRemovalResult::default();
    for (index, id) in unique.iter().enumerate() {
        if editor_status() != VscodeEditorStatus::Stopped {
            let message = format!("VS Code 已启动，剩余 {} 项未处理", total - index);
            for skipped in &unique[index..] {
                record_vscode_item(
                    &mut result,
                    on_item,
                    skipped,
                    VscodeStorageRemovalStatus::Skipped,
                    Some(VscodeStorageRemovalReason::EditorStarted),
                    Some(message.clone()),
                );
            }
            result.message = Some(message);
            break;
        }

        let path = match storage_entry(root, id) {
            Ok(path) => path,
            Err((reason, message)) => {
                record_vscode_item(
                    &mut result,
                    on_item,
                    id,
                    VscodeStorageRemovalStatus::Skipped,
                    Some(reason),
                    Some(message),
                );
                report_advanced(report, &result, index + 1, total);
                continue;
            }
        };

        match vscode_storage::inspect_project_status(&path) {
            ProjectStatus::Available => {
                record_vscode_item(
                    &mut result,
                    on_item,
                    id,
                    VscodeStorageRemovalStatus::Skipped,
                    Some(VscodeStorageRemovalReason::ProjectAvailable),
                    Some("项目路径已恢复，留在原处".into()),
                );
                report_advanced(report, &result, index + 1, total);
                continue;
            }
            ProjectStatus::Remote => {
                record_vscode_item(
                    &mut result,
                    on_item,
                    id,
                    VscodeStorageRemovalStatus::Skipped,
                    Some(VscodeStorageRemovalReason::ProjectRemote),
                    Some("记录已变成远程工作区，留在原处".into()),
                );
                report_advanced(report, &result, index + 1, total);
                continue;
            }
            ProjectStatus::Unavailable => {
                record_vscode_item(
                    &mut result,
                    on_item,
                    id,
                    VscodeStorageRemovalStatus::Skipped,
                    Some(VscodeStorageRemovalReason::ProjectUnavailable),
                    Some("无法确认项目路径状态，留在原处".into()),
                );
                report_advanced(report, &result, index + 1, total);
                continue;
            }
            ProjectStatus::Missing | ProjectStatus::Unknown => {}
        }

        match trash(&path) {
            Ok(()) => record_vscode_item(
                &mut result,
                on_item,
                id,
                VscodeStorageRemovalStatus::Moved,
                None,
                None,
            ),
            Err(message) => record_vscode_item(
                &mut result,
                on_item,
                id,
                VscodeStorageRemovalStatus::Failed,
                Some(VscodeStorageRemovalReason::TrashFailed),
                Some(message),
            ),
        }
        report_advanced(report, &result, index + 1, total);
    }

    result
}

fn report_advanced(
    report: &mut dyn FnMut(VscodeStorageRemovalProgress),
    result: &VscodeStorageRemovalResult,
    processed: usize,
    total: usize,
) {
    report(VscodeStorageRemovalProgress::Advanced {
        processed,
        total,
        moved: result.moved,
        skipped: result.skipped,
        failed: result.failed,
    });
}

fn storage_entry(
    root: &Path,
    id: &str,
) -> Result<PathBuf, (VscodeStorageRemovalReason, String)> {
    let invalid = || {
        (
            VscodeStorageRemovalReason::NoLongerRecord,
            "记录标识无效，留在原处".to_string(),
        )
    };
    let relative = Path::new(id);
    let mut components = relative.components();
    let Some(Component::Normal(_)) = components.next() else {
        return Err(invalid());
    };
    if components.next().is_some() {
        return Err(invalid());
    }

    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return Err((
                VscodeStorageRemovalReason::NotRegularDirectory,
                "工作区存储路径不是普通目录，未跟随符号链接".to_string(),
            ))
        }
        Err(_) => {
            return Err((
                VscodeStorageRemovalReason::NoLongerRecord,
                "工作区存储目录已不可用，留在原处".to_string(),
            ))
        }
    }

    let path = root.join(relative);
    if path.parent() != Some(root) {
        return Err(invalid());
    }
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(path),
        Ok(_) => Err((
            VscodeStorageRemovalReason::NotRegularDirectory,
            "不是普通存储目录，未跟随符号链接".to_string(),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err((
            VscodeStorageRemovalReason::NoLongerRecord,
            "记录已不存在，留在原处".to_string(),
        )),
        Err(error) => Err((
            VscodeStorageRemovalReason::TargetUnreadable,
            format!("无法读取存储目录：{error}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::Url;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root =
                std::env::temp_dir().join(format!("vscode-removal-{}-{stamp}", std::process::id()));
            fs::create_dir_all(root.join("workspaceStorage")).unwrap();
            Self(root)
        }

        fn storage(&self) -> PathBuf {
            self.0.join("workspaceStorage")
        }

        fn workspace(&self, id: &str, mapping: Option<serde_json::Value>) -> PathBuf {
            let path = self.storage().join(id);
            fs::create_dir_all(&path).unwrap();
            if let Some(mapping) = mapping {
                fs::write(
                    path.join("workspace.json"),
                    serde_json::to_vec(&mapping).unwrap(),
                )
                .unwrap();
            }
            fs::write(path.join("state.vscdb"), vec![b'x'; 128]).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn missing_mapping(fixture: &Fixture) -> serde_json::Value {
        json!({
            "folder": Url::from_file_path(fixture.0.join("removed"))
                .unwrap()
                .as_str(),
        })
    }

    #[test]
    fn editor_status_maps_pgrep_exit_codes() {
        assert_eq!(
            editor_status_from_code(Some(0)),
            VscodeEditorStatus::Running
        );
        assert_eq!(
            editor_status_from_code(Some(1)),
            VscodeEditorStatus::Stopped
        );
        assert_eq!(
            editor_status_from_code(Some(2)),
            VscodeEditorStatus::Unknown
        );
        assert_eq!(editor_status_from_code(None), VscodeEditorStatus::Unknown);
    }

    #[test]
    fn moves_missing_and_unknown_records_and_reports_progress() {
        let fixture = Fixture::new();
        fixture.workspace("missing", Some(missing_mapping(&fixture)));
        fixture.workspace("unknown", None);

        let mut trashed = Vec::new();
        let mut trash = |path: &Path| {
            trashed.push(path.to_path_buf());
            Ok(())
        };
        let mut progress = Vec::new();
        let mut report = |event: VscodeStorageRemovalProgress| progress.push(event);
        let result = remove_selected(
            &fixture.storage(),
            &["missing".to_string(), "unknown".to_string()],
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.moved, 2);
        assert_eq!(result.failed, 0);
        assert_eq!(result.skipped, 0);
        assert!(result
            .items
            .iter()
            .all(|item| item.status == VscodeStorageRemovalStatus::Moved));
        assert_eq!(
            trashed,
            vec![
                fixture.storage().join("missing"),
                fixture.storage().join("unknown")
            ]
        );
        assert_eq!(
            progress,
            vec![
                VscodeStorageRemovalProgress::Preparing,
                VscodeStorageRemovalProgress::Started { total: 2 },
                VscodeStorageRemovalProgress::Advanced {
                    processed: 1,
                    total: 2,
                    moved: 1,
                    skipped: 0,
                    failed: 0,
                },
                VscodeStorageRemovalProgress::Advanced {
                    processed: 2,
                    total: 2,
                    moved: 2,
                    skipped: 0,
                    failed: 0,
                },
            ]
        );
    }

    #[test]
    fn skips_a_record_whose_project_path_reappeared() {
        let fixture = Fixture::new();
        let project = fixture.0.join("restored");
        let mapping = json!({
            "folder": Url::from_file_path(&project).unwrap().as_str(),
        });
        fixture.workspace("restored", Some(mapping));
        fs::create_dir(&project).unwrap();

        let mut trash = |_: &Path| -> Result<(), String> {
            panic!("a restored project must not be trashed")
        };
        let mut report = |_: VscodeStorageRemovalProgress| {};
        let result = remove_selected(
            &fixture.storage(),
            &["restored".to_string()],
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.skipped, 1);
        assert_eq!(
            result.items[0].reason,
            Some(VscodeStorageRemovalReason::ProjectAvailable)
        );
        assert!(result.message.is_none());
    }

    #[test]
    fn skips_remote_and_unavailable_projects() {
        let fixture = Fixture::new();
        fixture.workspace(
            "remote",
            Some(json!({ "folder": "vscode-remote://ssh-remote+host/home/project" })),
        );
        let blocker = fixture.0.join("blocker");
        fs::write(&blocker, b"not a directory").unwrap();
        let unavailable = blocker.join("project");
        fixture.workspace(
            "unavailable",
            Some(json!({ "folder": Url::from_file_path(&unavailable).unwrap().as_str() })),
        );

        let mut trash = |_: &Path| -> Result<(), String> {
            panic!("remote and unavailable projects must not be trashed")
        };
        let mut report = |_: VscodeStorageRemovalProgress| {};
        let result = remove_selected(
            &fixture.storage(),
            &["remote".to_string(), "unavailable".to_string()],
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.skipped, 2);
        assert_eq!(
            result.items[0].reason,
            Some(VscodeStorageRemovalReason::ProjectRemote)
        );
        assert_eq!(
            result.items[1].reason,
            Some(VscodeStorageRemovalReason::ProjectUnavailable)
        );
    }

    #[test]
    fn refuses_to_start_while_the_editor_is_running() {
        let fixture = Fixture::new();
        fixture.workspace("missing", Some(missing_mapping(&fixture)));

        let mut trash = |_: &Path| -> Result<(), String> {
            panic!("nothing may be trashed while VS Code is running")
        };
        let mut progress = Vec::new();
        let mut report = |event: VscodeStorageRemovalProgress| progress.push(event);
        let result = remove_selected(
            &fixture.storage(),
            &["missing".to_string()],
            &|| VscodeEditorStatus::Running,
            &mut trash,
            &mut report,
        );

        assert!(result
            .operation_error
            .as_deref()
            .unwrap()
            .contains("VS Code 正在运行"));
        assert!(result.items.is_empty());
        assert_eq!(progress, vec![VscodeStorageRemovalProgress::Preparing]);
    }

    #[test]
    fn stops_remaining_records_if_the_editor_starts_mid_run() {
        let fixture = Fixture::new();
        fixture.workspace("first", Some(missing_mapping(&fixture)));
        fixture.workspace("second", Some(missing_mapping(&fixture)));

        let checks = std::cell::Cell::new(0);
        let editor_status = || {
            checks.set(checks.get() + 1);
            if checks.get() <= 2 {
                VscodeEditorStatus::Stopped
            } else {
                VscodeEditorStatus::Running
            }
        };
        let mut trashed = Vec::new();
        let mut trash = |path: &Path| {
            trashed.push(path.to_path_buf());
            Ok(())
        };
        let mut report = |_: VscodeStorageRemovalProgress| {};
        let result = remove_selected(
            &fixture.storage(),
            &["first".to_string(), "second".to_string()],
            &editor_status,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.moved, 1);
        assert_eq!(result.skipped, 1);
        assert_eq!(trashed, vec![fixture.storage().join("first")]);
        assert_eq!(
            result.items[1].reason,
            Some(VscodeStorageRemovalReason::EditorStarted)
        );
        assert!(result.message.as_deref().unwrap().contains("剩余 1 项"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_invalid_ids_symlinked_targets_and_missing_targets() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        symlink(&fixture.0, fixture.storage().join("linked")).unwrap();

        let mut trash = |_: &Path| -> Result<(), String> {
            panic!("invalid or non-directory targets must not be trashed")
        };
        let mut report = |_: VscodeStorageRemovalProgress| {};
        let ids = [
            "..".to_string(),
            "/tmp".to_string(),
            "nested/id".to_string(),
            "linked".to_string(),
            "gone".to_string(),
        ];
        let result = remove_selected(
            &fixture.storage(),
            &ids,
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.skipped, 5);
        assert_eq!(
            result.items[0].reason,
            Some(VscodeStorageRemovalReason::NoLongerRecord)
        );
        assert_eq!(
            result.items[1].reason,
            Some(VscodeStorageRemovalReason::NoLongerRecord)
        );
        assert_eq!(
            result.items[2].reason,
            Some(VscodeStorageRemovalReason::NoLongerRecord)
        );
        assert_eq!(
            result.items[3].reason,
            Some(VscodeStorageRemovalReason::NotRegularDirectory)
        );
        assert_eq!(
            result.items[4].reason,
            Some(VscodeStorageRemovalReason::NoLongerRecord)
        );
    }

    #[test]
    fn continues_after_a_trash_failure() {
        let fixture = Fixture::new();
        fixture.workspace("first", Some(missing_mapping(&fixture)));
        fixture.workspace("second", Some(missing_mapping(&fixture)));

        let mut calls = 0;
        let mut trash = |_: &Path| {
            calls += 1;
            if calls == 1 {
                Err("Finder 失败".to_string())
            } else {
                Ok(())
            }
        };
        let mut report = |_: VscodeStorageRemovalProgress| {};
        let result = remove_selected(
            &fixture.storage(),
            &["first".to_string(), "second".to_string()],
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.failed, 1);
        assert_eq!(result.moved, 1);
        assert_eq!(
            result.items[0].reason,
            Some(VscodeStorageRemovalReason::TrashFailed)
        );
        assert_eq!(result.items[1].status, VscodeStorageRemovalStatus::Moved);
    }

    #[test]
    fn deduplicates_ids_before_starting_progress() {
        let fixture = Fixture::new();
        fixture.workspace("same", Some(missing_mapping(&fixture)));

        let mut trash = |_: &Path| -> Result<(), String> { Ok(()) };
        let mut progress = Vec::new();
        let mut report = |event: VscodeStorageRemovalProgress| progress.push(event);
        let result = remove_selected(
            &fixture.storage(),
            &["same".to_string(), "same".to_string()],
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert_eq!(result.moved, 1);
        assert_eq!(
            progress[1],
            VscodeStorageRemovalProgress::Started { total: 1 }
        );
    }

    #[test]
    fn aborts_when_the_storage_root_is_missing() {
        let fixture = Fixture::new();
        let missing = fixture.0.join("missing");

        let mut trash = |_: &Path| -> Result<(), String> {
            panic!("nothing may be trashed without a storage root")
        };
        let mut report = |_: VscodeStorageRemovalProgress| {};
        let result = remove_selected(
            &missing,
            &["anything".to_string()],
            &|| VscodeEditorStatus::Stopped,
            &mut trash,
            &mut report,
        );

        assert!(result
            .operation_error
            .as_deref()
            .unwrap()
            .contains("不存在"));
    }
}
