use crate::types::ManagerSnapshot;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanDiagnostics {
    path_entries: Vec<String>,
    executables: Vec<ExecutableResolution>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutableResolution {
    program: String,
    resolved_path: Option<String>,
}

pub(crate) fn collect(snapshot: &ManagerSnapshot) -> ScanDiagnostics {
    let paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    let mut programs: Vec<String> = snapshot
        .commands
        .iter()
        .map(|command| command.program.clone())
        .collect();
    if let Some(pip) = &snapshot.pip {
        programs.push(pip.python_executable.clone());
    }
    programs.sort();
    programs.dedup();
    ScanDiagnostics {
        path_entries: paths
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
        executables: programs
            .into_iter()
            .map(|program| {
                let resolved_path =
                    resolve(&program, &paths).map(|path| path.display().to_string());
                ExecutableResolution {
                    program,
                    resolved_path,
                }
            })
            .collect(),
    }
}

fn resolve(program: &str, paths: &[PathBuf]) -> Option<PathBuf> {
    let program_path = Path::new(program);
    let candidates = if program_path.components().count() > 1 {
        vec![program_path.to_path_buf()]
    } else {
        paths.iter().map(|path| path.join(program)).collect()
    };
    candidates
        .into_iter()
        .find(|path| {
            let Ok(metadata) = path.metadata() else {
                return false;
            };
            if !metadata.is_file() {
                return false;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                metadata.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                true
            }
        })
        .and_then(|path| path.canonicalize().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_executable_paths_without_running_them() {
        let executable = std::env::current_exe().unwrap();
        let directory = executable.parent().unwrap().to_path_buf();
        let name = executable.file_name().unwrap().to_str().unwrap();
        assert_eq!(resolve(name, &[directory]), executable.canonicalize().ok());
        assert_eq!(
            resolve(executable.to_str().unwrap(), &[]),
            executable.canonicalize().ok()
        );
        assert_eq!(resolve("definitely-missing-manager", &[]), None);
        assert_eq!(
            resolve(executable.parent().unwrap().to_str().unwrap(), &[]),
            None
        );
    }
}
