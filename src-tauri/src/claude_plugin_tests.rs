use super::*;
use crate::claude_cli::Output;
use serde_json::json;
use std::cell::RefCell;
use std::rc::Rc;

struct Fixture {
    directory: tempfile::TempDir,
    markets: Value,
    inventory: Value,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path();
        let root = home.join("market");
        std::fs::create_dir_all(root.join(".claude-plugin")).unwrap();
        std::fs::create_dir_all(home.join("plugins")).unwrap();
        let source = json!({"source":"directory","path":root});
        std::fs::write(home.join("settings.json"), json!({"extraKnownMarketplaces":{"test-market":{"source":source}},"enabledPlugins":{"demo@test-market":false},"unrelated":{"keep":true}}).to_string()).unwrap();
        std::fs::write(
            home.join("plugins/known_marketplaces.json"),
            json!({"test-market":{"source":source,"installLocation":root}}).to_string(),
        )
        .unwrap();
        std::fs::write(root.join(".claude-plugin/marketplace.json"), json!({"name":"test-market","plugins":[{"name":"demo","source":"./demo","description":"Fixture plugin"}]}).to_string()).unwrap();
        Self {
            markets: json!([{"name":"test-market","source":"directory","path":root,"installLocation":root}]),
            inventory: json!({"installed":[{"id":"demo@test-market","scope":"user","enabled":false,"version":"1.0","installPath":home.join("cache/demo")}],"available":[]}),
            directory,
        }
    }
    fn runner(&self, calls: Rc<RefCell<Vec<Vec<String>>>>) -> Box<Runner> {
        let markets = self.markets.clone();
        let inventory = self.inventory.clone();
        Box::new(move |_, args, _| {
            calls
                .borrow_mut()
                .push(args.iter().map(|v| (*v).into()).collect());
            let stdout = if args == ["--version"] {
                "2.1.300 (Claude Code)".into()
            } else if args == ["plugin", "marketplace", "list", "--json"] {
                markets.to_string()
            } else if args == ["plugin", "list", "--json", "--available"] {
                inventory.to_string()
            } else {
                json!({"outcome":"ok"}).to_string()
            };
            Ok(Output {
                success: true,
                stdout,
                stderr: String::new(),
            })
        })
    }
    fn home(&self) -> PathBuf {
        self.directory.path().into()
    }
}

fn request(id: String, operation: Operation, target: &str) -> ChangeRequest {
    ChangeRequest {
        snapshot_id: id,
        operation,
        target: Some(target.into()),
        source: None,
        source_kind: None,
        ref_name: None,
        sparse_paths: vec![],
    }
}

#[test]
fn inventory_uses_cli_install_facts_and_keeps_user_choice_distinct() {
    let mut f = Fixture::new();
    f.inventory["installed"][0]["enabled"] = json!(true);
    let scan = ExtensionsState::default()
        .scan_with(f.home(), &*f.runner(Rc::default()))
        .unwrap();
    assert_eq!(scan.status, "Ready");
    assert!(scan.plugins[0].installed);
    assert_eq!(scan.plugins[0].enabled, Some(true));
    assert_eq!(scan.plugins[0].user_enabled, Some(false));
    assert!(scan.marketplaces[0].read_only_reason.is_none());
    assert!(scan.plugins[0]
        .details
        .messages
        .iter()
        .any(|m| m.contains("不可访问")));
}

#[test]
fn cross_scope_market_removal_is_refused_before_any_mutation() {
    let mut f = Fixture::new();
    let mut project = f.inventory["installed"][0].clone();
    project["scope"] = json!("project");
    project["projectPath"] = json!("/fixture/project");
    f.inventory["installed"]
        .as_array_mut()
        .unwrap()
        .push(project);
    let calls = Rc::new(RefCell::new(vec![]));
    let runner = f.runner(calls.clone());
    let state = ExtensionsState::default();
    let scan = state.scan_with(f.home(), &*runner).unwrap();
    assert!(scan.marketplaces[0].remove_blocked_reason.is_some());
    assert!(state
        .change_with(
            request(
                scan.snapshot_id.unwrap(),
                Operation::RemoveMarket,
                "test-market"
            ),
            f.home(),
            &*runner
        )
        .is_err());
    assert!(calls
        .borrow()
        .iter()
        .all(|args| !args.iter().any(|a| a == "remove")));
}

#[test]
fn external_config_edit_invalidates_confirmation_and_is_preserved() {
    let f = Fixture::new();
    let calls = Rc::new(RefCell::new(vec![]));
    let runner = f.runner(calls.clone());
    let state = ExtensionsState::default();
    let scan = state.scan_with(f.home(), &*runner).unwrap();
    let path = f.home().join("settings.json");
    let mut settings: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    settings["external"] = json!("keep");
    std::fs::write(&path, settings.to_string()).unwrap();
    let result = state
        .change_with(
            request(
                scan.snapshot_id.unwrap(),
                Operation::Enable,
                "demo@test-market",
            ),
            f.home(),
            &*runner,
        )
        .unwrap();
    assert_eq!(result.status, "Conflict");
    assert!(!result.executed);
    assert!(calls
        .borrow()
        .iter()
        .all(|args| !args.iter().any(|a| a == "enable")));
    assert_eq!(Document::read(&path).unwrap().value["external"], "keep");
}

#[test]
fn plugin_enable_uses_explicit_user_scope_and_never_replays_snapshot() {
    let f = Fixture::new();
    let calls = Rc::new(RefCell::new(vec![]));
    let runner = f.runner(calls.clone());
    let state = ExtensionsState::default();
    let scan = state.scan_with(f.home(), &*runner).unwrap();
    let id = scan.snapshot_id.unwrap();
    assert_eq!(
        state
            .change_with(
                request(id.clone(), Operation::Enable, "demo@test-market"),
                f.home(),
                &*runner
            )
            .unwrap()
            .status,
        "Succeeded"
    );
    assert_eq!(
        calls.borrow().last().unwrap(),
        &[
            "plugin",
            "enable",
            "demo@test-market",
            "--scope",
            "user",
            "--json"
        ]
    );
    assert!(state
        .change_with(
            request(id, Operation::Enable, "demo@test-market"),
            f.home(),
            &*runner
        )
        .is_err());
}

#[test]
fn native_market_update_has_no_scope_or_plugin_update_arguments() {
    let f = Fixture::new();
    let calls = Rc::new(RefCell::new(vec![]));
    let runner = f.runner(calls.clone());
    let state = ExtensionsState::default();
    let scan = state.scan_with(f.home(), &*runner).unwrap();
    state
        .change_with(
            request(
                scan.snapshot_id.unwrap(),
                Operation::UpdateMarket,
                "test-market",
            ),
            f.home(),
            &*runner,
        )
        .unwrap();
    assert_eq!(
        calls.borrow().last().unwrap(),
        &["plugin", "marketplace", "update", "test-market", "--json"]
    );
}

#[test]
fn source_mismatch_makes_market_and_plugins_read_only() {
    let mut f = Fixture::new();
    f.markets[0]["path"] = json!("/different/source");
    let scan = ExtensionsState::default()
        .scan_with(f.home(), &*f.runner(Rc::default()))
        .unwrap();
    assert!(scan.marketplaces[0].read_only_reason.is_some());
    assert!(scan.plugins[0].read_only_reason.is_some());
}

#[test]
fn incomplete_install_scopes_fail_scan_instead_of_appearing_empty() {
    let mut f = Fixture::new();
    f.inventory["installed"][0]
        .as_object_mut()
        .unwrap()
        .remove("scope");
    let scan = ExtensionsState::default()
        .scan_with(f.home(), &*f.runner(Rc::default()))
        .unwrap();
    assert_eq!(scan.status, "Failed");
    assert!(scan.snapshot_id.is_none());
}

#[test]
fn incomplete_installed_version_fails_scan_instead_of_showing_uninstalled() {
    let mut f = Fixture::new();
    f.inventory["installed"][0]
        .as_object_mut()
        .unwrap()
        .remove("version");
    let scan = ExtensionsState::default()
        .scan_with(f.home(), &*f.runner(Rc::default()))
        .unwrap();
    assert_eq!(scan.status, "Failed");
    assert!(scan.snapshot_id.is_none());
}

#[test]
fn cli_missing_and_unverified_version_are_not_writable() {
    let f = Fixture::new();
    let scan = ExtensionsState::default()
        .scan_with(f.home(), &|_, _, _| Err("未找到 Claude CLI".into()))
        .unwrap();
    assert_eq!(scan.status, "MissingCli");
    assert!(claude_cli::write_blocked("2.1.301").is_some());
    assert!(claude_cli::write_blocked("2.1.300").is_none());
}

#[test]
fn json_results_allow_progress_but_not_empty_or_non_json_success() {
    let output = |stdout: &str| Output {
        success: true,
        stdout: stdout.into(),
        stderr: String::new(),
    };
    assert_eq!(
        claude_cli::json_output(&output("progress\n{\"outcome\":\"ok\"}\n")).unwrap()["outcome"],
        "ok"
    );
    assert!(claude_cli::json_output(&output("Success!")).is_err());
    assert!(claude_cli::json_output(&output("")).is_err());
}

#[test]
fn add_uses_structured_ref_sparse_and_rejects_argument_injection() {
    let f = Fixture::new();
    let snapshot = load(f.home(), &*f.runner(Rc::default())).unwrap();
    let mut req = request(String::new(), Operation::AddMarket, "");
    req.source_kind = Some("git".into());
    req.source = Some("org/repo".into());
    req.ref_name = Some("main".into());
    req.sparse_paths = vec![".claude-plugin".into(), "plugins".into()];
    assert_eq!(
        arguments(&req, &snapshot).unwrap(),
        [
            "plugin",
            "marketplace",
            "add",
            "org/repo#main",
            "--scope",
            "user",
            "--json",
            "--sparse",
            ".claude-plugin",
            "plugins"
        ]
    );
    req.source = Some("--claudeai".into());
    assert!(arguments(&req, &snapshot).is_err());
    req.source = Some("org/repo@v1".into());
    assert!(arguments(&req, &snapshot).is_err());
    req.source = Some("org/repo#v1".into());
    assert!(arguments(&req, &snapshot).is_err());
    req.source = Some("git@github.com:org/repo.git".into());
    assert!(arguments(&req, &snapshot).is_ok());
    req.source = Some("org/repo".into());
    req.sparse_paths = vec!["../outside".into()];
    assert!(arguments(&req, &snapshot).is_err());
}

#[test]
fn plugin_details_merge_default_and_declared_hooks_without_running_anything() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".claude-plugin")).unwrap();
    std::fs::create_dir_all(root.join("hooks")).unwrap();
    std::fs::write(
        root.join("hooks/hooks.json"),
        json!({"hooks":{"Stop":[{"hooks":[{"type":"command","command":"never-run"}]}]}})
            .to_string(),
    )
    .unwrap();
    std::fs::write(root.join(".claude-plugin/plugin.json"), json!({"name":"fixture","hooks":[{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"http","url":"http://never-call.invalid"}]}]},"extra.json"]}).to_string()).unwrap();
    std::fs::write(
        root.join("extra.json"),
        json!({"hooks":{"SessionStart":[]}}).to_string(),
    )
    .unwrap();
    let (details, hooks) = claude_plugin_details::read(root, "installed");
    assert_eq!(hooks.len(), 3);
    assert_eq!(details.hooks, ["Stop", "PreToolUse", "SessionStart"]);
    assert!(local_path(root, "../outside.json").is_err());
}

#[test]
#[ignore = "Run only in the documented OS sandbox with a temporary Claude config"]
fn native_user_lifecycle() {
    assert_eq!(
        std::env::var("PM_CLAUDE_NATIVE_SANDBOX").as_deref(),
        Ok("1")
    );
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("config");
    let market = dir.path().join("market");
    std::fs::create_dir_all(market.join(".claude-plugin")).unwrap();
    std::fs::create_dir_all(market.join("demo/.claude-plugin")).unwrap();
    std::fs::create_dir_all(market.join("demo/skills/hello")).unwrap();
    std::fs::write(market.join(".claude-plugin/marketplace.json"), json!({"name":"pm-claude-native","owner":{"name":"Fixture"},"plugins":[{"name":"demo","source":"./demo"}]}).to_string()).unwrap();
    std::fs::write(
        market.join("demo/.claude-plugin/plugin.json"),
        json!({"name":"demo","version":"1.0.0","description":"Static verification fixture"})
            .to_string(),
    )
    .unwrap();
    std::fs::write(
        market.join("demo/skills/hello/SKILL.md"),
        "---\nname: hello\ndescription: Static fixture only\n---\nNo execution.\n",
    )
    .unwrap();
    let state = ExtensionsState::default();
    let scan = state.scan_with(home.clone(), &claude_cli::run).unwrap();
    assert_eq!(scan.status, "Ready", "{:?}", scan.message);
    let mut add = request(scan.snapshot_id.unwrap(), Operation::AddMarket, "");
    add.source = Some(market.display().to_string());
    add.source_kind = Some("local".into());
    let result = state
        .change_with(add, home.clone(), &claude_cli::run)
        .unwrap();
    assert_eq!(result.status, "Succeeded", "{}", result.message);
    for operation in [
        Operation::Install,
        Operation::Disable,
        Operation::Enable,
        Operation::Update,
    ] {
        let scan = state.scan_with(home.clone(), &claude_cli::run).unwrap();
        assert_eq!(scan.status, "Ready", "{:?}", scan.message);
        let result = state
            .change_with(
                request(
                    scan.snapshot_id.unwrap(),
                    operation.clone(),
                    "demo@pm-claude-native",
                ),
                home.clone(),
                &claude_cli::run,
            )
            .unwrap();
        assert_eq!(
            result.status, "Succeeded",
            "{operation:?}: {}",
            result.message
        );
        let refreshed = state.scan_with(home.clone(), &claude_cli::run).unwrap();
        assert!(refreshed.plugins[0].installed);
        if operation == Operation::Disable {
            assert_eq!(refreshed.plugins[0].user_enabled, Some(false));
        }
        if operation == Operation::Enable {
            assert_eq!(refreshed.plugins[0].user_enabled, Some(true));
        }
    }
    let scan = state.scan_with(home.clone(), &claude_cli::run).unwrap();
    let result = state
        .change_with(
            request(
                scan.snapshot_id.unwrap(),
                Operation::UpdateMarket,
                "pm-claude-native",
            ),
            home.clone(),
            &claude_cli::run,
        )
        .unwrap();
    assert_eq!(result.status, "Succeeded", "{}", result.message);
    let scan = state.scan_with(home.clone(), &claude_cli::run).unwrap();
    let result = state
        .change_with(
            request(
                scan.snapshot_id.unwrap(),
                Operation::Uninstall,
                "demo@pm-claude-native",
            ),
            home.clone(),
            &claude_cli::run,
        )
        .unwrap();
    assert_eq!(result.status, "Succeeded", "{}", result.message);
    let scan = state.scan_with(home.clone(), &claude_cli::run).unwrap();
    assert!(!scan.plugins[0].installed);
    let result = state
        .change_with(
            request(
                scan.snapshot_id.unwrap(),
                Operation::RemoveMarket,
                "pm-claude-native",
            ),
            home.clone(),
            &claude_cli::run,
        )
        .unwrap();
    assert_eq!(result.status, "Succeeded", "{}", result.message);
    assert!(state
        .scan_with(home, &claude_cli::run)
        .unwrap()
        .marketplaces
        .is_empty());
}
