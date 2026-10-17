use super::*;
use crate::skill_installation_copy::Ledger;
use std::time::Duration;

fn runner(_: &Path, args: &[&str], _: Duration) -> Result<claude_cli::Output, String> {
    Ok(claude_cli::Output {
        success: true,
        stdout: if args == ["--version"] {
            "2.1.302 (Claude Code)"
        } else {
            "[]"
        }
        .into(),
        stderr: String::new(),
    })
}
fn workspace() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("claude");
    fs::create_dir(&home).unwrap();
    let home = home.canonicalize().unwrap();
    (temp, home)
}
fn skill(directory: &Path, name: &str) -> PathBuf {
    fs::create_dir_all(directory).unwrap();
    fs::write(
        directory.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Test skill\n---\nDo not execute.\n"),
    )
    .unwrap();
    directory.join("SKILL.md")
}
fn request(
    scan: &Scan,
    operation: Operation,
    path: Option<&Path>,
    source: Option<Source>,
    mode: Option<&str>,
) -> Request {
    Request {
        snapshot_id: scan.snapshot_id.clone(),
        operation,
        path: path.map(|p| p.display().to_string()),
        source,
        mode: mode.map(str::to_string),
    }
}
fn installed(state: &SkillsState, home: &Path, source: &Path, native: &Runner) -> PathBuf {
    let scan = state.scan_with(home.into(), native).unwrap();
    let preview = state
        .prepare_with(
            request(
                &scan,
                Operation::Install,
                None,
                Some(Source::Local {
                    path: source.display().to_string(),
                }),
                None,
            ),
            home,
            native,
        )
        .unwrap();
    assert_eq!(
        state
            .commit_with(&preview.plan_id, home, native, &|_| panic!(
                "unexpected trash"
            ))
            .unwrap()
            .status,
        "Succeeded"
    );
    PathBuf::from(preview.path)
}

#[test]
fn definitions_keep_disabled_existing_linked_legacy_and_synced_sources() {
    let (_temp, home) = workspace();
    skill(&home.join("skills/deploy"), "release");
    skill(&home.join("skills/synced/account-skill"), "account-skill");
    fs::create_dir_all(home.join("commands/front")).unwrap();
    fs::write(
        home.join("commands/front/build.md"),
        "---\ndescription: Build\n---\nBody",
    )
    .unwrap();
    fs::write(
        home.join("settings.json"),
        r#"{"skillOverrides":{"deploy":"off"}}"#,
    )
    .unwrap();
    let state = SkillsState::default();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    assert!(scan.write_blocked.is_none(), "{:?}", scan.warnings);
    let row = scan
        .skills
        .iter()
        .find(|r| r.definition.name == "release")
        .unwrap();
    assert_eq!(row.definition.setting_key.as_deref(), Some("deploy"));
    assert_eq!(row.mode.as_deref(), Some("off"));
    assert!(!row.managed);
    assert!(row.setting_blocked.is_none());
    assert!(row.uninstall_blocked.is_some());
    assert!(scan
        .skills
        .iter()
        .any(|r| r.definition.setting_key.as_deref() == Some("front:build")));
    assert!(scan
        .skills
        .iter()
        .any(|r| r.definition.kind == "synced" && r.setting_blocked.is_some()));
}

#[test]
fn cli_missing_or_unverified_preserves_readable_definitions_and_blocks_writes() {
    let (_temp, home) = workspace();
    skill(&home.join("skills/deploy"), "deploy");
    let missing: &Runner = &|_, _, _| Err("CLI missing".into());
    let old: &Runner = &|_, args, _| {
        Ok(claude_cli::Output {
            success: true,
            stdout: if args == ["--version"] {
                "2.1.300"
            } else {
                "[]"
            }
            .into(),
            stderr: String::new(),
        })
    };
    for native in [missing, old] {
        let state = SkillsState::default();
        let scan = state.scan_with(home.clone(), native).unwrap();
        assert_eq!(scan.skills.len(), 1);
        assert!(scan.write_blocked.is_some());
        assert!(state
            .prepare_with(
                request(
                    &scan,
                    Operation::SetMode,
                    Some(Path::new(&scan.skills[0].definition.path)),
                    None,
                    Some("off")
                ),
                &home,
                native
            )
            .is_err());
    }
    assert!(
        claude_cli::write_blocked("2.1.302").is_some(),
        "skill support must not change extension compatibility"
    );
}

#[test]
fn each_mode_and_removal_updates_directory_key_and_preserves_unrelated_settings() {
    let (_temp, home) = workspace();
    let path = skill(&home.join("skills/deploy"), "release");
    let original = "{\n  \"unchanged\" : [ 1,  2 ],\n  \"skillOverrides\": {\"another\": {\"future\":true}}\n}";
    fs::write(home.join("settings.json"), original).unwrap();
    let state = SkillsState::default();
    for selection in [
        Some("on"),
        Some("name-only"),
        Some("user-invocable-only"),
        Some("off"),
        None,
    ] {
        let scan = state.scan_with(home.clone(), &runner).unwrap();
        let preview = state
            .prepare_with(
                request(&scan, Operation::SetMode, Some(&path), None, selection),
                &home,
                &runner,
            )
            .unwrap();
        assert_eq!(preview.setting_key.as_deref(), Some("deploy"));
        assert_eq!(
            state
                .commit_with(&preview.plan_id, &home, &runner, &|_| unreachable!())
                .unwrap()
                .status,
            "Saved"
        );
        let text = fs::read_to_string(home.join("settings.json")).unwrap();
        assert!(text.contains("\"unchanged\" : [ 1,  2 ]"));
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["skillOverrides"]["deploy"].as_str(), selection);
        assert!(value["skillOverrides"]["another"]["future"]
            .as_bool()
            .unwrap());
        assert!(value["skillOverrides"].get("release").is_none());
    }
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "---\nname: release\ndescription: Test skill\n---\nDo not execute.\n"
    );
}

#[test]
fn native_setting_scope_keeps_legacy_command_names() {
    let (_temp, home) = workspace();
    fs::create_dir_all(home.join("commands/front")).unwrap();
    let path = home.join("commands/front/build.md");
    fs::write(&path, "A legacy instruction").unwrap();
    let state = SkillsState::default();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    let preview = state
        .prepare_with(
            request(&scan, Operation::SetMode, Some(&path), None, Some("off")),
            &home,
            &runner,
        )
        .unwrap();
    state
        .commit_with(&preview.plan_id, &home, &runner, &|_| unreachable!())
        .unwrap();
    assert_eq!(
        Document::read(&home.join("settings.json")).unwrap().value["skillOverrides"]["front:build"],
        "off"
    );
}

#[test]
fn install_update_and_trash_preserve_source_and_call_settings() {
    let (_temp, home) = workspace();
    let source = home.parent().unwrap().join("source/deploy");
    skill(&source, "release");
    fs::write(
        home.join("settings.json"),
        r#"{"skillOverrides":{"deploy":"off"},"unrelated":true}"#,
    )
    .unwrap();
    let settings = fs::read_to_string(home.join("settings.json")).unwrap();
    let state = SkillsState::default();
    let path = installed(&state, &home, &source, &runner);
    assert_ne!(path.parent().unwrap(), source);
    assert!(source.exists());
    fs::write(source.join("notes.txt"), "upstream change").unwrap();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    assert!(scan.skills[0].managed);
    assert!(scan.skills[0].update_blocked.is_none());
    let preview = state
        .prepare_with(
            request(&scan, Operation::Update, Some(&path), None, None),
            &home,
            &runner,
        )
        .unwrap();
    assert_eq!(
        state
            .commit_with(&preview.plan_id, &home, &runner, &|_| unreachable!())
            .unwrap()
            .status,
        "Succeeded"
    );
    assert_eq!(
        fs::read_to_string(path.parent().unwrap().join("notes.txt")).unwrap(),
        "upstream change"
    );
    fs::write(path.parent().unwrap().join("local.txt"), "local work").unwrap();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    assert!(scan.skills[0].update_blocked.is_some());
    assert!(scan.skills[0].uninstall_blocked.is_none());
    assert!(state
        .prepare_with(
            request(&scan, Operation::Update, Some(&path), None, None),
            &home,
            &runner
        )
        .is_err());
    let preview = state
        .prepare_with(
            request(&scan, Operation::Uninstall, Some(&path), None, None),
            &home,
            &runner,
        )
        .unwrap();
    let trash = home.parent().unwrap().join("test-trash");
    let outcome = state
        .commit_with(&preview.plan_id, &home, &runner, &|p| {
            fs::rename(p, &trash).map_err(|e| e.to_string())
        })
        .unwrap();
    assert_eq!(outcome.status, "Succeeded");
    assert!(!path.exists());
    assert_eq!(
        fs::read_to_string(trash.join("local.txt")).unwrap(),
        "local work"
    );
    assert!(source.join("SKILL.md").exists());
    assert_eq!(
        fs::read_to_string(home.join("settings.json")).unwrap(),
        settings
    );
    assert!(
        Ledger::read_at(&home.join(".package-manager-claude-skills.json"))
            .unwrap()
            .records
            .installations
            .is_empty()
    );
    assert!(!home.join(".package-manager-skills.json").exists());
}

#[test]
fn conflicts_and_call_identity_changes_never_overwrite() {
    let (_temp, home) = workspace();
    let source = home.parent().unwrap().join("source/deploy");
    skill(&source, "release");
    let state = SkillsState::default();
    let path = installed(&state, &home, &source, &runner);
    let original = fs::read_to_string(&path).unwrap();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    assert!(state
        .prepare_with(
            request(
                &scan,
                Operation::Install,
                None,
                Some(Source::Local {
                    path: source.display().to_string()
                }),
                None
            ),
            &home,
            &runner
        )
        .is_err());
    skill(&source, "different-name");
    assert!(state
        .prepare_with(
            request(&scan, Operation::Update, Some(&path), None, None),
            &home,
            &runner
        )
        .unwrap_err()
        .contains("调用名称"));
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    skill(&home.join("skills/other"), "release");
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    assert!(scan.skills.iter().all(|r| r.setting_blocked.is_some()));
}

#[test]
fn external_changes_and_replayed_plans_are_rejected() {
    let (_temp, home) = workspace();
    let path = skill(&home.join("skills/deploy"), "deploy");
    let state = SkillsState::default();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    let preview = state
        .prepare_with(
            request(&scan, Operation::SetMode, Some(&path), None, Some("off")),
            &home,
            &runner,
        )
        .unwrap();
    fs::write(home.join("settings.json"), r#"{"external":true}"#).unwrap();
    assert_eq!(
        state
            .commit_with(&preview.plan_id, &home, &runner, &|_| unreachable!())
            .unwrap()
            .status,
        "Conflict"
    );
    assert_eq!(
        state
            .commit_with(&preview.plan_id, &home, &runner, &|_| unreachable!())
            .unwrap()
            .status,
        "Conflict"
    );
    assert_eq!(
        fs::read_to_string(home.join("settings.json")).unwrap(),
        r#"{"external":true}"#
    );
}

#[test]
fn malformed_definitions_unknown_settings_and_plugins_are_read_only() {
    let (_temp, home) = workspace();
    let path = skill(&home.join("skills/bad"), "bad");
    fs::write(&path, "---\nname: [bad\n---\nBody").unwrap();
    skill(&home.join("skills/deploy"), "deploy");
    fs::write(
        home.join("settings.json"),
        r#"{"skillOverrides":{"deploy":"future-mode"}}"#,
    )
    .unwrap();
    let scan = SkillsState::default()
        .scan_with(home.clone(), &runner)
        .unwrap();
    assert_eq!(scan.skills.len(), 2);
    assert!(scan.skills.iter().all(|r| r.setting_blocked.is_some()));
    assert!(
        scan.skills
            .iter()
            .find(|r| r.definition.name == "deploy")
            .unwrap()
            .mode_unknown
    );
    let plugin = home.parent().unwrap().join("plugin");
    skill(&plugin.join("skills/task"), "task");
    fs::create_dir(plugin.join(".claude-plugin")).unwrap();
    fs::write(
        plugin.join(".claude-plugin/plugin.json"),
        r#"{"name":"tool"}"#,
    )
    .unwrap();
    let inventory = json!([{"id":"tool@market", "scope":"user", "installPath":plugin, "enabled":false, "version":"1"}]);
    let scan = definitions::read(&home, Ok(&inventory));
    let row = scan.rows.iter().find(|r| r.kind == "plugin").unwrap();
    assert_eq!(row.plugin_enabled, Some(false));
    assert!(row.setting_key.is_none());
}

#[cfg(unix)]
#[test]
fn shared_links_are_readable_but_never_owned_and_replacement_aborts() {
    use std::os::unix::fs::symlink;
    let (_temp, home) = workspace();
    let source = home.parent().unwrap().join("source/deploy");
    skill(&source, "deploy");
    fs::create_dir(home.join("skills")).unwrap();
    symlink(&source, home.join("skills/shared")).unwrap();
    let state = SkillsState::default();
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    assert_eq!(scan.skills.len(), 1);
    assert!(scan.skills[0].setting_blocked.is_none());
    assert!(scan.skills[0].uninstall_blocked.is_some());
    fs::remove_file(home.join("skills/shared")).unwrap();
    let path = installed(&state, &home, &source, &runner);
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    let preview = state
        .prepare_with(
            request(&scan, Operation::Uninstall, Some(&path), None, None),
            &home,
            &runner,
        )
        .unwrap();
    fs::rename(path.parent().unwrap(), home.join("original")).unwrap();
    symlink(&source, path.parent().unwrap()).unwrap();
    assert_eq!(
        state
            .commit_with(&preview.plan_id, &home, &runner, &|_| panic!(
                "must not trash"
            ))
            .unwrap()
            .status,
        "Conflict"
    );
    assert!(source.join("SKILL.md").exists());
    assert!(home.join("original/SKILL.md").exists());
}

#[test]
fn trash_failure_restores_copy_and_record() {
    let (_temp, home) = workspace();
    let source = home.parent().unwrap().join("source/deploy");
    skill(&source, "deploy");
    let state = SkillsState::default();
    let path = installed(&state, &home, &source, &runner);
    let scan = state.scan_with(home.clone(), &runner).unwrap();
    let preview = state
        .prepare_with(
            request(&scan, Operation::Uninstall, Some(&path), None, None),
            &home,
            &runner,
        )
        .unwrap();
    assert_eq!(
        state
            .commit_with(&preview.plan_id, &home, &runner, &|_| Err(
                "trash unavailable".into()
            ))
            .unwrap()
            .status,
        "Failed"
    );
    assert!(path.exists());
    assert_eq!(
        Ledger::read_at(&home.join(".package-manager-claude-skills.json"))
            .unwrap()
            .records
            .installations
            .len(),
        1
    );
}

#[test]
fn plugin_declarations_and_reserved_sources_keep_their_ownership() {
    let (_temp, home) = workspace();
    let plugin = home.parent().unwrap().join("plugin");
    skill(&plugin.join("custom-skills/task"), "task");
    fs::create_dir(plugin.join(".claude-plugin")).unwrap();
    fs::write(plugin.join("run.md"), "Legacy plugin command").unwrap();
    fs::write(
        plugin.join(".claude-plugin/plugin.json"),
        r#"{"name":"tool","skills":"./custom-skills","commands":["./run.md"]}"#,
    )
    .unwrap();
    let inventory = json!([{"id":"tool@market", "scope":"user", "installPath":plugin, "enabled":false, "version":"1"}]);
    let scan = definitions::read(&home, Ok(&inventory));
    assert!(scan.warnings.is_empty(), "{:?}", scan.warnings);
    assert_eq!(scan.rows.len(), 2);
    assert!(scan.rows.iter().all(|row| row.kind == "plugin"
        && row.setting_key.is_none()
        && row.plugin_enabled == Some(false)));
    let state = SkillsState::default();
    for name in ["synced", "anthropic-skills", "plugin-source"] {
        let source = home.parent().unwrap().join("sources").join(name);
        skill(&source, name);
        if name == "plugin-source" {
            fs::create_dir(source.join(".claude-plugin")).unwrap();
        }
        let scan = state.scan_with(home.clone(), &runner).unwrap();
        assert!(state
            .prepare_with(
                request(
                    &scan,
                    Operation::Install,
                    None,
                    Some(Source::Local {
                        path: source.display().to_string()
                    }),
                    None
                ),
                &home,
                &runner
            )
            .is_err());
        assert!(!home.join("skills").join(name).exists());
    }
}

#[cfg(unix)]
#[test]
fn plugin_declarations_cannot_read_outside_the_installation() {
    use std::os::unix::fs::symlink;
    let (_temp, home) = workspace();
    let outside = home.parent().unwrap().join("outside");
    skill(&outside, "outside");
    let plugin = home.parent().unwrap().join("plugin");
    fs::create_dir_all(plugin.join(".claude-plugin")).unwrap();
    symlink(&outside, plugin.join("custom-skills")).unwrap();
    fs::write(
        plugin.join(".claude-plugin/plugin.json"),
        r#"{"name":"tool","skills":"./custom-skills"}"#,
    )
    .unwrap();
    let inventory = json!([{"id":"tool@market", "scope":"user", "installPath":plugin, "enabled":true, "version":"1"}]);
    let scan = definitions::read(&home, Ok(&inventory));
    assert!(scan.rows.is_empty());
    assert!(!scan.warnings.is_empty());
    assert!(outside.join("SKILL.md").exists());
}

#[cfg(unix)]
#[test]
fn links_to_plugin_or_synced_definitions_do_not_grant_independent_settings() {
    use std::os::unix::fs::symlink;
    let (_temp, home) = workspace();
    let plugin = home.parent().unwrap().join("plugin");
    skill(&plugin.join("skills/task"), "task");
    fs::create_dir_all(plugin.join(".claude-plugin")).unwrap();
    fs::write(
        plugin.join(".claude-plugin/plugin.json"),
        r#"{"name":"tool"}"#,
    )
    .unwrap();
    skill(&home.join("skills/synced/account"), "account");
    symlink(
        plugin.join("skills/task"),
        home.join("skills/linked-plugin"),
    )
    .unwrap();
    symlink(
        home.join("skills/synced/account"),
        home.join("skills/linked-account"),
    )
    .unwrap();
    let inventory = json!([{"id":"tool@market", "scope":"user", "installPath":plugin, "enabled":true, "version":"1"}]);
    let scan = definitions::read(&home, Ok(&inventory));
    let linked_plugin = scan
        .rows
        .iter()
        .find(|row| row.path.ends_with("linked-plugin/SKILL.md"))
        .unwrap();
    assert_eq!(linked_plugin.kind, "plugin");
    assert_eq!(linked_plugin.plugin_id.as_deref(), Some("tool@market"));
    assert!(linked_plugin.setting_key.is_none());
    let linked_account = scan
        .rows
        .iter()
        .find(|row| row.path.ends_with("linked-account/SKILL.md"))
        .unwrap();
    assert_eq!(linked_account.kind, "synced");
    assert!(linked_account.setting_key.is_none());
}

#[test]
#[ignore = "requires the verified Claude CLI; temporary configuration and local fixtures only"]
fn real_cli_scans_and_maintains_an_isolated_copy() {
    let (_temp, home) = workspace();
    let source = home.parent().unwrap().join("source/probe-test");
    skill(&source, "probe-test");
    let state = SkillsState::default();
    let path = installed(&state, &home, &source, &claude_cli::run);
    let scan = state.scan_with(home.clone(), &claude_cli::run).unwrap();
    assert!(scan
        .skills
        .iter()
        .any(|r| r.definition.path == path.display().to_string() && r.managed));
    let preview = state
        .prepare_with(
            request(&scan, Operation::SetMode, Some(&path), None, Some("off")),
            &home,
            &claude_cli::run,
        )
        .unwrap();
    assert_eq!(
        state
            .commit_with(
                &preview.plan_id,
                &home,
                &claude_cli::run,
                &|_| unreachable!()
            )
            .unwrap()
            .status,
        "Saved"
    );
    assert_eq!(
        Document::read(&home.join("settings.json")).unwrap().value["skillOverrides"]["probe-test"],
        "off"
    );
}
