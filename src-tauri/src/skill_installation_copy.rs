use crate::{codex_cli, observed_file::ObservedFile};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Source {
    Local {
        path: String,
    },
    Github {
        repo: String,
        subdirectory: String,
        reference: String,
        #[serde(rename = "referenceKind")]
        reference_kind: String,
    },
}

impl Source {
    pub fn label(&self) -> String {
        match self {
            Self::Local { path } => path.clone(),
            Self::Github {
                repo,
                subdirectory,
                reference,
                reference_kind,
            } => format!("{repo} · {subdirectory} · {reference_kind}: {reference}"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct Identity {
    dev: u64,
    ino: u64,
}

pub(crate) fn directory_identity(path: &Path) -> Result<Identity, String> {
    let meta =
        fs::symlink_metadata(path).map_err(|e| format!("无法读取目录 {}：{e}", path.display()))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("目录已变为链接或其他文件，请重新核对。".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(Identity {
            dev: meta.dev(),
            ino: meta.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        Err("技能文件维护当前仅支持 macOS。".into())
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
pub(crate) struct Installation {
    pub directory: PathBuf,
    pub identity: Identity,
    pub source: Source,
    pub revision: String,
    pub hash: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Records {
    version: u32,
    pub installations: BTreeMap<String, Installation>,
}

#[derive(Clone)]
pub(crate) struct Ledger {
    pub file: ObservedFile,
    pub records: Records,
}

#[derive(Clone)]
pub(crate) struct CopyWorkspace {
    home: PathBuf,
    ledger: Result<Ledger, String>,
    root: Result<Option<Identity>, String>,
}

pub(crate) struct CopyObservation {
    pub installation: Option<Installation>,
    pub update_blocked: Option<String>,
    pub uninstall_blocked: Option<String>,
}

impl CopyWorkspace {
    pub fn observe(home: &Path, record_path: &Path) -> Self {
        Self {
            home: home.to_path_buf(),
            ledger: Ledger::read_at(record_path),
            root: root_identity(home),
        }
    }

    pub fn ledger_error(&self) -> Option<&str> {
        self.ledger.as_ref().err().map(String::as_str)
    }

    pub fn root_error(&self) -> Option<&str> {
        self.root.as_ref().err().map(String::as_str)
    }

    pub fn installation(&self, path: &str) -> Option<&Installation> {
        self.ledger.as_ref().ok()?.records.installations.get(path)
    }

    pub fn recorded_paths(&self) -> impl Iterator<Item = &str> {
        self.ledger
            .as_ref()
            .ok()
            .into_iter()
            .flat_map(|ledger| ledger.records.installations.keys().map(String::as_str))
    }

    pub fn inspect(&self, path: &str) -> CopyObservation {
        let installation = self.installation(path).cloned();
        let blocked = self
            .ledger_error()
            .map(str::to_string)
            .or_else(|| self.root_error().map(str::to_string))
            .or_else(|| {
                installation.as_ref().and_then(|entry| {
                    if entry.directory.join("SKILL.md") != Path::new(path) {
                        Some("技能路径与安装记录不一致，不能维护。".into())
                    } else {
                        owned(&self.home, entry).err()
                    }
                })
            });
        let update_blocked = blocked.clone().or_else(|| {
            installation
                .as_ref()
                .and_then(|entry| match fingerprint(&entry.directory) {
                    Ok(hash) if hash == entry.hash => None,
                    Ok(_) => Some("安装副本有本地修改，更新已暂停。".into()),
                    Err(error) => Some(error),
                })
        });
        CopyObservation {
            installation,
            update_blocked,
            uninstall_blocked: blocked,
        }
    }

    pub fn check_current(&self) -> Result<(), String> {
        let ledger = self.ledger.as_ref().map_err(Clone::clone)?;
        let root = self.root.as_ref().map_err(Clone::clone)?;
        if !ledger.file.unchanged() || root_identity(&self.home)? != *root {
            return Err("技能、安装记录或配置已变化，请刷新并重新确认。".into());
        }
        Ok(())
    }

    pub fn prepare_install(&self, source: &Source) -> Result<PreparedCopyChange, String> {
        self.check_ready()?;
        let staged = stage(&self.home, source, None)?;
        Ok(PreparedCopyChange::new(
            self.clone(),
            ChangeKind::Install,
            Some(staged),
            None,
            None,
        ))
    }

    pub fn prepare_update(&self, path: &str) -> Result<PreparedCopyChange, String> {
        self.check_ready()?;
        let entry = self
            .installation(path)
            .ok_or("非本应用安装的技能不能更新。")?
            .clone();
        if entry.directory.join("SKILL.md") != Path::new(path) {
            return Err("技能路径与安装记录不一致，不能维护。".into());
        }
        owned(&self.home, &entry)?;
        let content_hash = fingerprint(&entry.directory)?;
        if content_hash != entry.hash {
            return Err("安装副本有本地修改，更新已停止；请保留并处理修改。".into());
        }
        let pinned = matches!(&entry.source, Source::Github { reference_kind, .. } if reference_kind == "tag")
            .then_some(entry.revision.as_str());
        let staged = stage(&self.home, &entry.source, pinned)?;
        Ok(PreparedCopyChange::new(
            self.clone(),
            ChangeKind::Update,
            Some(staged),
            Some(entry),
            Some(content_hash),
        ))
    }

    pub fn prepare_uninstall(&self, path: &str) -> Result<PreparedCopyChange, String> {
        self.check_ready()?;
        let entry = self
            .installation(path)
            .ok_or("非本应用安装的技能不能卸载。")?
            .clone();
        if entry.directory.join("SKILL.md") != Path::new(path) {
            return Err("技能路径与安装记录不一致，不能维护。".into());
        }
        owned(&self.home, &entry)?;
        let content_hash = fingerprint(&entry.directory)?;
        Ok(PreparedCopyChange::new(
            self.clone(),
            ChangeKind::Uninstall,
            None,
            Some(entry),
            Some(content_hash),
        ))
    }

    fn check_ready(&self) -> Result<(), String> {
        self.ledger.as_ref().map_err(Clone::clone)?;
        self.root.as_ref().map_err(Clone::clone)?;
        self.check_current()
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum ChangeKind {
    Install,
    Update,
    Uninstall,
}

pub(crate) struct PreparedCopyChange {
    workspace: CopyWorkspace,
    kind: ChangeKind,
    staged: Option<Staged>,
    installation: Option<Installation>,
    content_hash: Option<String>,
}

pub(crate) struct StagedView<'a> {
    pub temp_home: &'a Path,
    pub directory: &'a Path,
    pub name: &'a str,
}

impl PreparedCopyChange {
    fn new(
        workspace: CopyWorkspace,
        kind: ChangeKind,
        staged: Option<Staged>,
        installation: Option<Installation>,
        content_hash: Option<String>,
    ) -> Self {
        Self {
            workspace,
            kind,
            staged,
            installation,
            content_hash,
        }
    }

    pub fn staged(&self) -> Option<StagedView<'_>> {
        self.staged.as_ref().map(|staged| StagedView {
            temp_home: staged.temp.path(),
            directory: &staged.directory,
            name: &staged.name,
        })
    }

    pub fn revision(&self) -> Option<&str> {
        self.staged
            .as_ref()
            .map(|staged| staged.revision.as_str())
            .or_else(|| {
                self.installation
                    .as_ref()
                    .map(|entry| entry.revision.as_str())
            })
    }

    pub fn source_label(&self) -> Option<String> {
        self.staged
            .as_ref()
            .map(|staged| staged.source.label())
            .or_else(|| self.installation.as_ref().map(|entry| entry.source.label()))
    }

    pub fn target_path(&self) -> Option<PathBuf> {
        self.staged
            .as_ref()
            .map(|staged| {
                self.workspace
                    .home
                    .join("skills")
                    .join(&staged.name)
                    .join("SKILL.md")
            })
            .or_else(|| {
                self.installation
                    .as_ref()
                    .map(|entry| entry.directory.join("SKILL.md"))
            })
    }

    pub fn check_before_commit(&self) -> Result<(), String> {
        self.workspace.check_current()?;
        if let Some(entry) = &self.installation {
            owned(&self.workspace.home, entry)?;
            if Some(fingerprint(&entry.directory)?) != self.content_hash {
                return Err("技能安装副本已变化，请刷新并重新确认。".into());
            }
        }
        if let Some(staged) = &self.staged {
            if fingerprint(&staged.directory)? != staged.hash {
                return Err("准备的副本已变化，请重新检查。".into());
            }
        }
        Ok(())
    }

    pub fn commit(
        mut self,
        config: &ObservedFile,
        trash: &dyn Fn(&Path) -> Result<(), String>,
    ) -> CopyResult {
        if let Err(error) = self.check_before_commit() {
            return CopyResult::Conflict(error);
        }
        if !config.unchanged() {
            return CopyResult::Conflict("技能、安装记录或配置已变化，请刷新并重新确认。".into());
        }

        let mut ledger = match &self.workspace.ledger {
            Ok(ledger) => ledger.clone(),
            Err(error) => return CopyResult::Conflict(error.clone()),
        };
        let target = self
            .target_path()
            .expect("prepared file change has a target");
        let target = target.parent().expect("skill definition has a parent");
        let record_path = target.join("SKILL.md").display().to_string();

        if self.kind == ChangeKind::Uninstall {
            let holding = match tempfile::Builder::new()
                .prefix(".package-manager-uninstall-")
                .tempdir_in(&self.workspace.home)
            {
                Ok(holding) => holding,
                Err(error) => return CopyResult::Failed(error.to_string()),
            };
            let isolated = holding.path().join(target.file_name().unwrap());
            if let Err(error) = rename_new(target, &isolated) {
                return CopyResult::Conflict(error);
            }
            let entry = self.installation.as_ref().unwrap();
            let checked = directory_identity(&isolated) == Ok(entry.identity.clone())
                && fingerprint(&isolated).ok() == self.content_hash;
            let result = if checked {
                trash(&isolated)
            } else {
                Err("安装副本在操作期间发生变化。".into())
            };
            if let Err(error) = result {
                if rename_new(&isolated, target).is_ok() {
                    return CopyResult::failure(
                        if checked {
                            CopyFailure::Failed
                        } else {
                            CopyFailure::Conflict
                        },
                        error,
                    );
                }
                let recovery = holding.keep();
                return CopyResult::Partial(format!(
                    "{error}；移除未完整确认，请核对原目录、废纸篓及 {}。",
                    recovery.display()
                ));
            }
            ledger.records.installations.remove(&record_path);
            return match ledger.save() {
                Ok(()) => CopyResult::Succeeded(CopySuccess::Uninstalled),
                Err(error) => {
                    CopyResult::Partial(format!("副本已移入废纸篓，但{error}。请核对安装记录。"))
                }
            };
        }

        let candidate = self
            .staged
            .take()
            .expect("install and update changes have staging");
        if self.kind == ChangeKind::Update
            && self.installation.as_ref().is_some_and(|entry| {
                entry.hash == candidate.hash && entry.revision == candidate.revision
            })
        {
            return CopyResult::Succeeded(CopySuccess::Unchanged);
        }
        if self
            .workspace
            .root
            .as_ref()
            .ok()
            .is_some_and(Option::is_none)
        {
            if let Err(error) = fs::create_dir(self.workspace.home.join("skills")) {
                return CopyResult::Conflict(format!("无法创建安装目录：{error}"));
            }
        }
        let backup = candidate.temp.path().join("previous-installation");
        if self.kind == ChangeKind::Update {
            if let Err(error) = rename_new(target, &backup) {
                return CopyResult::Failed(error);
            }
            let entry = self.installation.as_ref().unwrap();
            if directory_identity(&backup) != Ok(entry.identity.clone())
                || fingerprint(&backup).ok() != self.content_hash
            {
                if rename_new(&backup, target).is_ok() {
                    return CopyResult::Conflict("原安装副本在操作期间发生变化。".into());
                }
                let recovery = candidate.temp.keep();
                return CopyResult::Partial(format!(
                    "目录在操作期间变化，原对象保留在 {}，请核对恢复。",
                    recovery.display()
                ));
            }
        }
        if let Err(error) = rename_new(&candidate.directory, target) {
            if backup.exists() && rename_new(&backup, target).is_err() {
                let recovery = candidate.temp.keep();
                return CopyResult::Partial(format!(
                    "{error}；旧副本保留在 {}，请核对恢复。",
                    recovery.display()
                ));
            }
            return CopyResult::Failed(error);
        }
        let identity = match directory_identity(target) {
            Ok(identity) => identity,
            Err(error) => {
                let recovery = candidate.temp.keep();
                return CopyResult::Partial(format!(
                    "副本已变更，但{error}；恢复资料在 {}。",
                    recovery.display()
                ));
            }
        };
        let record = Installation {
            directory: target.to_path_buf(),
            identity,
            source: candidate.source,
            revision: candidate.revision,
            hash: candidate.hash,
        };
        ledger
            .records
            .installations
            .insert(record_path, record.clone());
        if let Err(error) = ledger.save() {
            let rollback = directory_identity(target) == Ok(record.identity.clone())
                && fingerprint(target) == Ok(record.hash.clone())
                && rename_new(target, &candidate.directory).is_ok()
                && (!backup.exists() || rename_new(&backup, target).is_ok());
            if rollback {
                return CopyResult::Failed(format!("{error}；文件变更已撤回。"));
            }
            let recovery = candidate.temp.keep();
            return CopyResult::Partial(format!(
                "副本已变更，但{error}；恢复资料保留在 {}，请核对。",
                recovery.display()
            ));
        }
        CopyResult::Succeeded(match self.kind {
            ChangeKind::Install => CopySuccess::Installed,
            ChangeKind::Update => CopySuccess::Updated,
            ChangeKind::Uninstall => unreachable!(),
        })
    }
}

#[derive(Clone, Copy)]
pub(crate) enum CopySuccess {
    Installed,
    Updated,
    Unchanged,
    Uninstalled,
}

#[derive(Clone, Copy)]
pub(crate) enum CopyFailure {
    Conflict,
    Failed,
}

pub(crate) enum CopyResult {
    Succeeded(CopySuccess),
    Conflict(String),
    Failed(String),
    Partial(String),
}

impl CopyResult {
    fn failure(kind: CopyFailure, message: String) -> Self {
        match kind {
            CopyFailure::Conflict => Self::Conflict(message),
            CopyFailure::Failed => Self::Failed(message),
        }
    }
}

impl Ledger {
    #[cfg(test)]
    pub fn read(home: &Path) -> Result<Self, String> {
        Self::read_at(&home.join(".package-manager-skills.json"))
    }

    pub fn read_at(path: &Path) -> Result<Self, String> {
        let file =
            ObservedFile::read(path).map_err(|e| format!("无法核实本应用的技能安装记录：{e:?}"))?;
        let records = match &file.text {
            None => Records {
                version: 1,
                installations: BTreeMap::new(),
            },
            Some(text) => serde_json::from_str::<Records>(text)
                .map_err(|e| format!("技能安装记录无法解析：{e}"))?,
        };
        if records.version != 1 {
            return Err("技能安装记录版本不兼容，文件维护暂停。".into());
        }
        Ok(Self { file, records })
    }

    pub fn save(&self) -> Result<(), String> {
        let text = serde_json::to_string_pretty(&self.records).map_err(|e| e.to_string())?;
        self.file
            .write(&text)
            .map_err(|e| format!("技能安装记录未保存：{e:?}"))?;
        Ok(())
    }
}

pub(crate) fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.len() <= 255
        && !name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
}

pub(crate) fn owned(home: &Path, entry: &Installation) -> Result<(), String> {
    let root = home.join("skills");
    directory_identity(&root)?;
    if root.canonicalize().map_err(|e| e.to_string())? != root
        || entry.directory.parent() != Some(root.as_path())
        || !entry
            .directory
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(valid_name)
        || directory_identity(&entry.directory)? != entry.identity
    {
        return Err("安装副本的位置或身份已变化，不能更新或卸载。".into());
    }
    Ok(())
}

pub(crate) fn root_identity(home: &Path) -> Result<Option<Identity>, String> {
    let root = home.join("skills");
    match fs::symlink_metadata(&root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => {
            let identity = directory_identity(&root)?;
            if root.canonicalize().map_err(|error| error.to_string())? != root {
                return Err("技能安装根目录不能是外部链接。".into());
            }
            Ok(Some(identity))
        }
    }
}

// Files are hashed in path order, including empty directories and executable permissions.
// No links, devices or sockets can become part of an application-owned installation.
fn walk(
    root: &Path,
    path: &Path,
    entries: &mut Vec<PathBuf>,
    bytes: &mut u64,
) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || (!meta.is_file() && !meta.is_dir()) {
        return Err(format!(
            "技能包含链接或特殊文件，无法复制或更新：{}",
            path.display()
        ));
    }
    *bytes = bytes.saturating_add(if meta.is_file() { meta.len() } else { 0 });
    if entries.len() > 10000 || *bytes > 256 * 1024 * 1024 {
        return Err("技能超过 10,000 个文件或 256 MiB，本次不处理。".into());
    }
    if path != root {
        entries.push(path.strip_prefix(root).unwrap().to_path_buf());
    }
    if meta.is_dir() {
        for child in fs::read_dir(path).map_err(|e| e.to_string())? {
            walk(
                root,
                &child.map_err(|e| e.to_string())?.path(),
                entries,
                bytes,
            )?;
        }
    }
    Ok(())
}

fn regular_file(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("技能文件已被替换。".into());
    }
    Ok(file)
}

pub(crate) fn fingerprint(root: &Path) -> Result<String, String> {
    directory_identity(root)?;
    let mut paths = Vec::new();
    walk(root, root, &mut paths, &mut 0)?;
    paths.sort();
    let mut hash = Sha256::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        hash.update(
            (fs::metadata(root)
                .map_err(|e| e.to_string())?
                .permissions()
                .mode()
                & 0o777)
                .to_le_bytes(),
        );
    }
    for relative in paths {
        let path = root.join(&relative);
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        let name = relative.to_str().ok_or("技能路径不是有效 UTF-8。")?;
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        hash.update([u8::from(meta.is_dir())]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            hash.update((meta.permissions().mode() & 0o777).to_le_bytes());
        }
        if meta.is_file() {
            let mut file = regular_file(&path)?;
            hash.update(meta.len().to_le_bytes());
            let mut buffer = [0u8; 65536];
            loop {
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
        } else if !meta.is_dir() {
            return Err("技能文件已变为链接。".into());
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(crate) fn copy_tree(source: &Path, target: &Path) -> Result<String, String> {
    let before = fingerprint(source)?;
    let mut paths = Vec::new();
    walk(source, source, &mut paths, &mut 0)?;
    paths.sort();
    fs::create_dir(target).map_err(|e| e.to_string())?;
    let mut directories = Vec::new();
    for relative in paths {
        let src = source.join(&relative);
        let dest = target.join(relative);
        let meta = fs::symlink_metadata(&src).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            fs::create_dir(&dest).map_err(|e| e.to_string())?;
            directories.push((dest, meta.permissions()));
            continue;
        } else {
            let mut input = regular_file(&src)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dest)
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            output.flush().map_err(|e| e.to_string())?;
        }
        fs::set_permissions(&dest, meta.permissions()).map_err(|e| e.to_string())?;
    }
    for (directory, permissions) in directories.into_iter().rev() {
        fs::set_permissions(directory, permissions).map_err(|e| e.to_string())?;
    }
    fs::set_permissions(
        target,
        fs::metadata(source)
            .map_err(|e| e.to_string())?
            .permissions(),
    )
    .map_err(|e| e.to_string())?;
    if fingerprint(source)? != before || fingerprint(target)? != before {
        return Err("复制期间来源发生变化，请重新检查。".into());
    }
    Ok(before)
}

fn git(home: &Path, args: &[&str]) -> Result<String, String> {
    let output = codex_cli::run_git(home, args, Duration::from_secs(60))?;
    if !output.success {
        return Err(format!(
            "GitHub 来源读取失败，请检查仓库、版本和本机 Git 认证：{}",
            output.stderr.trim()
        ));
    }
    Ok(output.stdout.trim().to_string())
}

pub(crate) struct Staged {
    pub temp: tempfile::TempDir,
    pub directory: PathBuf,
    pub source: Source,
    pub revision: String,
    pub hash: String,
    pub name: String,
}

pub(crate) fn stage(home: &Path, source: &Source, pinned: Option<&str>) -> Result<Staged, String> {
    let temp = tempfile::Builder::new()
        .prefix(".package-manager-skill-")
        .tempdir_in(home)
        .map_err(|e| e.to_string())?;
    let mut normalized = source.clone();
    let (source_dir, revision, name) = match &mut normalized {
        Source::Local { path } => {
            if !Path::new(path).is_absolute() {
                return Err("请选择绝对路径的本地技能目录。".into());
            }
            let dir = fs::canonicalize(&path).map_err(|e| format!("本地来源不可读取：{e}"))?;
            *path = dir.display().to_string();
            let name = dir
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or("技能目录名称无效。")?
                .to_string();
            (dir, String::new(), name)
        }
        Source::Github {
            repo,
            subdirectory,
            reference,
            reference_kind,
        } => {
            *repo = repo
                .trim()
                .trim_start_matches("https://github.com/")
                .trim_end_matches('/')
                .trim_end_matches(".git")
                .into();
            let parts: Vec<_> = repo.split('/').collect();
            if parts.len() != 2
                || parts.iter().any(|p| {
                    p.is_empty()
                        || p.starts_with('.')
                        || !p
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
                })
            {
                return Err(
                    "GitHub 仓库请填写 owner/repo 或 https://github.com/owner/repo。".into(),
                );
            }
            if !matches!(reference_kind.as_str(), "branch" | "tag")
                || reference.starts_with('-')
                || reference.chars().any(char::is_control)
                || (reference_kind == "tag" && reference.is_empty())
            {
                return Err("请选择有效的分支或标签。".into());
            }
            let relative = Path::new(subdirectory);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
            {
                return Err("技能子目录不能包含绝对路径或 ..。".into());
            }
            let name = relative
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or(parts[1])
                .to_string();
            let repository = temp.path().join("repository.git");
            let repository_str = repository.to_str().ok_or("临时目录不可读取。")?;
            let url = format!("https://github.com/{repo}.git");
            let mut args = vec![
                "-c",
                "core.hooksPath=/dev/null",
                "clone",
                "--bare",
                "--depth=1",
                "--single-branch",
            ];
            let ref_spec = if reference_kind == "tag" {
                format!("refs/tags/{reference}")
            } else {
                reference.clone()
            };
            if !reference.is_empty() {
                args.extend(["--branch", reference.as_str()]);
            }
            args.extend(["--", &url, repository_str]);
            git(home, &args)?;
            if let Some(commit) = pinned {
                if commit.len() != 40 || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("固定版本记录无效。".into());
                }
                git(
                    home,
                    &[
                        "--git-dir",
                        repository_str,
                        "fetch",
                        "--depth=1",
                        "origin",
                        commit,
                    ],
                )?;
            }
            let revision = git(
                home,
                &[
                    "--git-dir",
                    repository_str,
                    "rev-parse",
                    "--verify",
                    pinned.unwrap_or("HEAD"),
                ],
            )?;
            if reference.is_empty() {
                *reference = git(
                    home,
                    &[
                        "--git-dir",
                        repository_str,
                        "symbolic-ref",
                        "--short",
                        "HEAD",
                    ],
                )?;
            }
            // Verify an explicit branch/tag so a same-named tag cannot satisfy a branch request.
            if pinned.is_none() && !ref_spec.is_empty() {
                let expected = if reference_kind == "tag" {
                    format!("{ref_spec}^{{commit}}")
                } else {
                    format!("refs/heads/{reference}^{{commit}}")
                };
                if git(
                    home,
                    &[
                        "--git-dir",
                        repository_str,
                        "rev-parse",
                        "--verify",
                        &expected,
                    ],
                )? != revision
                {
                    return Err("来源分支或标签与请求不一致。".into());
                }
            }
            let archive_path = temp.path().join("source.tar");
            let mut archive_args = vec![
                "--git-dir",
                repository_str,
                "archive",
                "--format=tar",
                "--output",
                archive_path.to_str().unwrap(),
                &revision,
            ];
            if !subdirectory.is_empty() && subdirectory != "." {
                archive_args.extend(["--", subdirectory]);
            }
            git(home, &archive_args)?;
            let extracted = temp.path().join("source");
            fs::create_dir(&extracted).map_err(|e| e.to_string())?;
            let mut total = 0u64;
            let mut archive =
                tar::Archive::new(fs::File::open(archive_path).map_err(|e| e.to_string())?);
            for (count, entry) in archive.entries().map_err(|e| e.to_string())?.enumerate() {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let kind = entry.header().entry_type();
                if kind.is_pax_global_extensions() || kind.is_pax_local_extensions() {
                    continue;
                }
                if !(kind.is_file() || kind.is_dir()) {
                    return Err("GitHub 技能包含链接或特殊文件，不能安装。".into());
                }
                total = total.saturating_add(entry.size());
                if count > 10000 || total > 256 * 1024 * 1024 {
                    return Err("技能来源超过处理上限。".into());
                }
                if !entry.unpack_in(&extracted).map_err(|e| e.to_string())? {
                    return Err("技能来源路径越界。".into());
                }
            }
            (extracted.join(relative), revision, name)
        }
    };
    if !valid_name(&name) {
        return Err("技能目录名不能是隐藏目录，不能包含路径分隔符或控制字符。".into());
    }
    let prepared = temp.path().join("skills");
    fs::create_dir(&prepared).map_err(|e| e.to_string())?;
    let directory = prepared.join(&name);
    let hash = copy_tree(&source_dir, &directory)?;
    let revision = if revision.is_empty() {
        hash.clone()
    } else {
        revision
    };
    Ok(Staged {
        temp,
        directory,
        source: normalized,
        revision,
        hash,
        name,
    })
}

pub(crate) fn rename_new(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let from = CString::new(from.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let to = CString::new(to.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } != 0 {
            return Err(format!(
                "目录移动失败（不会覆盖已有目录）：{}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (from, to);
        Err("技能文件维护当前仅支持 macOS。".into())
    }
}

pub(crate) fn read_markdown(path: &Path) -> Result<String, String> {
    let mut text = String::new();
    regular_file(path)?
        .take(1024 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 1024 * 1024 {
        return Err("SKILL.md 超过 1 MiB，请在原目录查看。".into());
    }
    Ok(text)
}
