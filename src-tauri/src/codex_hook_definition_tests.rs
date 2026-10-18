use super::*;
use std::path::{Path, PathBuf};
use std::{cell::Cell, fs};

fn observe(home: &Path) -> (DefinitionScan, Option<DefinitionObservation>) {
    let observed =
        super::super::observation::observe_with(home, &super::super::observation::NativeCodex);
    (observed.definitions, observed.definition_observation)
}

fn fixture(format: Format) -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let home = fs::canonicalize(temp.path()).unwrap();
    fs::write(
        home.join("config.toml"),
        "# keep header\nmodel_reasoning_effort = 'low' # keep setting\n[features]\nhooks = false\n",
    )
    .unwrap();
    let mut source = Source::read(&home, format).unwrap();
    let handler = json!({"type":"command", "command":"echo same", "commandWindows":"echo windows", "statusMessage":"fixture"});
    source
        .append_group("PostToolUse", Some("Bash"), &handler)
        .unwrap();
    // Two identical handlers in one group, with different enablement.
    if format == Format::Json {
        source.value["hooks"]["PostToolUse"][0]["hooks"]
            .as_array_mut()
            .unwrap()
            .push(handler.clone());
        source.value["unrelated"] = json!({"keep":[1,2,3]});
        source.file.write(&source.text().unwrap()).unwrap();
    } else {
        let handler = "\n[[hooks.PostToolUse.hooks]]\ntype = 'command'\ncommand = 'echo same'\ncommandWindows = 'echo windows'\nstatusMessage = 'fixture'\n";
        let text = fs::read_to_string(home.join("config.toml")).unwrap()
            + "\n[[hooks.PostToolUse]]\nmatcher = 'Bash'\n"
            + handler
            + "\n# keep second handler\n"
            + handler;
        source.file.write(&text).unwrap();
    }
    let mut source = Source::read(&home, format).unwrap();
    source
        .append_group(
            "Stop",
            None,
            &json!({"type":"command","command":"echo unrelated"}),
        )
        .unwrap();
    source.file.write(&source.text().unwrap()).unwrap();
    (temp, home)
}

fn synthetic(home: &Path) -> DefinitionObservation {
    let sources: Vec<_> = [Format::Json, Format::Toml]
        .into_iter()
        .map(|f| Source::read(home, f).unwrap())
        .collect();
    let mut native = vec![];
    let mut states = json!({});
    let mut origins = json!({});
    for source in &sources {
        for definition in source.definitions().unwrap() {
            let key = definition.location.key(&source.file.path).unwrap();
            let enabled = definition.location.handler != 1;
            states[&key] = json!({"enabled":enabled,"trusted_hash":"same-hash"});
            for field in ["enabled", "trusted_hash"] {
                origins[format!("hooks.state.{key}.{field}")] =
                    json!({"name":{"type":"user","file":home.join("config.toml")}});
            }
            native.push(serde_json::from_value(json!({
                "key":key,"currentHash":"same-hash", "eventName":definition.location.event[..1].to_lowercase()+&definition.location.event[1..],
                "handlerType":"command","source":"user","sourcePath":source.file.path,
                "enabled":enabled,"isManaged":false,"trustStatus":"trusted", "displayOrder":native.len(),
                "matcher":definition.matcher,"timeoutSec":600,"command":definition.handler["command"],"statusMessage":"fixture"
            })).unwrap());
        }
    }
    let mut config = Source::read(home, Format::Toml).unwrap();
    for (key, value) in states.as_object().unwrap() {
        config.set_state(key, Some(value)).unwrap();
    }
    config.file.write(&config.text().unwrap()).unwrap();
    DefinitionObservation {
        id: "snapshot".into(),
        home: home.into(),
        native,
        feature_enabled: false,
        sources: [Format::Json, Format::Toml]
            .into_iter()
            .map(|f| Source::read(home, f).unwrap())
            .collect(),
        config: ConfigView {
            target: home.join("config.toml"),
            version: "version".into(),
            states,
            origins,
        },
    }
}

fn request(source: Format, action: DefinitionAction, id: Option<String>) -> DefinitionRequest {
    DefinitionRequest {
        snapshot_id: "snapshot".into(),
        source,
        action,
        id,
        event: None,
        matcher: None,
        fields: None,
        enabled: None,
    }
}

fn fields(command: &str) -> Fields {
    serde_json::from_value(json!({"kind":"command","command":command})).unwrap()
}

#[test]
fn saving_requires_an_existing_codex_home() {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().join("missing/nested");
    for format in [Format::Json, Format::Toml] {
        let source = Source::read(&home, format).unwrap();
        let error = source.write(&source.text().unwrap()).err().unwrap();
        assert!(error.starts_with("无法准备保存："));
        assert!(!home.exists());
    }
}

#[test]
fn deleting_first_duplicate_preserves_disabled_sibling_and_unrelated_trust_in_both_formats() {
    for format in [Format::Json, Format::Toml] {
        let (_temp, home) = fixture(format);
        let observation = synthetic(&home);
        let source = observation
            .sources
            .iter()
            .find(|s| s.format == format)
            .unwrap();
        let definitions = source.definitions().unwrap();
        let first = &definitions[0];
        let first_key = first.location.key(&source.file.path).unwrap();
        let second_key = definitions[1].location.key(&source.file.path).unwrap();
        let unrelated_key = definitions[2].location.key(&source.file.path).unwrap();
        let plan = prepare(
            observation,
            request(
                format,
                DefinitionAction::Delete,
                Some(first.location.id(format)),
            ),
            "plan".into(),
        )
        .unwrap();
        assert_eq!(plan.preview.impacts.len(), 2);
        assert_eq!(plan.save().status, "Saved");
        let state = Source::read(&home, Format::Toml).unwrap().state().unwrap();
        assert_eq!(state[&first_key], json!({"enabled":false}));
        assert!(state.get(second_key).is_none());
        assert_eq!(state[unrelated_key]["trusted_hash"], "same-hash");
        let source = Source::read(&home, format).unwrap();
        assert_eq!(source.definitions().unwrap().len(), 2);
        if format == Format::Json {
            assert_eq!(source.value["unrelated"], json!({"keep":[1,2,3]}));
        }
        let text = fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(text.contains("# keep header") && text.contains("# keep setting"));
        if format == Format::Toml {
            assert!(text.contains("# keep second handler"));
        }
        assert_eq!(
            source.value["hooks"]["PostToolUse"][0]["hooks"][0]["commandWindows"],
            "echo windows"
        );
    }
}

#[test]
fn splitting_one_handler_preserves_other_definitions_and_clears_only_affected_trust() {
    let (_temp, home) = fixture(Format::Toml);
    let observation = synthetic(&home);
    let definitions = observation.sources[1].definitions().unwrap();
    let mut req = request(
        Format::Toml,
        DefinitionAction::Update,
        Some(definitions[0].location.id(Format::Toml)),
    );
    req.event = Some("PostToolUse".into());
    req.matcher = Some("Edit".into());
    req.fields = Some(serde_json::from_value(json!({"kind":"command","command":"echo same", "commandWindows":"echo windows","statusMessage":"fixture"})).unwrap());
    let plan = prepare(observation, req, "plan".into()).unwrap();
    assert_eq!(plan.save().status, "Saved");
    let source = Source::read(&home, Format::Toml).unwrap();
    let defs = source.definitions().unwrap();
    assert_eq!(defs.len(), 3);
    assert_eq!(
        defs.iter()
            .filter(|d| d.matcher.as_deref() == Some("Bash"))
            .count(),
        1
    );
    assert_eq!(
        defs.iter()
            .filter(|d| d.matcher.as_deref() == Some("Edit"))
            .count(),
        1
    );
    assert!(source.file.text.unwrap().contains("# keep second handler"));
}

#[test]
fn json_interrupted_commit_leaves_affected_identities_disabled_without_old_trust() {
    for fail_at in [2, 3] {
        let (_temp, home) = fixture(Format::Json);
        let observation = synthetic(&home);
        let original = fs::read_to_string(home.join("hooks.json")).unwrap();
        let id = observation.sources[0].definitions().unwrap()[0]
            .location
            .id(Format::Json);
        let plan = prepare(
            observation,
            request(Format::Json, DefinitionAction::Delete, Some(id)),
            "plan".into(),
        )
        .unwrap();
        let calls = Cell::new(0);
        let result = plan.save_with(&|source, text| {
            calls.set(calls.get() + 1);
            if calls.get() == fail_at {
                Err("injected disk failure".into())
            } else {
                source.write(text)
            }
        });
        assert_eq!(result.status, "Partial");
        assert!(result.message.contains(&plan.preview.source_path));
        assert!(result.message.contains("操作前启用"));
        assert!(result.message.contains("操作前禁用"));
        for impact in &plan.preview.impacts {
            assert!(result.message.contains(&impact.operation));
        }
        let states = Source::read(&home, Format::Toml).unwrap().state().unwrap();
        for key in &plan.affected {
            assert_eq!(states[key], json!({"enabled":false}));
        }
        assert_eq!(
            fs::read_to_string(home.join("hooks.json")).unwrap() == original,
            fail_at == 2
        );
    }
}

#[test]
fn external_definition_changes_reject_without_touching_state() {
    let (_temp, home) = fixture(Format::Json);
    let observation = synthetic(&home);
    let id = observation.sources[0].definitions().unwrap()[0]
        .location
        .id(Format::Json);
    let plan = prepare(
        observation,
        request(Format::Json, DefinitionAction::Delete, Some(id)),
        "plan".into(),
    )
    .unwrap();
    let before = fs::read(home.join("config.toml")).unwrap();
    let json_path = home.join("hooks.json");
    fs::write(
        &json_path,
        fs::read_to_string(&json_path)
            .unwrap()
            .replace("echo windows", "external windows"),
    )
    .unwrap();
    assert_eq!(plan.save().status, "Conflict");
    assert_eq!(fs::read(home.join("config.toml")).unwrap(), before);
}

#[test]
fn inline_toml_unknown_fields_and_absent_defaults_survive_editing() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("config.toml");
    fs::write(&path, "# head\n[hooks]\nStop = [{hooks = [{type = 'command', command = 'old', custom = 'keep'}]}] # event note\n").unwrap();
    let mut source = Source::read(temp.path(), Format::Toml).unwrap();
    let def = source.definitions().unwrap().remove(0);
    source
        .replace_handler(&def.location, Some(&fields("new").apply(&def.handler)))
        .unwrap();
    let text = source.text().unwrap();
    assert!(text.contains("# head") && text.contains("# event note") && text.contains("keep"));
    assert!(!text.contains("timeout") && !text.contains("async"));
    source.file.write(&text).unwrap();
    assert_eq!(
        Source::read(temp.path(), Format::Toml)
            .unwrap()
            .definitions()
            .unwrap()[0]
            .handler["command"],
        "new"
    );
}

#[test]
fn fields_validate_event_type_limits_and_preserve_unknown_data() {
    let mcp: Fields = serde_json::from_value(json!({"kind":"mcp_tool","server":"workspace","tool":"context","input":{"nested":{"key":[1,true,"${field}"]}}})).unwrap();
    assert!(mcp.validate("SessionEnd", None).is_err());
    assert!(mcp.validate("SessionStart", None).is_ok());
    assert!(fields("echo test").validate("Stop", Some("Bash")).is_err());
    assert!(fields("echo test")
        .validate("PostToolUse", Some("[broken"))
        .is_err());
    let mut timeout = fields("echo test");
    timeout.timeout = Some(4);
    assert!(timeout.validate("Interrupt", None).is_err());
    assert_eq!(mcp.apply(&json!({"custom":"keep"}))["custom"], "keep");
}

#[test]
#[ignore = "requires installed Codex CLI 0.162.1; all writes use isolated temporary homes"]
fn real_cli_definition_crud_preserves_siblings_and_never_executes_hooks() {
    for format in [Format::Json, Format::Toml] {
        let (_temp, home) = fixture(format);
        if format == Format::Json {
            let mut source = Source::read(&home, format).unwrap();
            source.value.as_object_mut().unwrap().remove("unrelated");
            source.value["description"] = "Preserve this description".into();
            source.file.write(&source.text().unwrap()).unwrap();
        } else {
            let path = home.join("config.toml");
            fs::write(
                &path,
                fs::read_to_string(&path)
                    .unwrap()
                    .replace("commandWindows", "command_windows"),
            )
            .unwrap();
        }
        let (hooks, _, _) = native(&home).unwrap();
        let mut config = Source::read(&home, Format::Toml).unwrap();
        for (index, hook) in hooks.iter().enumerate() {
            config
                .set_state(
                    &hook.key,
                    Some(&json!({"enabled":index != 1,"trusted_hash":hook.current_hash})),
                )
                .unwrap();
        }
        config.file.write(&config.text().unwrap()).unwrap();
        let (view, observation) = observe(&home);
        assert!(
            observation.is_some(),
            "{:?}; native keys: {:?}; expected: {:?}",
            view.read_only_reason,
            native(&home)
                .unwrap()
                .0
                .iter()
                .map(|h| (&h.key, &h.source_path))
                .collect::<Vec<_>>(),
            Source::read(&home, format)
                .unwrap()
                .definitions()
                .unwrap()
                .iter()
                .map(|d| d.location.key(&home.join(format.filename())))
                .collect::<Vec<_>>()
        );
        let observation = observation.unwrap();
        assert!(!observation.feature_enabled);
        let first = view
            .entries
            .iter()
            .find(|e| e.event == "PostToolUse")
            .unwrap();
        let plan = prepare(
            observation,
            request(format, DefinitionAction::Delete, Some(first.id.clone())),
            "delete".into(),
        )
        .unwrap();
        plan.validate_candidate().unwrap();
        plan.observation.fresh().unwrap();
        assert_eq!(plan.save().status, "Saved");
        plan.verify_saved().unwrap();
        let (view, observation) = observe(&home);
        assert!(observation.is_some(), "{:?}", view.read_only_reason);
        let remaining = view
            .entries
            .iter()
            .find(|e| e.event == "PostToolUse")
            .unwrap();
        assert_eq!(remaining.enabled, Some(false));
        assert_eq!(remaining.trust_status, "untrusted");
        let sentinel = home.join("hook-executed");
        let mut state = Source::read(&home, Format::Toml).unwrap();
        let new_key = documents::Location {
            event: "SessionStart".into(),
            group: 0,
            handler: 0,
        }
        .key(&home.join(format.filename()))
        .unwrap();
        state
            .set_state(
                &new_key,
                Some(&json!({"enabled":false,"trusted_hash":"obsolete-position-trust"})),
            )
            .unwrap();
        state.file.write(&state.text().unwrap()).unwrap();
        let (_, observation) = observe(&home);
        let mut req = request(format, DefinitionAction::Create, None);
        req.event = Some("SessionStart".into());
        req.enabled = Some(true);
        req.fields = Some(fields(&format!("touch '{}'", sentinel.display())));
        let plan = prepare(observation.unwrap(), req, "create".into()).unwrap();
        plan.validate_candidate().unwrap();
        plan.observation.fresh().unwrap();
        assert_eq!(plan.save().status, "Saved");
        plan.verify_saved().unwrap();
        let (view, observation) = observe(&home);
        let created = view
            .entries
            .iter()
            .find(|e| e.event == "SessionStart")
            .unwrap();
        assert_eq!(created.enabled, Some(true));
        assert_eq!(created.trust_status, "untrusted");
        let mut req = request(format, DefinitionAction::Update, Some(created.id.clone()));
        req.event = Some("SessionStart".into());
        req.fields = Some(serde_json::from_value(json!({"kind":"mcp_tool","server":"fixture","tool":"context","input":{"project":"${cwd}","options":{"concise":true}}})).unwrap());
        let plan = prepare(observation.unwrap(), req, "update-mcp".into()).unwrap();
        plan.validate_candidate().unwrap();
        plan.observation.fresh().unwrap();
        assert_eq!(plan.save().status, "Saved");
        plan.verify_saved().unwrap();
        let saved = Source::read(&home, format)
            .unwrap()
            .definitions()
            .unwrap()
            .into_iter()
            .find(|d| d.location.event == "SessionStart")
            .unwrap();
        assert_eq!(
            saved.handler["input"],
            json!({"project":"${cwd}","options":{"concise":true}})
        );
        assert!(!sentinel.exists());
        assert_eq!(
            Source::read(&home, Format::Toml).unwrap().value["features"]["hooks"],
            false
        );
    }
    let temp = tempfile::tempdir().unwrap();
    let home = fs::canonicalize(temp.path()).unwrap();
    let (view, observation) = observe(&home);
    assert!(
        observation.is_some(),
        "fresh home: {:?}",
        view.read_only_reason
    );
    let mut req = request(Format::Json, DefinitionAction::Create, None);
    req.event = Some("Stop".into());
    req.enabled = Some(false);
    req.fields = Some(fields("echo first"));
    let plan = prepare(observation.unwrap(), req, "first".into()).unwrap();
    plan.validate_candidate().unwrap();
    assert_eq!(plan.save().status, "Saved");
    plan.verify_saved().unwrap();
}
