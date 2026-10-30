use crate::types::ManagerId;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Inspection {
    captured_at: u64,
    scope_key: String,
    path_entries: Vec<PathEntry>,
    commands: Vec<Resolution>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathEntry {
    original: String,
    path: String,
    issue: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Resolution {
    program: String,
    managers: Vec<ManagerId>,
    selected_path: Option<String>,
    status: String,
    candidates: Vec<Candidate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    path_index: usize,
    path: String,
    target: Option<String>,
    status: String,
    message: Option<String>,
}

pub(crate) fn inspect(managers: &[ManagerId]) -> Result<Inspection, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("无法读取应用工作目录：{e}"))?;
    let paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let mut programs: BTreeMap<&str, Vec<ManagerId>> = BTreeMap::new();
    for manager in managers {
        use ManagerId::*;
        let names: &[&str] = match manager {
            Npm => &["node", "npm"],
            Pnpm => &["node", "pnpm"],
            Yarn => &["node", "yarn"],
            Nvm => &["node"],
            Homebrew => &["brew"],
            Maven => &["mvn", "java"],
            Pip => &["python", "python3", "pip", "pip3"],
            Cargo => &["cargo", "rustc"],
            Docker => &["docker"],
            Bun => &["bun"],
            Uv => &["uv", "python", "python3"],
            Fvm => &["fvm", "flutter", "dart"],
            AndroidSdk => &["android", "sdkmanager", "java"],
        };
        for name in names {
            programs.entry(name).or_default().push(*manager);
        }
    }
    let mut result = inspect_paths(&paths, &cwd, programs.keys().copied());
    result.scope_key = scope_key(managers);
    for command in &mut result.commands {
        command.managers = programs[command.program.as_str()].clone();
    }
    Ok(result)
}

pub(crate) fn scope_key(managers: &[ManagerId]) -> String {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    scope_key_from(&absolute_paths(&paths, &cwd), managers)
}

fn scope_key_from(paths: &[PathBuf], managers: &[ManagerId]) -> String {
    let mut hasher = Sha256::new();
    for path in paths {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update([0]);
    }
    let mut managers: Vec<String> = managers
        .iter()
        .map(|manager| format!("{manager:?}"))
        .collect();
    managers.sort();
    for manager in managers {
        hasher.update(manager.as_bytes());
        hasher.update([0]);
    }
    format!("environment:{:x}", hasher.finalize())
}

fn absolute_paths(paths: &[PathBuf], cwd: &Path) -> Vec<PathBuf> {
    paths
        .iter()
        .map(|p| {
            if p.as_os_str().is_empty() {
                cwd.to_path_buf()
            } else if p.is_absolute() {
                p.clone()
            } else {
                cwd.join(p)
            }
        })
        .collect()
}

fn inspect_paths<'a>(
    paths: &[PathBuf],
    cwd: &Path,
    programs: impl Iterator<Item = &'a str>,
) -> Inspection {
    let absolute = absolute_paths(paths, cwd);
    let path_entries = paths
        .iter()
        .zip(&absolute)
        .map(|(original, path)| PathEntry {
            original: original.display().to_string(),
            path: path.display().to_string(),
            issue: match fs::metadata(path) {
                Ok(m) if m.is_dir() => None,
                Ok(_) => Some("不是目录".into()),
                Err(e) => Some(format!("目录无法读取：{e}")),
            },
        })
        .collect();
    let commands = programs
        .map(|program| resolve_candidates(program, &absolute))
        .collect();
    Inspection {
        captured_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        scope_key: String::new(),
        path_entries,
        commands,
    }
}

pub(crate) fn resolve_candidates(program: &str, paths: &[PathBuf]) -> Resolution {
    let program_path = Path::new(program);
    let entries: Vec<PathBuf> = if program_path.components().count() > 1 {
        vec![program_path.to_path_buf()]
    } else {
        paths.iter().map(|p| p.join(program)).collect()
    };
    let mut candidates = Vec::new();
    let mut selected_path = None;
    let mut identities = BTreeSet::new();
    let mut executable_count = 0;
    for (index, path) in entries.iter().enumerate() {
        let mut candidate = Candidate {
            path_index: index,
            path: path.display().to_string(),
            target: None,
            status: "unreadable".into(),
            message: None,
        };
        match fs::metadata(path) {
            Ok(metadata) => {
                #[cfg(unix)]
                let executable = {
                    use std::os::unix::fs::PermissionsExt;
                    metadata.permissions().mode() & 0o111 != 0
                };
                #[cfg(not(unix))]
                let executable = true;
                if !metadata.is_file() || !executable {
                    candidate.status = "notExecutable".into();
                    candidate.message = Some("不是可执行的普通文件".into());
                } else {
                    match path.canonicalize() {
                        Ok(target) => {
                            candidate.status = "executable".into();
                            candidate.target = Some(target.display().to_string());
                            if selected_path.is_none() {
                                selected_path = Some(candidate.path.clone());
                            }
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::MetadataExt;
                                identities.insert(format!("{}:{}", metadata.dev(), metadata.ino()));
                            }
                            #[cfg(not(unix))]
                            {
                                identities.insert(target.display().to_string());
                            }
                            executable_count += 1;
                        }
                        Err(e) => candidate.message = Some(format!("无法解析文件目标：{e}")),
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if fs::symlink_metadata(path).is_ok() {
                    candidate.status = "brokenLink".into();
                    candidate.message = Some("符号链接的目标不存在".into());
                } else {
                    continue;
                }
            }
            Err(e) => candidate.message = Some(format!("文件无法读取：{e}")),
        }
        candidates.push(candidate);
    }
    let status = if candidates.iter().any(|c| c.status == "unreadable") {
        "unknown"
    } else if identities.len() > 1 {
        "multiple"
    } else if executable_count > 1 {
        "aliases"
    } else if executable_count == 1 {
        "single"
    } else {
        "missing"
    };
    Resolution {
        program: program.into(),
        managers: Vec::new(),
        selected_path,
        status: status.into(),
        candidates,
    }
}

pub(crate) fn resolved_target(program: &str, paths: &[PathBuf]) -> Option<String> {
    resolve_candidates(program, paths)
        .candidates
        .into_iter()
        .find(|c| c.status == "executable")
        .and_then(|c| c.target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    fn executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, "#!/bin/sh\ntouch SHOULD_NOT_RUN\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn priority_aliases_relative_and_empty_paths_without_execution() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        executable(&a.join("node"));
        std::os::unix::fs::symlink(a.join("node"), b.join("node")).unwrap();
        let result = inspect_paths(
            &[PathBuf::from("a"), PathBuf::from("b"), PathBuf::new()],
            dir.path(),
            ["node"].into_iter(),
        );
        assert_eq!(result.commands[0].status, "aliases");
        assert_eq!(
            result.commands[0].selected_path,
            Some(a.join("node").display().to_string())
        );
        assert_eq!(
            result.path_entries[2].path,
            dir.path().display().to_string()
        );
        assert!(!dir.path().join("SHOULD_NOT_RUN").exists());
        fs::remove_file(b.join("node")).unwrap();
        executable(&b.join("node"));
        assert_eq!(resolve_candidates("node", &[a, b]).status, "multiple");
    }

    #[test]
    #[cfg(unix)]
    fn broken_links_non_executable_and_missing_are_distinct() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("missing", dir.path().join("broken")).unwrap();
        fs::write(dir.path().join("plain"), "data").unwrap();
        assert_eq!(
            resolve_candidates("broken", &[dir.path().into()]).candidates[0].status,
            "brokenLink"
        );
        assert_eq!(
            resolve_candidates("plain", &[dir.path().into()]).candidates[0].status,
            "notExecutable"
        );
        assert_eq!(
            resolve_candidates("absent", &[dir.path().into()]).status,
            "missing"
        );
    }

    #[test]
    #[cfg(unix)]
    fn unreadable_path_does_not_claim_a_complete_single_source() {
        let dir = tempfile::tempdir().unwrap();
        let invalid = dir.path().join("not-a-directory");
        fs::write(&invalid, "data").unwrap();
        executable(&dir.path().join("node"));
        let result = resolve_candidates("node", &[invalid, dir.path().into()]);
        assert_eq!(result.status, "unknown");
        assert_eq!(result.candidates[0].status, "unreadable");
        assert_eq!(
            result.selected_path,
            Some(dir.path().join("node").display().to_string())
        );
    }
}
