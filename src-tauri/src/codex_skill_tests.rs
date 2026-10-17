use super::*;
use std::cell::RefCell;

#[derive(Default)]
struct FakeNative {
    enabled: RefCell<BTreeMap<String, bool>>,
    extra: RefCell<Vec<Skill>>,
    fail_enable: RefCell<bool>,
}
impl Native for FakeNative {
    fn list(&self, home: &Path) -> Result<Inventory, RpcError> {
        let mut paths = Vec::new();
        if let Ok(entries) = fs::read_dir(home.join("skills")) {
            paths.extend(entries.flatten().map(|e| e.path()));
        }
        let mut skills = self.extra.borrow().clone();
        for dir in paths {
            if let Ok(text) = fs::read_to_string(dir.join("SKILL.md")) {
                let Some(name) = text.lines().find_map(|line| line.strip_prefix("name: ")) else {
                    continue;
                };
                let path = dir
                    .join("SKILL.md")
                    .canonicalize()
                    .unwrap()
                    .display()
                    .to_string();
                let enabled = *self.enabled.borrow().get(&path).unwrap_or(&true);
                skills.push(Skill {
                    name: name.into(),
                    description: "Fixture".into(),
                    path,
                    scope: "user".into(),
                    plugin_id: None,
                    enabled,
                });
            }
        }
        Ok(Inventory {
            skills,
            errors: vec![],
        })
    }
    fn enabled(&self, _: &Path, path: &str, enabled: bool) -> Result<(), String> {
        if *self.fail_enable.borrow() {
            return Err("injected configuration failure".into());
        }
        self.enabled.borrow_mut().insert(path.into(), enabled);
        Ok(())
    }
}

struct Fixture {
    _temp: tempfile::TempDir,
    home: PathBuf,
    source: PathBuf,
    trash: PathBuf,
    state: SkillsState,
    native: FakeNative,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let home = root.join("codex");
        fs::create_dir(&home).unwrap();
        fs::create_dir(home.join("skills")).unwrap();
        fs::write(
            home.join("config.toml"),
            "# unrelated settings\nmodel = \"test\"\n",
        )
        .unwrap();
        let source = root.join("source/fixture-skill");
        fs::create_dir_all(&source).unwrap();
        write_skill(&source, "original");
        let trash = root.join("trash");
        fs::create_dir(&trash).unwrap();
        Self {
            _temp: temp,
            home,
            source,
            trash,
            state: SkillsState::default(),
            native: FakeNative::default(),
        }
    }
    fn request(&self, operation: Operation, path: Option<&str>) -> Result<Preview, String> {
        let scan = self.state.scan_with(self.home.clone(), &self.native)?;
        self.state.prepare_with(
            Request {
                snapshot_id: scan.snapshot_id.unwrap(),
                operation,
                path: path.map(str::to_string),
                source: (operation == Operation::Install).then(|| Source::Local {
                    path: self.source.display().to_string(),
                }),
            },
            &self.home,
            &self.native,
        )
    }
    fn commit(&self, preview: &Preview) -> Outcome {
        self.state
            .commit_with(&preview.plan_id, &self.home, &self.native, &|path| {
                fs::rename(path, self.trash.join(path.file_name().unwrap()))
                    .map_err(|e| e.to_string())
            })
            .unwrap()
    }
    fn install(&self) -> String {
        let preview = self.request(Operation::Install, None).unwrap();
        assert_eq!(self.commit(&preview).status, "Succeeded");
        preview.path
    }
}

fn write_skill(path: &Path, body: &str) {
    fs::write(
        path.join("SKILL.md"),
        format!("---\nname: fixture-skill\ndescription: Test fixture\n---\n{body}\n"),
    )
    .unwrap();
}

#[test]
fn local_lifecycle_copies_updates_preserves_disable_and_trashes_modified_content() {
    let f = Fixture::new();
    let path = f.install();
    let directory = Path::new(&path).parent().unwrap();
    assert_eq!(
        fs::read(&path).unwrap(),
        fs::read(f.source.join("SKILL.md")).unwrap()
    );
    let disable = f.request(Operation::Disable, Some(&path)).unwrap();
    assert_eq!(f.commit(&disable).status, "Saved");
    write_skill(&f.source, "upstream changed");
    let update = f.request(Operation::Update, Some(&path)).unwrap();
    assert!(!update.enabled);
    assert_eq!(f.commit(&update).status, "Succeeded");
    assert_eq!(f.native.enabled.borrow().get(&path), Some(&false));
    assert!(fs::read_to_string(&path)
        .unwrap()
        .contains("upstream changed"));
    let unchanged = f.request(Operation::Update, Some(&path)).unwrap();
    assert_eq!(f.commit(&unchanged).status, "Unchanged");
    write_skill(directory, "my local notes");
    assert!(f
        .request(Operation::Update, Some(&path))
        .unwrap_err()
        .contains("本地修改"));
    let remove = f.request(Operation::Uninstall, Some(&path)).unwrap();
    assert_eq!(f.commit(&remove).status, "Succeeded");
    assert!(!directory.exists());
    assert!(fs::read_to_string(f.trash.join("fixture-skill/SKILL.md"))
        .unwrap()
        .contains("my local notes"));
    assert!(fs::read_to_string(f.source.join("SKILL.md"))
        .unwrap()
        .contains("upstream changed"));
    assert!(Ledger::read(&f.home)
        .unwrap()
        .records
        .installations
        .is_empty());
}

#[test]
fn existing_skill_may_toggle_but_never_be_taken_over_or_overwritten() {
    let f = Fixture::new();
    let dest = f.home.join("skills/fixture-skill");
    fs::create_dir(&dest).unwrap();
    write_skill(&dest, "pre-existing");
    let path = dest.join("SKILL.md").display().to_string();
    assert!(f
        .request(Operation::Install, None)
        .unwrap_err()
        .contains("已存在"));
    for operation in [Operation::Update, Operation::Uninstall] {
        assert!(f.request(operation, Some(&path)).is_err());
    }
    let disable = f.request(Operation::Disable, Some(&path)).unwrap();
    assert_eq!(f.commit(&disable).status, "Saved");
    assert!(fs::read_to_string(path).unwrap().contains("pre-existing"));
}

#[test]
fn plugin_user_scope_and_system_skills_are_read_only() {
    let f = Fixture::new();
    for (scope, plugin_id) in [
        ("user", Some("plugin@market")),
        ("system", None),
        ("admin", None),
    ] {
        let path = f
            .source
            .join(format!("{scope}-SKILL.md"))
            .display()
            .to_string();
        f.native.extra.borrow_mut().push(Skill {
            name: "same-name".into(),
            path: path.clone(),
            description: "Fixture".into(),
            scope: scope.into(),
            plugin_id: plugin_id.map(str::to_string),
            enabled: true,
        });
        let scan = f.state.scan_with(f.home.clone(), &f.native).unwrap();
        assert!(scan
            .skills
            .iter()
            .find(|s| s.skill.path == path)
            .unwrap()
            .toggle_blocked
            .is_some());
        assert!(f.request(Operation::Disable, Some(&path)).is_err());
    }
}

#[test]
fn stale_confirmation_config_ledger_content_and_identity_changes_are_rejected() {
    for change in ["config", "ledger", "content", "identity", "link"] {
        let f = Fixture::new();
        let path = f.install();
        let preview = f.request(Operation::Uninstall, Some(&path)).unwrap();
        let dir = Path::new(&path).parent().unwrap();
        match change {
            "config" => fs::write(f.home.join("config.toml"), "# external change").unwrap(),
            "ledger" => fs::write(f.home.join(".package-manager-skills.json"), "{}").unwrap(),
            "content" => write_skill(dir, "concurrent edit"),
            _ => {
                fs::rename(dir, f.home.join("old-copy")).unwrap();
                if change == "link" {
                    std::os::unix::fs::symlink(&f.source, dir).unwrap();
                } else {
                    fs::create_dir(dir).unwrap();
                    write_skill(dir, "original");
                }
            }
        }
        assert_eq!(f.commit(&preview).status, "Conflict", "{change}");
        assert!(dir.exists());
        assert!(f.trash.read_dir().unwrap().next().is_none());
    }
}

#[test]
fn single_use_plan_does_not_run_twice_and_refresh_revokes_it() {
    let f = Fixture::new();
    let preview = f.request(Operation::Install, None).unwrap();
    assert_eq!(f.commit(&preview).status, "Succeeded");
    assert_eq!(f.commit(&preview).status, "Conflict");
    let next = f
        .request(Operation::Uninstall, Some(&preview.path))
        .unwrap();
    f.state.scan_with(f.home.clone(), &f.native).unwrap();
    assert_eq!(f.commit(&next).status, "Conflict");
}

#[test]
fn cancelling_preparation_never_installs_and_invalid_skill_never_enters_target() {
    let f = Fixture::new();
    let preview = f.request(Operation::Install, None).unwrap();
    f.state.cancel(&preview.plan_id).unwrap();
    assert_eq!(f.commit(&preview).status, "Conflict");
    assert!(!Path::new(&preview.path).exists());
    fs::write(f.source.join("SKILL.md"), "invalid metadata").unwrap();
    assert!(f.request(Operation::Install, None).is_err());
    assert!(!Path::new(&preview.path).exists());
}

#[test]
fn source_symlinks_are_rejected_and_source_failure_preserves_installed_copy() {
    let f = Fixture::new();
    let path = f.install();
    std::os::unix::fs::symlink(f.home.join("config.toml"), f.source.join("external")).unwrap();
    assert!(f.request(Operation::Update, Some(&path)).is_err());
    assert!(fs::read_to_string(path).unwrap().contains("original"));
}

#[test]
fn failure_to_enable_is_partial_with_tracked_installation_preserved() {
    let f = Fixture::new();
    *f.native.fail_enable.borrow_mut() = true;
    let preview = f.request(Operation::Install, None).unwrap();
    assert_eq!(f.commit(&preview).status, "Partial");
    assert!(Path::new(&preview.path).exists());
    assert!(Ledger::read(&f.home)
        .unwrap()
        .records
        .installations
        .contains_key(&preview.path));
}

#[test]
fn same_name_different_paths_remain_distinct() {
    let f = Fixture::new();
    for folder in ["one", "two"] {
        let dir = f.home.join("skills").join(folder);
        fs::create_dir(&dir).unwrap();
        write_skill(&dir, folder);
    }
    let scan = f.state.scan_with(f.home.clone(), &f.native).unwrap();
    assert_eq!(scan.skills.len(), 2);
    assert_ne!(scan.skills[0].skill.path, scan.skills[1].skill.path);
}

#[test]
#[ignore = "uses a real Codex CLI; run the test binary in the documented isolated macOS sandbox"]
fn real_codex_local_skill_lifecycle() {
    let root = PathBuf::from(
        std::env::var_os("CODEX_SKILLS_TEST_ROOT").expect("dedicated test root is required"),
    );
    let home = root.join("codex");
    fs::create_dir_all(&home).unwrap();
    fs::write(
        home.join("config.toml"),
        "# preserve this comment\nmodel = \"gpt-5\"\n",
    )
    .unwrap();
    let source = root.join("fixture-skill");
    fs::create_dir(&source).unwrap();
    write_skill(&source, "first version");
    let state = SkillsState::default();
    let scan = state.scan_with(home.clone(), &Codex).unwrap();
    assert_eq!(scan.status, "Ready");
    let preview = state
        .prepare_with(
            Request {
                snapshot_id: scan.snapshot_id.unwrap(),
                operation: Operation::Install,
                path: None,
                source: Some(Source::Local {
                    path: source.display().to_string(),
                }),
            },
            &home,
            &Codex,
        )
        .unwrap();
    let trash = root.join("trash");
    fs::create_dir(&trash).unwrap();
    let move_to_trash = |path: &Path| {
        fs::rename(path, trash.join(path.file_name().unwrap())).map_err(|e| e.to_string())
    };
    let result = state
        .commit_with(&preview.plan_id, &home, &Codex, &move_to_trash)
        .unwrap();
    assert_eq!(result.status, "Succeeded", "{}", result.message);
    let path = preview.path;
    for operation in [Operation::Disable, Operation::Update, Operation::Uninstall] {
        if operation == Operation::Update {
            write_skill(&source, "second version");
        }
        let scan = state.scan_with(home.clone(), &Codex).unwrap();
        let preview = state
            .prepare_with(
                Request {
                    snapshot_id: scan.snapshot_id.unwrap(),
                    operation,
                    path: Some(path.clone()),
                    source: None,
                },
                &home,
                &Codex,
            )
            .unwrap();
        if operation == Operation::Update {
            assert!(!preview.enabled);
        }
        let result = state
            .commit_with(&preview.plan_id, &home, &Codex, &move_to_trash)
            .unwrap();
        assert!(
            matches!(result.status, "Succeeded" | "Saved"),
            "{}",
            result.message
        );
    }
    let config = fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(config.contains("preserve this comment"));
    assert!(config.contains("gpt-5"));
    assert!(source.join("SKILL.md").exists());
    assert!(trash.join("fixture-skill/SKILL.md").exists());
}

#[test]
fn corrupt_ownership_record_never_authorizes_another_directory() {
    let f = Fixture::new();
    let path = f.install();
    let other = f.home.join("skills/other");
    fs::create_dir(&other).unwrap();
    write_skill(&other, "other skill");
    let mut ledger = Ledger::read(&f.home).unwrap();
    let record = ledger.records.installations.get_mut(&path).unwrap();
    record.directory = other.clone();
    record.identity = files::directory_identity(&other).unwrap();
    record.hash = files::fingerprint(&other).unwrap();
    ledger.save().unwrap();
    for op in [Operation::Update, Operation::Uninstall] {
        assert!(f.request(op, Some(&path)).is_err());
    }
    assert!(other.join("SKILL.md").exists());
    assert!(Path::new(&path).exists());
}

#[test]
fn trash_failure_restores_copy_and_late_ledger_failure_reports_partial() {
    let f = Fixture::new();
    let path = f.install();
    let preview = f.request(Operation::Uninstall, Some(&path)).unwrap();
    let outcome = f
        .state
        .commit_with(&preview.plan_id, &f.home, &f.native, &|_| {
            Err("Finder refused".into())
        })
        .unwrap();
    assert_eq!(outcome.status, "Failed");
    assert!(Path::new(&path).exists());
    let preview = f.request(Operation::Uninstall, Some(&path)).unwrap();
    let outcome = f
        .state
        .commit_with(&preview.plan_id, &f.home, &f.native, &|dir| {
            fs::rename(dir, f.trash.join(dir.file_name().unwrap())).unwrap();
            fs::write(
                f.home.join(".package-manager-skills.json"),
                "external write",
            )
            .unwrap();
            Ok(())
        })
        .unwrap();
    assert_eq!(outcome.status, "Partial");
    assert!(!Path::new(&path).exists());
    assert!(f.trash.join("fixture-skill/SKILL.md").exists());
}

#[test]
fn reserved_staging_names_and_read_only_subdirectories_are_copied() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    for name in [
        "source",
        "repository.git",
        "previous-installation",
        "skills",
    ] {
        let source = f._temp.path().join(format!("test-{name}")).join(name);
        fs::create_dir_all(&source).unwrap();
        write_skill(&source, "valid");
        let sub = source.join("references");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("guide.md"), "reference").unwrap();
        fs::set_permissions(&sub, fs::Permissions::from_mode(0o555)).unwrap();
        let staged = files::stage(
            &f.home,
            &Source::Local {
                path: source.display().to_string(),
            },
            None,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(staged.directory.join("references/guide.md")).unwrap(),
            "reference"
        );
        fs::set_permissions(&sub, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(
            staged.directory.join("references"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
}

#[test]
#[ignore = "real Git fixture with URL mapping; run through run-isolated.py"]
fn real_git_branch_tag_subdirectory_lifecycle() {
    let root =
        PathBuf::from(std::env::var_os("CODEX_SKILLS_TEST_ROOT").expect("dedicated test root"));
    let repo = root.join("repository");
    fs::create_dir(&repo).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(&repo)
            .args([
                "-c",
                "user.name=Skill Test",
                "-c",
                "user.email=skill-test@example.invalid",
                "-c",
                "commit.gpgSign=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };
    git(&["init", "-b", "main"]);
    let source = repo.join("skills/source");
    fs::create_dir_all(&source).unwrap();
    write_skill(&source, "version one");
    git(&["add", "."]);
    git(&["commit", "-m", "first"]);
    git(&["tag", "v1"]);
    let first = git(&["rev-parse", "HEAD"]);
    let home = root.join("codex");
    fs::create_dir(&home).unwrap();
    let state = SkillsState::default();
    let native = FakeNative::default();
    let branch = Source::Github {
        repo: "skills-test/fixture".into(),
        subdirectory: "skills/source".into(),
        reference: "main".into(),
        reference_kind: "branch".into(),
    };
    let scan = state.scan_with(home.clone(), &native).unwrap();
    let preview = state
        .prepare_with(
            Request {
                snapshot_id: scan.snapshot_id.unwrap(),
                operation: Operation::Install,
                path: None,
                source: Some(branch),
            },
            &home,
            &native,
        )
        .unwrap();
    assert_eq!(preview.revision.as_deref(), Some(first.as_str()));
    let outcome = state
        .commit_with(&preview.plan_id, &home, &native, &|_| unreachable!())
        .unwrap();
    assert_eq!(outcome.status, "Succeeded");
    let installed = preview.path;
    write_skill(&source, "version two");
    git(&["add", "."]);
    git(&["commit", "-m", "second"]);
    native.enabled.borrow_mut().insert(installed.clone(), false);
    let scan = state.scan_with(home.clone(), &native).unwrap();
    let update = state
        .prepare_with(
            Request {
                snapshot_id: scan.snapshot_id.unwrap(),
                operation: Operation::Update,
                path: Some(installed.clone()),
                source: None,
            },
            &home,
            &native,
        )
        .unwrap();
    assert_ne!(update.revision.as_deref(), Some(first.as_str()));
    assert!(!update.enabled);
    assert_eq!(
        state
            .commit_with(&update.plan_id, &home, &native, &|_| unreachable!())
            .unwrap()
            .status,
        "Succeeded"
    );
    assert!(fs::read_to_string(&installed)
        .unwrap()
        .contains("version two"));
    let tag = Source::Github {
        repo: "skills-test/fixture".into(),
        subdirectory: "skills/source".into(),
        reference: "v1".into(),
        reference_kind: "tag".into(),
    };
    let tagged = files::stage(&home, &tag, None).unwrap();
    assert_eq!(tagged.revision, first);
    git(&["tag", "-f", "v1"]);
    let pinned = files::stage(&home, &tag, Some(&first)).unwrap();
    assert_eq!(pinned.revision, first);
    assert!(fs::read_to_string(pinned.directory.join("SKILL.md"))
        .unwrap()
        .contains("version one"));
    assert!(fs::read_to_string(source.join("SKILL.md"))
        .unwrap()
        .contains("version two"));
    assert_eq!(git(&["status", "--porcelain"]), "");
}

#[test]
fn project_skills_never_enter_the_user_inventory() {
    let f = Fixture::new();
    let path = f.source.join("SKILL.md").display().to_string();
    f.native.extra.borrow_mut().push(Skill {
        name: "project-only".into(),
        description: "Project context".into(),
        path: path.clone(),
        scope: "repo".into(),
        plugin_id: None,
        enabled: true,
    });
    let scan = f.state.scan_with(f.home.clone(), &f.native).unwrap();
    assert!(scan.skills.is_empty());
    assert!(f.request(Operation::Disable, Some(&path)).is_err());
}

#[test]
fn missing_native_ownership_is_not_treated_as_an_independent_skill() {
    let mut value = json!({"name":"skill","description":"fixture","path":"/skills/SKILL.md","scope":"user","enabled":true});
    assert!(serde_json::from_value::<Skill>(value.clone()).is_err());
    value["pluginId"] = serde_json::Value::Null;
    assert!(independent(
        &serde_json::from_value::<Skill>(value.clone()).unwrap()
    ));
    value["pluginId"] = json!("writer@market");
    assert!(!independent(
        &serde_json::from_value::<Skill>(value).unwrap()
    ));
}
