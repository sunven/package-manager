use crate::disk_usage::disk_usage;
use crate::types::DiskUsageStatus;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Url;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeStorageScan {
    pub storage_path: String,
    pub status: VscodeScanStatus,
    pub workspaces: Vec<VscodeWorkspace>,
    pub message: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) enum VscodeScanStatus {
    Ready,
    Partial,
    Missing,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VscodeWorkspace {
    pub id: String,
    pub name: String,
    pub project_path: Option<String>,
    pub storage_path: String,
    pub kind: WorkspaceKind,
    pub project_status: ProjectStatus,
    pub message: Option<String>,
    pub usage: WorkspaceUsage,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) enum WorkspaceKind {
    Folder,
    Workspace,
    Unknown,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) enum ProjectStatus {
    Available,
    Missing,
    Remote,
    Unknown,
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceUsage {
    pub bytes: Option<u64>,
    pub complete: bool,
    pub message: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceMetadata {
    folder: Option<String>,
    workspace: Option<String>,
}

pub(crate) fn scan_default() -> Result<VscodeStorageScan, String> {
    if !cfg!(target_os = "macos") {
        return Err("VS Code 占用目前只支持 macOS 的默认数据目录".to_string());
    }
    let home = std::env::var_os("HOME")
        .filter(|value| Path::new(value).is_absolute())
        .ok_or_else(|| "无法确定当前用户的主目录".to_string())?;
    scan_storage(&Path::new(&home).join("Library/Application Support/Code/User/workspaceStorage"))
}

fn scan_storage(root: &Path) -> Result<VscodeStorageScan, String> {
    let mut scan = VscodeStorageScan {
        storage_path: root.to_string_lossy().into_owned(),
        status: VscodeScanStatus::Ready,
        workspaces: Vec::new(),
        message: None,
    };
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            scan.status = VscodeScanStatus::Missing;
            return Ok(scan);
        }
        Err(error) => return Err(format!("无法读取工作区存储目录：{error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("工作区存储路径不是普通目录，未跟随符号链接".to_string());
    }
    let entries = fs::read_dir(root).map_err(|error| format!("无法读取工作区存储目录：{error}"))?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                scan.status = VscodeScanStatus::Partial;
                scan.message
                    .get_or_insert_with(|| format!("部分存储目录无法读取：{error}"));
                continue;
            }
        };
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path);
        if metadata.as_ref().is_ok_and(|value| value.is_file()) {
            continue;
        }
        let mut workspace = VscodeWorkspace {
            id: entry.file_name().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            project_path: None,
            storage_path: path.to_string_lossy().into_owned(),
            kind: WorkspaceKind::Unknown,
            project_status: ProjectStatus::Unknown,
            message: None,
            usage: WorkspaceUsage {
                bytes: None,
                complete: false,
                message: None,
            },
        };
        match metadata {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                identify_workspace(&path, &mut workspace);
                let usage = disk_usage(&path);
                workspace.usage = WorkspaceUsage {
                    bytes: usage.bytes,
                    complete: usage.status == DiskUsageStatus::Ready && usage.message.is_none(),
                    message: usage.message,
                };
            }
            Ok(_) => {
                workspace.usage.message = Some("不是普通存储目录，未跟随符号链接".to_string());
            }
            Err(error) => {
                workspace.usage.message = Some(format!("无法读取存储目录：{error}"));
            }
        }
        if !workspace.usage.complete {
            scan.status = VscodeScanStatus::Partial;
        }
        scan.workspaces.push(workspace);
    }
    scan.workspaces
        .sort_by(|left, right| left.id.cmp(&right.id));
    Ok(scan)
}

fn identify_workspace(path: &Path, workspace: &mut VscodeWorkspace) {
    match read_workspace_uri(path) {
        Ok((kind, uri)) => {
            workspace.kind = kind;
            if uri.scheme() == "file" {
                let Ok(project_path) = uri.to_file_path() else {
                    workspace.message = Some("工作区文件 URI 无法转换为本地路径".to_string());
                    return;
                };
                workspace.name = project_path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| project_path.to_string_lossy().into_owned());
                workspace.project_path = Some(project_path.to_string_lossy().into_owned());
                match fs::metadata(&project_path) {
                    Ok(_) => workspace.project_status = ProjectStatus::Available,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        workspace.project_status = ProjectStatus::Missing;
                    }
                    Err(error) => {
                        workspace.project_status = ProjectStatus::Unavailable;
                        workspace.message = Some(format!("无法确认项目路径状态：{error}"));
                    }
                }
            } else {
                workspace.name = uri
                    .path()
                    .rsplit('/')
                    .find(|part| !part.is_empty())
                    .unwrap_or(&workspace.id)
                    .to_string();
                workspace.project_path = Some(uri.to_string());
                workspace.project_status = ProjectStatus::Remote;
            }
        }
        Err(message) => workspace.message = Some(message),
    }
}

fn read_workspace_uri(path: &Path) -> Result<(WorkspaceKind, Url), String> {
    let path = path.join("workspace.json");
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| format!("无法读取项目映射：{error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("项目映射不是普通文件".to_string());
    }
    let contents =
        fs::read_to_string(path).map_err(|error| format!("无法读取项目映射：{error}"))?;
    let metadata: WorkspaceMetadata =
        serde_json::from_str(&contents).map_err(|error| format!("项目映射格式无效：{error}"))?;
    let (kind, value) = match (metadata.folder, metadata.workspace) {
        (Some(folder), _) => (WorkspaceKind::Folder, folder),
        (_, Some(workspace)) => (WorkspaceKind::Workspace, workspace),
        _ => return Err("项目映射缺少文件夹或工作区位置".to_string()),
    };
    let uri = Url::parse(&value).map_err(|error| format!("工作区 URI 无效：{error}"))?;
    Ok((kind, uri))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root =
                std::env::temp_dir().join(format!("vscode-storage-{}-{stamp}", std::process::id()));
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
            fs::write(path.join("state.vscdb"), vec![b'x'; 8192]).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preserves_duplicate_projects_and_decodes_file_uris() {
        let fixture = Fixture::new();
        let project = fixture.0.join("中文 project #1");
        fs::create_dir(&project).unwrap();
        let uri = Url::from_directory_path(&project).unwrap().to_string();
        fixture.workspace("-790c4ea6", Some(json!({ "folder": uri })));
        fixture.workspace("second", Some(json!({ "folder": uri })));
        fs::write(fixture.storage().join(".DS_Store"), b"ignored").unwrap();

        let scan = scan_storage(&fixture.storage()).unwrap();
        assert_eq!(scan.status, VscodeScanStatus::Ready);
        assert_eq!(scan.workspaces.len(), 2);
        for workspace in &scan.workspaces {
            assert_eq!(workspace.name, "中文 project #1");
            assert_eq!(
                workspace.project_path.as_deref().map(Path::new),
                Some(project.as_path())
            );
            assert_eq!(workspace.project_status, ProjectStatus::Available);
            assert!(workspace.usage.complete);
            assert!(workspace.usage.bytes.unwrap() > 0);
        }
        assert_ne!(
            scan.workspaces[0].storage_path,
            scan.workspaces[1].storage_path
        );
    }

    #[test]
    fn keeps_missing_projects_and_missing_or_invalid_mappings() {
        let fixture = Fixture::new();
        let missing = Url::from_file_path(fixture.0.join("removed-project")).unwrap();
        fixture.workspace(
            "missing-project",
            Some(json!({ "folder": missing.as_str() })),
        );
        fixture.workspace("no-mapping", None);
        let malformed = fixture.workspace("bad-json", None);
        fs::write(malformed.join("workspace.json"), b"{").unwrap();
        fixture.workspace("bad-uri", Some(json!({ "folder": "not a URI" })));
        fixture.workspace("empty-mapping", Some(json!({})));

        let scan = scan_storage(&fixture.storage()).unwrap();
        assert_eq!(scan.workspaces.len(), 5);
        assert_eq!(scan.status, VscodeScanStatus::Ready);
        assert_eq!(
            scan.workspaces
                .iter()
                .filter(|row| row.project_status == ProjectStatus::Missing)
                .count(),
            1
        );
        assert_eq!(
            scan.workspaces
                .iter()
                .filter(|row| row.project_status == ProjectStatus::Unknown)
                .count(),
            4
        );
        assert!(scan
            .workspaces
            .iter()
            .all(|row| row.usage.complete && row.usage.bytes.unwrap() > 0));
        assert!(scan
            .workspaces
            .iter()
            .filter(|row| row.project_status == ProjectStatus::Unknown)
            .all(|row| row.message.is_some() && row.name == row.id));
    }

    #[test]
    fn recognizes_workspace_mappings_without_relying_on_extensions_and_keeps_remote_uris() {
        let fixture = Fixture::new();
        for name in ["team.code-workspace", "workspace.json"] {
            let project = fixture.0.join(name);
            fs::write(&project, b"{}").unwrap();
            fixture.workspace(
                name,
                Some(json!({ "workspace": Url::from_file_path(project).unwrap().as_str() })),
            );
        }
        let remote = "vscode-remote://ssh-remote+test-host/home/dev/project";
        fixture.workspace("remote", Some(json!({ "folder": remote })));

        let scan = scan_storage(&fixture.storage()).unwrap();
        assert_eq!(
            scan.workspaces
                .iter()
                .filter(|row| row.kind == WorkspaceKind::Workspace)
                .count(),
            2
        );
        let row = scan
            .workspaces
            .iter()
            .find(|row| row.id == "remote")
            .unwrap();
        assert_eq!(row.project_status, ProjectStatus::Remote);
        assert_eq!(row.project_path.as_deref(), Some(remote));
        assert_eq!(row.name, "project");
        assert!(row.usage.complete);
    }

    #[test]
    fn distinguishes_missing_empty_and_invalid_storage_roots() {
        let fixture = Fixture::new();
        assert_eq!(
            scan_storage(&fixture.0.join("missing")).unwrap().status,
            VscodeScanStatus::Missing
        );
        let empty = scan_storage(&fixture.storage()).unwrap();
        assert_eq!(empty.status, VscodeScanStatus::Ready);
        assert!(empty.workspaces.is_empty());
        let file = fixture.0.join("file");
        fs::write(&file, b"not a directory").unwrap();
        assert!(scan_storage(&file).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn deduplicates_hardlinks_and_does_not_follow_storage_symlinks() {
        use std::os::unix::fs::{symlink, MetadataExt};
        let fixture = Fixture::new();
        let path = fixture.workspace("original", None);
        let state = path.join("state.vscdb");
        fs::hard_link(&state, path.join("duplicate")).unwrap();
        symlink(&fixture.0, path.join("outside")).unwrap();
        symlink(&path, fixture.storage().join("linked")).unwrap();
        let scan = scan_storage(&fixture.storage()).unwrap();
        let original = scan
            .workspaces
            .iter()
            .find(|row| row.id == "original")
            .unwrap();
        assert_eq!(
            original.usage.bytes,
            Some(fs::metadata(state).unwrap().blocks() * 512)
        );
        assert!(original.usage.complete);
        let linked = scan
            .workspaces
            .iter()
            .find(|row| row.id == "linked")
            .unwrap();
        assert_eq!(linked.usage.bytes, None);
        assert!(!linked.usage.complete);
        assert_eq!(scan.status, VscodeScanStatus::Partial);
    }

    #[cfg(unix)]
    #[test]
    fn reports_incomplete_measurements_and_inaccessible_roots() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let path = fixture.workspace("partial", None);
        let unreadable = path.join("unreadable");
        fs::create_dir(&unreadable).unwrap();
        fs::write(unreadable.join("data"), b"inaccessible").unwrap();
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
        // A root test runner can bypass filesystem permissions.
        if fs::read_dir(&unreadable).is_ok() {
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700)).unwrap();
            return;
        }
        let scan = scan_storage(&fixture.storage());
        let inaccessible_root = scan_storage(&unreadable);
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700)).unwrap();
        let scan = scan.unwrap();
        assert_eq!(scan.status, VscodeScanStatus::Partial);
        assert!(!scan.workspaces[0].usage.complete);
        assert!(scan.workspaces[0].usage.bytes.unwrap() > 0);
        assert!(scan.workspaces[0]
            .usage
            .message
            .as_ref()
            .unwrap()
            .contains("unreadable"));
        assert!(inaccessible_root.is_err());
    }
}
