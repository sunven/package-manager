use super::*;
use std::{cell::RefCell, collections::VecDeque};

pub(in crate::codex_hooks) struct MockServer {
    replies: VecDeque<(&'static str, Result<Value, RpcError>)>,
}

impl Session for MockServer {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        let (expected, reply) = self.replies.pop_front().expect("unexpected CLI request");
        assert_eq!(method, expected);
        match method {
            "hooks/list" => assert_eq!(params, json!({"cwds":["/"]})),
            "config/read" => assert_eq!(params, json!({"includeLayers":true,"cwd":"/"})),
            "experimentalFeature/list" => assert_eq!(params, json!({"limit":100,"cursor":null})),
            _ => panic!("unexpected CLI method: {method}"),
        }
        reply
    }
}

pub(in crate::codex_hooks) struct MockNative {
    home: PathBuf,
    sessions: RefCell<VecDeque<(bool, Result<MockServer, RpcError>)>>,
    version: String,
}

impl MockNative {
    fn reply(&mut self, method: &str, response: Result<Value, RpcError>) {
        let server = self.sessions.get_mut()[0].1.as_mut().unwrap();
        server
            .replies
            .iter_mut()
            .find(|(name, _)| *name == method)
            .unwrap()
            .1 = response;
    }

    // Existing enablement tests specify their native facts; feed them through the same reader.
    pub(in crate::codex_hooks) fn from_inventory(
        home: &Path,
        inventory: Result<Inventory, RpcError>,
    ) -> Self {
        let mut cli = native(home, json!([]), true);
        let inventory = match inventory {
            Ok(inventory) => inventory,
            Err(error) => {
                *cli.sessions.get_mut() = VecDeque::from([(false, Err(error))]);
                return cli;
            }
        };
        let hooks = serde_json::to_value(&inventory.hooks).unwrap();
        let mut response = inventory_response(hooks.clone());
        response["data"][0]["warnings"] = json!(inventory.warnings);
        response["data"][0]["errors"] = json!(inventory
            .errors
            .iter()
            .map(|message| json!({"path":"/fixture", "message":message}))
            .collect::<Vec<_>>());
        let config = inventory.config.map(|config| json!({
            "layers":[{"name":{"type":"user","file":config.target},"version":config.version}],
            "origins":config.origins, "config":{"hooks":{"state":config.states}}
        })).map_err(|message| RpcError { kind: codex_cli::RpcErrorKind::Failed, message });
        *cli.sessions.get_mut() = VecDeque::from([(
            false,
            Ok(MockServer {
                replies: VecDeque::from([
                    ("hooks/list", Ok(response)),
                    ("config/read", config),
                    (
                        "experimentalFeature/list",
                        Ok(json!({"data":[{"name":"hooks","enabled":inventory.feature_enabled}]})),
                    ),
                ]),
            }),
        )]);
        if inventory.feature_enabled == Some(false) {
            cli.sessions.get_mut().push_back((
                true,
                Ok(MockServer {
                    replies: VecDeque::from([("hooks/list", Ok(inventory_response(hooks)))]),
                }),
            ));
        }
        cli
    }
}

impl Native for MockNative {
    type Server = MockServer;

    fn connect(&self, home: &Path, inspect_hooks: bool) -> Result<Self::Server, RpcError> {
        assert_eq!(home, self.home);
        let (expected, server) = self
            .sessions
            .borrow_mut()
            .pop_front()
            .expect("unexpected CLI connection");
        assert_eq!(inspect_hooks, expected);
        server
    }

    fn version(&self, home: &Path) -> Result<codex_cli::Output, String> {
        assert_eq!(home, self.home);
        Ok(codex_cli::Output {
            success: true,
            stdout: self.version.clone(),
            stderr: String::new(),
        })
    }
}

fn inventory_response(hooks: Value) -> Value {
    json!({"data":[{"cwd":"/","hooks":hooks,"warnings":[],"errors":[]}]})
}

fn hook(home: &Path) -> Value {
    json!({
        "key":format!("{}:stop:0:0", home.join("hooks.json").display()),
        "currentHash":"hash-1", "eventName":"stop", "handlerType":"command",
        "command":"echo fixture", "source":"user", "sourcePath":home.join("hooks.json"),
        "enabled":true, "isManaged":false, "trustStatus":"trusted",
        "displayOrder":0, "timeoutSec":10
    })
}

fn native(home: &Path, hooks: Value, enabled: bool) -> MockNative {
    let config = json!({
        "layers":[{"name":{"type":"user","file":home.join("config.toml")},"version":"version-1"}],
        "origins":{}, "config":{}
    });
    MockNative {
        home: home.into(),
        sessions: RefCell::new(VecDeque::from([(
            false,
            Ok(MockServer {
                replies: VecDeque::from([
                    ("hooks/list", Ok(inventory_response(hooks))),
                    ("config/read", Ok(config)),
                    (
                        "experimentalFeature/list",
                        Ok(json!({"data":[{"name":"hooks","enabled":enabled}]})),
                    ),
                ]),
            }),
        )])),
        version: "codex-cli 0.162.1".into(),
    }
}

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().canonicalize().unwrap();
    std::fs::write(
        home.join("hooks.json"),
        r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo fixture"}]}]}}"#,
    )
    .unwrap();
    (directory, home)
}

#[test]
fn one_native_read_supplies_inventory_and_bound_definitions() {
    let (_directory, home) = fixture();
    let cli = native(&home, json!([hook(&home)]), true);

    let observed = observe_with(&home, &cli);

    let inventory = observed.inventory.unwrap();
    assert_eq!(inventory.feature_enabled, Some(true));
    assert_eq!(inventory.hooks.len(), 1);
    assert_eq!(inventory.hooks[0].command.as_deref(), Some("echo fixture"));
    let definitions = serde_json::to_value(observed.definitions).unwrap();
    assert!(definitions["readOnlyReason"].is_null());
    assert_eq!(definitions["entries"][0]["nativeKey"], hook(&home)["key"]);
    assert_eq!(definitions["entries"][0]["enabled"], true);
    assert_eq!(definitions["entries"][0]["trustStatus"], "trusted");
    assert!(observed.definition_observation.is_some());
    assert!(cli.sessions.borrow().is_empty());
}

#[test]
fn disabled_feature_inspection_binds_definitions_without_enabling_native_inventory() {
    let (_directory, home) = fixture();
    let config = "[features]\nhooks = false\n";
    std::fs::write(home.join("config.toml"), config).unwrap();
    let mut cli = native(&home, json!([]), false);
    cli.sessions.get_mut().push_back((
        true,
        Ok(MockServer {
            replies: VecDeque::from([("hooks/list", Ok(inventory_response(json!([hook(&home)]))))]),
        }),
    ));

    let state = super::super::HooksState::default();
    let scan = state.scan_with(Ok(home.clone()), &cli).unwrap();
    let scan = serde_json::to_value(scan).unwrap();

    assert_eq!(scan["status"], "Ready");
    assert_eq!(scan["featureEnabled"], false);
    assert_eq!(scan["hooks"], json!([]));
    assert!(scan["snapshotId"].is_null());
    assert!(scan["definitions"]["snapshotId"].is_string());
    assert_eq!(
        scan["definitions"]["entries"][0]["nativeKey"],
        hook(&home)["key"]
    );
    assert_eq!(scan["definitions"]["entries"][0]["enabled"], true);
    assert!(cli.sessions.borrow().is_empty());
    assert_eq!(
        std::fs::read_to_string(home.join("config.toml")).unwrap(),
        config
    );
}

#[test]
fn cli_failures_preserve_readable_definitions_without_write_approval() {
    for (kind, status) in [
        (codex_cli::RpcErrorKind::MissingCli, "MissingCli"),
        (codex_cli::RpcErrorKind::Incompatible, "Incompatible"),
        (codex_cli::RpcErrorKind::Failed, "Failed"),
    ] {
        let (_directory, home) = fixture();
        let cli = MockNative::from_inventory(
            &home,
            Err(RpcError {
                kind,
                message: "native read failed".into(),
            }),
        );

        let state = super::super::HooksState::default();
        let scan = serde_json::to_value(state.scan_with(Ok(home.clone()), &cli).unwrap()).unwrap();

        assert_eq!(scan["status"], status);
        assert_eq!(scan["message"], "native read failed");
        assert!(scan["snapshotId"].is_null());
        let definitions = &scan["definitions"];
        assert!(definitions["snapshotId"].is_null());
        assert_eq!(
            definitions["entries"][0]["handler"]["command"],
            "echo fixture"
        );
        assert!(definitions["entries"][0]["nativeKey"].is_null());
        assert_eq!(definitions["entries"][0]["trustStatus"], "unknown");
        assert_eq!(definitions["readOnlyReason"], "native read failed");
        assert!(cli.sessions.borrow().is_empty());
    }
}

#[test]
fn unverified_version_blocks_definition_editing_independently_of_enablement() {
    let (_directory, home) = fixture();
    let mut cli = native(&home, json!([hook(&home)]), true);
    cli.version = "codex-cli 0.999.0".into();

    let state = super::super::HooksState::default();
    let scan = serde_json::to_value(state.scan_with(Ok(home), &cli).unwrap()).unwrap();

    assert_eq!(scan["status"], "Ready");
    assert!(scan["snapshotId"].is_string());
    assert!(scan["hooks"][0]["readOnlyReason"].is_null());
    let definitions = &scan["definitions"];
    assert!(definitions["snapshotId"].is_null());
    assert!(definitions["readOnlyReason"]
        .as_str()
        .unwrap()
        .contains("尚未验证"));
    assert_eq!(definitions["entries"][0]["trustStatus"], "trusted");
    assert!(definitions["entries"][0]["readOnlyReason"].is_string());
}

#[test]
fn mismatched_native_definitions_never_authorize_file_editing() {
    for mismatch in ["content", "path", "missing", "extra"] {
        let (_directory, home) = fixture();
        let mut entry = hook(&home);
        match mismatch {
            "content" => entry["command"] = json!("external command"),
            "path" => entry["sourcePath"] = json!(home.join("different.json")),
            _ => (),
        }
        let hooks = match mismatch {
            "missing" => json!([]),
            "extra" => {
                let mut extra = entry.clone();
                extra["key"] = json!("unrecognized-user-definition");
                json!([entry, extra])
            }
            _ => json!([entry]),
        };
        let cli = native(&home, hooks, true);

        let observed = observe_with(&home, &cli);

        assert!(observed.inventory.is_ok());
        assert!(observed.definition_observation.is_none(), "{mismatch}");
        let definitions = serde_json::to_value(observed.definitions).unwrap();
        assert!(definitions["readOnlyReason"].is_string(), "{mismatch}");
        assert_eq!(
            definitions["entries"][0]["handler"]["command"],
            "echo fixture"
        );
        assert!(definitions["entries"][0]["readOnlyReason"].is_string());
    }
}

#[test]
fn inventory_preserves_distinct_hooks_and_diagnostics_and_filters_project_sources() {
    let (_directory, home) = fixture();
    let first = hook(&home);
    let mut plugin = hook(&home);
    plugin["key"] = json!("plugin-hook");
    plugin["source"] = json!("plugin");
    plugin["pluginId"] = json!("fixture@market");
    plugin["enabled"] = json!(false);
    let mut project = hook(&home);
    project["key"] = json!("project-hook");
    project["source"] = json!("project");
    let mut cli = native(&home, json!([]), true);
    cli.reply(
        "hooks/list",
        Ok(json!({"data":[{
            "cwd":"/", "hooks":[first, plugin, project], "warnings":["two formats"],
            "errors":[{"path":"/bad/hooks.json","message":"invalid"}]
        }]})),
    );

    let observed = observe_with(&home, &cli);

    let inventory = observed.inventory.unwrap();
    assert_eq!(inventory.hooks.len(), 2);
    assert_eq!(inventory.hooks[0].source, "user");
    assert_eq!(inventory.hooks[1].source, "plugin");
    assert!(!inventory.hooks[1].enabled);
    assert_eq!(inventory.warnings, vec!["two formats"]);
    assert_eq!(inventory.errors, vec!["/bad/hooks.json：invalid"]);
    assert!(observed.definition_observation.is_none());
}

#[test]
fn incompatible_inventory_responses_keep_file_definitions_read_only() {
    let (_directory, home) = fixture();
    for response in [
        json!({}),
        json!({"data":[]}),
        json!({"data":[{"cwd":"/project","hooks":[],"warnings":[],"errors":[]}]}),
        inventory_response(json!([hook(&home), hook(&home)])),
    ] {
        let mut cli = native(&home, json!([]), true);
        cli.reply("hooks/list", Ok(response));

        let state = super::super::HooksState::default();
        let scan = serde_json::to_value(state.scan_with(Ok(home.clone()), &cli).unwrap()).unwrap();

        assert_eq!(scan["status"], "Incompatible");
        assert!(scan["snapshotId"].is_null());
        assert!(scan["definitions"]["snapshotId"].is_null());
        assert_eq!(
            scan["definitions"]["entries"][0]["handler"]["command"],
            "echo fixture"
        );
        assert!(scan["definitions"]["readOnlyReason"].is_string());
    }
}

#[test]
fn source_read_failure_preserves_other_definitions_and_takes_error_precedence() {
    for native_failed in [false, true] {
        let (_directory, home) = fixture();
        std::fs::write(home.join("hooks.json"), "{broken JSON").unwrap();
        std::fs::write(
            home.join("config.toml"),
            "[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = 'command'\ncommand = 'echo toml'\n",
        )
        .unwrap();
        let mut entry = hook(&home);
        entry["key"] = json!(format!("{}:stop:0:0", home.join("config.toml").display()));
        entry["sourcePath"] = json!(home.join("config.toml"));
        entry["command"] = json!("echo toml");
        let cli = if native_failed {
            MockNative::from_inventory(
                &home,
                Err(RpcError {
                    kind: codex_cli::RpcErrorKind::Failed,
                    message: "native read failed".into(),
                }),
            )
        } else {
            native(&home, json!([entry]), true)
        };

        let observed = observe_with(&home, &cli);

        assert!(observed.definition_observation.is_none());
        let definitions = serde_json::to_value(observed.definitions).unwrap();
        assert!(definitions["sources"][0]["error"]
            .as_str()
            .unwrap()
            .contains("hooks.json 无法解析"));
        assert!(definitions["sources"][1]["error"].is_null());
        assert_eq!(
            definitions["readOnlyReason"],
            definitions["sources"][0]["error"]
        );
        assert_eq!(definitions["entries"][0]["handler"]["command"], "echo toml");
        assert!(definitions["entries"][0]["readOnlyReason"].is_string());
    }
}

#[test]
fn failed_disabled_feature_inspection_keeps_definitions_read_only() {
    for reply in [
        Err(RpcError {
            kind: codex_cli::RpcErrorKind::Failed,
            message: "inspection failed".into(),
        }),
        Ok(json!({})),
        Ok(
            json!({"data":[{"cwd":"/","hooks":[],"warnings":[],"errors":[{"path":"/fixture/hooks.json","message":"invalid"}]}]}),
        ),
    ] {
        let (_directory, home) = fixture();
        let mut cli = native(&home, json!([]), false);
        cli.sessions.get_mut().push_back((
            true,
            Ok(MockServer {
                replies: VecDeque::from([("hooks/list", reply)]),
            }),
        ));

        let state = super::super::HooksState::default();
        let scan = serde_json::to_value(state.scan_with(Ok(home), &cli).unwrap()).unwrap();

        assert_eq!(scan["status"], "Ready");
        assert_eq!(scan["featureEnabled"], false);
        assert_eq!(scan["hooks"], json!([]));
        assert!(scan["definitions"]["snapshotId"].is_null());
        assert!(scan["definitions"]["readOnlyReason"].is_string());
        assert_eq!(
            scan["definitions"]["entries"][0]["handler"]["command"],
            "echo fixture"
        );
        assert_eq!(scan["definitions"]["entries"][0]["trustStatus"], "unknown");
    }
}

#[test]
fn unverifiable_configuration_or_feature_metadata_disallows_both_writes() {
    for (method, response) in [
        ("config/read", json!({"layers":[],"origins":{},"config":{}})),
        (
            "experimentalFeature/list",
            json!({"data":[{"name":"hooks","enabled":"unknown"}]}),
        ),
    ] {
        let (_directory, home) = fixture();
        let mut cli = native(&home, json!([hook(&home)]), true);
        cli.reply(method, Ok(response));

        let state = super::super::HooksState::default();
        let scan = serde_json::to_value(state.scan_with(Ok(home), &cli).unwrap()).unwrap();

        assert_eq!(scan["status"], "Ready");
        assert!(scan["snapshotId"].is_null());
        assert!(scan["hooks"][0]["readOnlyReason"].is_string());
        assert!(scan["definitions"]["snapshotId"].is_null());
        assert_eq!(
            scan["definitions"]["entries"][0]["handler"]["command"],
            "echo fixture"
        );
        assert!(scan["definitions"]["readOnlyReason"].is_string());
    }
}

#[test]
fn freshness_checks_reread_native_trust_and_configuration() {
    for change in ["unchanged", "trust", "config"] {
        let (_directory, home) = fixture();
        let observed = observe_with(&home, &native(&home, json!([hook(&home)]), true));
        let observed = observed.definition_observation.unwrap();
        let mut next_hook = hook(&home);
        if change == "trust" {
            next_hook["trustStatus"] = json!("modified");
        }
        let mut cli = native(&home, json!([next_hook]), true);
        if change == "config" {
            cli.reply("config/read", Ok(json!({
                "layers":[{"name":{"type":"user","file":home.join("config.toml")},"version":"version-2"}],
                "origins":{}, "config":{}
            })));
        }

        let result = observed.fresh_with(&cli);

        if change == "unchanged" {
            assert!(result.is_ok());
        } else {
            assert_eq!(
                result.unwrap_err(),
                "Codex 定义、信任或配置状态已变化，请刷新并重新确认。"
            );
        }
        assert!(cli.sessions.borrow().is_empty());
    }
}
