use crate::types::ManagerId;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    targets: Vec<Target>,
    locations: Vec<Location>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    id: String,
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    id: String,
    manager_id: ManagerId,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Association {
    matches: Vec<Match>,
    unreadable_location_ids: Vec<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Relation {
    Equal,
    Contained,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Match {
    target_id: String,
    location_id: String,
    relation: Relation,
    canonical_location: String,
    suppressed_by: Option<String>,
}

struct ResolvedLocation {
    id: String,
    manager_id: ManagerId,
    canonical: PathBuf,
    is_dir: bool,
}

pub(crate) fn associate(request: Request) -> Association {
    let mut unreadable_location_ids = Vec::new();
    let mut seen_unreadable = HashSet::new();
    let mut locations = Vec::new();

    for location in request.locations {
        match resolve(location) {
            Ok(resolved) => locations.push(resolved),
            Err(id) => {
                if seen_unreadable.insert(id.clone()) {
                    unreadable_location_ids.push(id);
                }
            }
        }
    }

    let mut matches = Vec::new();
    for target in &request.targets {
        let target_path = Path::new(&target.target);
        let mut target_matches = Vec::new();
        for location in &locations {
            let Some(relation) = relation(&location.canonical, location.is_dir, target_path) else {
                continue;
            };
            target_matches.push(Match {
                target_id: target.id.clone(),
                location_id: location.id.clone(),
                relation,
                canonical_location: location.canonical.display().to_string(),
                suppressed_by: None,
            });
        }
        suppress_broader_cross_manager(&mut target_matches, &locations);
        matches.extend(target_matches);
    }

    Association {
        matches,
        unreadable_location_ids,
    }
}

fn resolve(location: Location) -> Result<ResolvedLocation, String> {
    let path = Path::new(&location.path);
    if !path.is_absolute() {
        return Err(location.id);
    }
    let canonical = fs::canonicalize(path).map_err(|_| location.id.clone())?;
    let metadata = fs::metadata(&canonical).map_err(|_| location.id.clone())?;
    Ok(ResolvedLocation {
        id: location.id,
        manager_id: location.manager_id,
        canonical,
        is_dir: metadata.is_dir(),
    })
}

fn relation(container: &Path, is_dir: bool, target: &Path) -> Option<Relation> {
    if !target.is_absolute() {
        return None;
    }
    if target == container {
        return Some(Relation::Equal);
    }
    if is_dir && target.starts_with(container) {
        return Some(Relation::Contained);
    }
    None
}

fn suppress_broader_cross_manager(matches: &mut [Match], locations: &[ResolvedLocation]) {
    let directory_matches: Vec<usize> = matches
        .iter()
        .enumerate()
        .filter(|(_, m)| is_directory_match(m, locations))
        .map(|(index, _)| index)
        .collect();

    for &broader in &directory_matches {
        let manager = locations
            .iter()
            .find(|location| location.id == matches[broader].location_id)
            .map(|location| location.manager_id);
        let broader_path = PathBuf::from(&matches[broader].canonical_location);
        let mut best: Option<(usize, usize, String)> = None;
        for &candidate in &directory_matches {
            if candidate == broader {
                continue;
            }
            let candidate_path = Path::new(&matches[candidate].canonical_location);
            let candidate_manager = locations
                .iter()
                .find(|location| location.id == matches[candidate].location_id)
                .map(|location| location.manager_id);
            if candidate_manager == manager
                || candidate_path == broader_path
                || !candidate_path.starts_with(&broader_path)
            {
                continue;
            }
            let depth = candidate_path.components().count();
            let length = candidate_path.as_os_str().len();
            let replace = match &best {
                None => true,
                Some((best_depth, best_length, _)) => (depth, length) > (*best_depth, *best_length),
            };
            if replace {
                best = Some((depth, length, matches[candidate].location_id.clone()));
            }
        }
        if let Some((_, _, suppressor)) = best {
            matches[broader].suppressed_by = Some(suppressor);
        }
    }
}

fn is_directory_match(m: &Match, locations: &[ResolvedLocation]) -> bool {
    locations
        .iter()
        .find(|location| location.id == m.location_id)
        .is_some_and(|location| location.is_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn dir(root: &Path, path: &str) -> PathBuf {
        let path = root.join(path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn file(root: &Path, path: &str) -> PathBuf {
        let path = root.join(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, "data").unwrap();
        path
    }

    fn observed(path: &Path) -> String {
        fs::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf())
            .display()
            .to_string()
    }

    fn request(targets: &[(&str, &Path)], locations: &[(&str, ManagerId, &Path)]) -> Request {
        Request {
            targets: targets
                .iter()
                .map(|(id, path)| Target {
                    id: (*id).to_string(),
                    target: observed(path),
                })
                .collect(),
            locations: locations
                .iter()
                .map(|(id, manager_id, path)| Location {
                    id: (*id).to_string(),
                    manager_id: *manager_id,
                    path: path.display().to_string(),
                })
                .collect(),
        }
    }

    fn matches_for<'a>(association: &'a Association, target_id: &str) -> Vec<&'a Match> {
        association
            .matches
            .iter()
            .filter(|m| m.target_id == target_id)
            .collect()
    }

    #[test]
    fn matches_files_by_equality_and_directories_by_containment() {
        let root = tempfile::tempdir().unwrap();
        let installation = dir(root.path(), "install");
        let binary = file(root.path(), "install/bin/tool");
        let other = file(root.path(), "other/tool");

        let result = associate(request(
            &[("tool", &binary), ("other", &other)],
            &[("install", ManagerId::Npm, &installation)],
        ));

        let tool = matches_for(&result, "tool");
        assert_eq!(tool.len(), 1);
        assert_eq!(tool[0].relation, Relation::Contained);
        assert!(matches_for(&result, "other").is_empty());
        assert!(result.unreadable_location_ids.is_empty());
    }

    #[test]
    fn matches_file_locations_by_equality_only() {
        let root = tempfile::tempdir().unwrap();
        let interpreter = file(root.path(), "python/bin/python3");
        let sibling = file(root.path(), "python/bin/python3.12");

        let result = associate(request(
            &[("exact", &interpreter), ("sibling", &sibling)],
            &[("interpreter", ManagerId::Pip, &interpreter)],
        ));

        let exact = matches_for(&result, "exact");
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].relation, Relation::Equal);
        assert!(matches_for(&result, "sibling").is_empty());
    }

    #[test]
    fn path_containment_is_component_aware() {
        let root = tempfile::tempdir().unwrap();
        let installation = dir(root.path(), "homebrew");
        let binary = file(root.path(), "homebrew-other/bin/tool");

        let result = associate(request(
            &[("tool", &binary)],
            &[("prefix", ManagerId::Homebrew, &installation)],
        ));

        assert!(result.matches.is_empty());
    }

    #[test]
    fn canonicalizes_symlinked_locations() {
        let root = tempfile::tempdir().unwrap();
        let real = dir(root.path(), "real");
        let binary = file(root.path(), "real/bin/tool");
        let link = root.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let result = associate(request(
            &[("tool", &binary)],
            &[("link", ManagerId::Npm, &link)],
        ));

        let tool = matches_for(&result, "tool");
        assert_eq!(tool.len(), 1);
        assert_eq!(tool[0].relation, Relation::Contained);
    }

    #[test]
    fn suppresses_broader_cross_manager_directories() {
        let root = tempfile::tempdir().unwrap();
        let nvm_version = dir(root.path(), "nvm/versions/node/v24");
        let npm_modules = dir(root.path(), "nvm/versions/node/v24/lib/node_modules");
        let binary = file(
            root.path(),
            "nvm/versions/node/v24/lib/node_modules/corepack/dist/pnpm.js",
        );

        let result = associate(request(
            &[("pnpm", &binary)],
            &[
                ("nvm", ManagerId::Nvm, &nvm_version),
                ("npm", ManagerId::Npm, &npm_modules),
            ],
        ));

        let matched = matches_for(&result, "pnpm");
        assert_eq!(matched.len(), 2);
        let nvm = matched.iter().find(|m| m.location_id == "nvm").unwrap();
        let npm = matched.iter().find(|m| m.location_id == "npm").unwrap();
        assert_eq!(nvm.suppressed_by.as_deref(), Some("npm"));
        assert_eq!(npm.suppressed_by, None);
    }

    #[test]
    fn keeps_file_matches_even_when_a_directory_contains_them() {
        let root = tempfile::tempdir().unwrap();
        let python_root = dir(root.path(), "uv/python/cpython");
        let interpreter = file(root.path(), "uv/python/cpython/bin/python3");

        let result = associate(request(
            &[("python3", &interpreter)],
            &[
                ("uv", ManagerId::Uv, &python_root),
                ("pip", ManagerId::Pip, &interpreter),
            ],
        ));

        let matched = matches_for(&result, "python3");
        assert_eq!(matched.len(), 2);
        let uv = matched.iter().find(|m| m.location_id == "uv").unwrap();
        let pip = matched.iter().find(|m| m.location_id == "pip").unwrap();
        assert_eq!(uv.suppressed_by, None);
        assert_eq!(pip.suppressed_by, None);
        assert_eq!(pip.relation, Relation::Equal);
    }

    #[test]
    fn does_not_suppress_within_the_same_manager() {
        let root = tempfile::tempdir().unwrap();
        let cellar = dir(root.path(), "homebrew/Cellar");
        let formula = dir(root.path(), "homebrew/Cellar/tool/1.0");
        let binary = file(root.path(), "homebrew/Cellar/tool/1.0/bin/tool");

        let result = associate(request(
            &[("tool", &binary)],
            &[
                ("cellar", ManagerId::Homebrew, &cellar),
                ("formula", ManagerId::Homebrew, &formula),
            ],
        ));

        for matched in matches_for(&result, "tool") {
            assert_eq!(matched.suppressed_by, None);
        }
    }

    #[test]
    fn equal_cross_manager_paths_do_not_suppress_each_other() {
        let root = tempfile::tempdir().unwrap();
        let shared = dir(root.path(), "shared/node_modules");
        let binary = file(root.path(), "shared/node_modules/tool/bin/tool");

        let result = associate(request(
            &[("tool", &binary)],
            &[
                ("npm", ManagerId::Npm, &shared),
                ("pnpm", ManagerId::Pnpm, &shared),
            ],
        ));

        for matched in matches_for(&result, "tool") {
            assert_eq!(matched.suppressed_by, None);
        }
    }

    #[test]
    fn reports_unreadable_and_relative_locations() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("missing");
        let relative = Path::new("relative");
        let binary = file(root.path(), "bin/tool");

        let result = associate(Request {
            targets: vec![Target {
                id: "tool".into(),
                target: observed(&binary),
            }],
            locations: vec![
                Location {
                    id: "missing".into(),
                    manager_id: ManagerId::Npm,
                    path: missing.display().to_string(),
                },
                Location {
                    id: "relative".into(),
                    manager_id: ManagerId::Homebrew,
                    path: relative.display().to_string(),
                },
            ],
        });

        assert_eq!(
            result.unreadable_location_ids,
            vec!["missing".to_string(), "relative".to_string()]
        );
        assert!(result.matches.is_empty());
    }

    #[test]
    fn does_not_execute_candidates() {
        let root = tempfile::tempdir().unwrap();
        let bin = dir(root.path(), "bin");
        let marker = root.path().join("SHOULD_NOT_RUN");
        let script = bin.join("tool");
        fs::write(&script, format!("#!/bin/sh\ntouch {}\n", marker.display())).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

        let result = associate(request(
            &[("tool", &script)],
            &[("bin", ManagerId::Npm, &bin)],
        ));

        assert_eq!(matches_for(&result, "tool").len(), 1);
        assert!(!marker.exists());
    }

    #[test]
    fn serializes_nested_ids_and_relations_in_camel_case() {
        let root = tempfile::tempdir().unwrap();
        let bin = dir(root.path(), "bin");
        let binary = file(root.path(), "bin/tool");
        let result = associate(request(
            &[("tool:1", &binary)],
            &[("npm:source:0", ManagerId::Npm, &bin)],
        ));
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["matches"][0]["targetId"], "tool:1");
        assert_eq!(value["matches"][0]["locationId"], "npm:source:0");
        assert_eq!(value["matches"][0]["relation"], "contained");
        assert!(value["matches"][0]["suppressedBy"].is_null());
    }
}
