use super::*;
use crate::claude_cli::Output;

fn runner(_: &Path, args: &[&str], _: std::time::Duration) -> Result<Output, String> {
    Ok(Output {
        success: true,
        stdout: if args == ["--version"] {
            "2.1.300 (Claude Code)".into()
        } else {
            "[]".into()
        },
        stderr: String::new(),
    })
}
fn fixture() -> (tempfile::TempDir, HooksState, HookScan) {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("settings.json"), json!({"disableAllHooks":true,"unrelated":{"preserve":42},"hooks":{"PreToolUse":[{"matcher":"Bash","groupExtra":"keep","hooks":[{"type":"command","command":"first","future":{"keep":true}},{"type":"command","command":"second"}]}]}}).to_string()).unwrap();
    let state = HooksState::default();
    let scan = state.scan_with(directory.path().into(), &runner).unwrap();
    (directory, state, scan)
}
fn edit(scan: &HookScan, event: &str, matcher: &str) -> DefinitionRequest {
    let hook = &scan.hooks[0];
    DefinitionRequest {
        snapshot_id: scan.snapshot_id.clone().unwrap(),
        action: Action::Edit,
        hook_id: Some(hook.id.clone()),
        draft: Some(Draft {
            event: event.into(),
            matcher: Some(matcher.into()),
            handler: hook.handler.clone(),
        }),
    }
}

#[test]
fn shared_matcher_edit_splits_only_target_and_preserves_unknown_fields_and_switch() {
    let (dir, state, scan) = fixture();
    assert_eq!(scan.disable_all_hooks, Some(true));
    let preview = state
        .prepare_with(edit(&scan, "PreToolUse", "Write"), dir.path().into())
        .unwrap();
    let result = state
        .commit_with(
            CommitRequest {
                preview_id: preview.preview_id,
            },
            dir.path().into(),
            &runner,
        )
        .unwrap();
    assert_eq!(result.status, "Succeeded");
    let saved = Document::read(&dir.path().join("settings.json"))
        .unwrap()
        .value;
    assert_eq!(saved["disableAllHooks"], true);
    assert_eq!(saved["unrelated"]["preserve"], 42);
    let groups = saved["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0]["matcher"], "Bash");
    assert_eq!(
        groups[0]["hooks"],
        json!([{"type":"command","command":"second"}])
    );
    assert_eq!(groups[1]["matcher"], "Write");
    assert_eq!(groups[1]["groupExtra"], "keep");
    assert_eq!(groups[1]["hooks"][0]["future"]["keep"], true);
}

#[test]
fn preview_can_be_replaced_without_losing_original_snapshot() {
    let (dir, state, scan) = fixture();
    let first = state
        .prepare_with(edit(&scan, "PreToolUse", "Write"), dir.path().into())
        .unwrap();
    let next = state
        .prepare_with(edit(&scan, "PreToolUse", "Edit"), dir.path().into())
        .unwrap();
    assert_ne!(first.preview_id, next.preview_id);
    assert_eq!(next.after.unwrap()["matcher"], "Edit");
}

#[test]
fn external_edit_after_preview_is_never_overwritten() {
    let (dir, state, scan) = fixture();
    let preview = state
        .prepare_with(edit(&scan, "PreToolUse", "Write"), dir.path().into())
        .unwrap();
    let path = dir.path().join("settings.json");
    let mut content = Document::read(&path).unwrap().value;
    content["external"] = json!("keep this");
    std::fs::write(&path, content.to_string()).unwrap();
    let result = state
        .commit_with(
            CommitRequest {
                preview_id: preview.preview_id,
            },
            dir.path().into(),
            &runner,
        )
        .unwrap();
    assert_eq!(result.status, "Conflict");
    assert!(!result.executed);
    assert_eq!(Document::read(&path).unwrap().value, content);
}

#[test]
fn delete_removes_only_selected_definition_and_keeps_script() {
    let (dir, state, scan) = fixture();
    let script = dir.path().join("script.sh");
    std::fs::write(&script, "fixture script").unwrap();
    let preview = state
        .prepare_with(
            DefinitionRequest {
                snapshot_id: scan.snapshot_id.unwrap(),
                action: Action::Delete,
                hook_id: Some(scan.hooks[0].id.clone()),
                draft: None,
            },
            dir.path().into(),
        )
        .unwrap();
    state
        .commit_with(
            CommitRequest {
                preview_id: preview.preview_id,
            },
            dir.path().into(),
            &runner,
        )
        .unwrap();
    assert_eq!(
        Document::read(&dir.path().join("settings.json"))
            .unwrap()
            .value["hooks"]["PreToolUse"][0]["hooks"],
        json!([{"type":"command","command":"second"}])
    );
    assert_eq!(std::fs::read_to_string(script).unwrap(), "fixture script");
}

#[test]
fn all_five_types_have_required_fields_and_event_restrictions() {
    for handler in [
        json!({"type":"command","command":"echo test","args":[]}),
        json!({"type":"http","url":"https://example.invalid","headers":{"X-Test":"$TOKEN"},"allowedEnvVars":["TOKEN"]}),
        json!({"type":"mcp_tool","server":"s","tool":"t","input":{}}),
        json!({"type":"prompt","prompt":"verify","continueOnBlock":false}),
        json!({"type":"agent","prompt":"verify"}),
    ] {
        assert!(validate(
            &Draft {
                event: "PreToolUse".into(),
                matcher: Some("Bash".into()),
                handler
            },
            None
        )
        .is_ok());
    }
    assert!(validate(
        &Draft {
            event: "SessionStart".into(),
            matcher: None,
            handler: json!({"type":"http","url":"https://example.invalid"})
        },
        None
    )
    .is_err());
    assert!(validate(
        &Draft {
            event: "PermissionRequest".into(),
            matcher: None,
            handler: json!({"type":"agent","prompt":"verify"})
        },
        None
    )
    .is_err());
    assert!(validate(
        &Draft {
            event: "Stop".into(),
            matcher: None,
            handler: json!({"type":"command","command":"x","if":"Bash(*)"})
        },
        None
    )
    .is_err());
    assert!(validate(
        &Draft {
            event: "PreToolUse".into(),
            matcher: None,
            handler: json!({"type":"command","command":"x","async":true,"timeout":10})
        },
        None
    )
    .is_err());
}

#[test]
fn unknown_fields_cannot_be_changed_or_dropped() {
    let (_dir, _state, scan) = fixture();
    let original = &scan.hooks[0];
    let mut draft = Draft {
        event: original.event.clone(),
        matcher: original.matcher.clone(),
        handler: original.handler.clone(),
    };
    draft.handler.as_object_mut().unwrap().remove("future");
    assert!(validate(&draft, Some(original)).is_err());
    draft.handler["future"] = json!({"keep":false});
    assert!(validate(&draft, Some(original)).is_err());
}

#[test]
fn missing_cli_keeps_user_definitions_readable_but_unwritable() {
    let (dir, state, _) = fixture();
    let scan = state
        .scan_with(
            dir.path().into(),
            &|_, _, _| Err("未找到 Claude CLI".into()),
        )
        .unwrap();
    assert_eq!(scan.hooks.len(), 2);
    assert!(scan.snapshot_id.is_none());
    assert!(scan.write_blocked_reason.is_some());
}

#[test]
fn first_create_makes_only_required_hooks_and_preview_never_writes() {
    let dir = tempfile::tempdir().unwrap();
    let state = HooksState::default();
    let scan = state.scan_with(dir.path().into(), &runner).unwrap();
    let preview = state
        .prepare_with(
            DefinitionRequest {
                snapshot_id: scan.snapshot_id.unwrap(),
                action: Action::Create,
                hook_id: None,
                draft: Some(Draft {
                    event: "Stop".into(),
                    matcher: None,
                    handler: json!({"type":"prompt","prompt":"check"}),
                }),
            },
            dir.path().into(),
        )
        .unwrap();
    assert!(!dir.path().join("settings.json").exists());
    state
        .commit_with(
            CommitRequest {
                preview_id: preview.preview_id,
            },
            dir.path().into(),
            &runner,
        )
        .unwrap();
    assert_eq!(
        Document::read(&dir.path().join("settings.json"))
            .unwrap()
            .value,
        json!({"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"check"}]}]}})
    );
}

#[test]
fn malformed_and_unknown_definitions_are_not_silently_editable() {
    let mut messages = vec![];
    let rows = flatten(
        &json!({"FutureEvent":[{"hooks":[{"type":"future","content":1}]}],"Stop":"invalid"}),
        "/settings.json",
        "user",
        None,
        &mut messages,
    );
    assert_eq!(rows.len(), 1);
    assert!(rows[0].read_only_reason.is_some());
    assert!(!messages.is_empty());
}

#[cfg(unix)]
#[test]
fn symlink_replacement_invalidates_document_and_preserves_permissions() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "{}").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let doc = Document::read(&path).unwrap();
    doc.write(&json!({"hooks":{}})).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let doc = Document::read(&path).unwrap();
    let other = dir.path().join("other.json");
    std::fs::write(&other, "{}").unwrap();
    std::fs::remove_file(&path).unwrap();
    symlink(&other, &path).unwrap();
    assert!(doc.write(&json!({"hooks":{"Stop":[]}})).is_err());
    assert_eq!(std::fs::read_to_string(other).unwrap(), "{}");
}

#[test]
fn saving_hooks_preserves_unrelated_configuration_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let text =
        "{\n\t\"unrelated\" : { \"value\" : 1.00 },\n  \"hooks\": {},\n \"tail\" : [1, 2]\n}\n";
    std::fs::write(&path, text).unwrap();
    let document = Document::read(&path).unwrap();
    let mut next = document.value.clone();
    next["hooks"] = json!({"Stop":[]});
    document.write(&next).unwrap();
    let actual = std::fs::read_to_string(&path).unwrap();
    assert!(actual.starts_with("{\n\t\"unrelated\" : { \"value\" : 1.00 },\n  \"hooks\": "));
    assert!(actual.ends_with(",\n \"tail\" : [1, 2]\n}\n"));
}
