use super::scan_docker_with_runner_and_config;
use crate::command::envelope;
use crate::managers::test_support::{fake_failed_run, fake_run};
use crate::types::{CommandFailure, FailureKind, ManagerSnapshot, ManagerStatus};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::fs;
use std::path::PathBuf;

fn scan_fixture(
    context: &str,
    endpoint: &str,
    identities: [&str; 2],
    fail_at: Option<&str>,
) -> ManagerSnapshot {
    let home = tempfile::tempdir().unwrap();
    let config = home.path().join(".docker");
    fs::create_dir(&config).unwrap();
    let original_config = json!({"currentContext": context, "HttpHeaders": {"X-Observer": "original"}, "auths": {"private": "credential"}});
    fs::write(config.join("config.json"), original_config.to_string()).unwrap();
    let exported = json!([{"Endpoints": {"docker": {"Host": endpoint, "SkipTLSVerify": true}}, "tlsFixture": "original-certificate"}]);
    fs::write(config.join("fixture-context.json"), exported.to_string()).unwrap();
    if fail_at == Some("config") {
        fs::write(config.join("config.json"), "invalid config").unwrap();
    }
    let private_config = RefCell::new(None::<PathBuf>);
    let identity_reads = Cell::new(0);
    let resource_reads = Cell::new(0);

    let runner = |program: &str, args: &[&str], timeout| {
        assert_eq!(program, "docker");
        let mut query = args;
        if let ["--config", directory, "context", operation, rest @ ..] = args {
            if fail_at == Some(*operation) {
                return Ok(fake_failed_run(
                    program,
                    args,
                    timeout,
                    "source fixture failure",
                ));
            }
            let output = match *operation {
                "show" => {
                    assert_eq!(PathBuf::from(directory), config);
                    // Changing the default after selection must not affect export.
                    fs::write(config.join("config.json"), json!({"currentContext": "other", "HttpHeaders": {"X-Observer": "changed"}}).to_string()).unwrap();
                    if fail_at == Some("empty-context") {
                        String::new()
                    } else {
                        context.to_string()
                    }
                }
                "export" => {
                    assert_eq!(rest[0], context);
                    assert_eq!(PathBuf::from(directory), config);
                    fs::copy(config.join("fixture-context.json"), rest[1]).unwrap();
                    String::new()
                }
                "import" => {
                    assert_eq!(rest[0], "observation");
                    let directory = PathBuf::from(directory);
                    assert_ne!(directory, config);
                    fs::copy(rest[1], directory.join("frozen.json")).unwrap();
                    private_config.replace(Some(directory));
                    String::new()
                }
                "inspect" => {
                    assert_eq!(rest, ["observation"]);
                    if fail_at == Some("invalid-endpoint") {
                        "[]".into()
                    } else {
                        fs::read_to_string(PathBuf::from(directory).join("frozen.json")).unwrap()
                    }
                }
                _ => panic!("unexpected source command: {args:?}"),
            };
            return Ok(fake_run(program, args, timeout, &output));
        }
        if let ["--config", directory, "--context", "observation", rest @ ..] = args {
            let directory = PathBuf::from(directory);
            assert_eq!(private_config.borrow().as_ref(), Some(&directory));
            assert_eq!(
                serde_json::from_slice::<Value>(&fs::read(directory.join("frozen.json")).unwrap())
                    .unwrap(),
                exported
            );
            assert_eq!(
                serde_json::from_slice::<Value>(&fs::read(directory.join("config.json")).unwrap())
                    .unwrap(),
                json!({"HttpHeaders": {"X-Observer": "original"}})
            );
            query = rest;
        } else if args != ["--version"] {
            assert!(
                fail_at.is_some(),
                "inventory must use the frozen connection: {args:?}"
            );
        }
        let output = match query {
            ["--version"] => "Docker version 29.8.2, build fixture",
            ["info", "--format", "{{json .ID}}"] => {
                let index = identity_reads.get();
                identity_reads.set(index + 1);
                if identities[index] == "timeout" {
                    return Err(CommandFailure {
                        kind: FailureKind::Timeout,
                        message: format!(
                            "{} exceeded the configured timeout",
                            envelope(program, args, 10_000).preview
                        ),
                        command: Some(envelope(program, args, 10_000)),
                        stdout: String::new(),
                        stderr: String::new(),
                    });
                }
                identities[index]
            }
            ["image", "ls", "--all", "--format", "{{json .}}", "--digests"] => {
                resource_reads.set(resource_reads.get() + 1);
                // Editing the original context after a query must not change later queries.
                fs::write(
                    config.join("fixture-context.json"),
                    json!({"Host": "tcp://other:2375", "tlsFixture": "changed-certificate"})
                        .to_string(),
                )
                .unwrap();
                r#"{"Repository":"visible","Tag":"latest","ID":"sha256:1","Size":"1MB"}"#
            }
            ["container", "ls", "--all", "--format", "{{json .}}"]
            | ["volume", "ls", "--format", "{{json .}}"]
            | ["system", "df", "--format", "{{json .}}"] => {
                resource_reads.set(resource_reads.get() + 1);
                if fail_at == Some("container-timeout") && query[0] == "container" {
                    return Err(CommandFailure {
                        kind: FailureKind::Timeout,
                        message: format!("{} timed out", envelope(program, args, 15_000).preview),
                        command: Some(envelope(program, args, 15_000)),
                        stdout: String::new(),
                        stderr: String::new(),
                    });
                }
                ""
            }
            _ => panic!("unexpected query: {args:?}"),
        };
        Ok(fake_run(program, args, timeout, output))
    };

    let snapshot = scan_docker_with_runner_and_config(&runner, Some(home.path()), Some(&config));
    assert_eq!(resource_reads.get(), 4);
    assert_eq!(snapshot.packages.len(), 1);
    assert_eq!(snapshot.packages[0].name, "visible:latest");
    if let Some(path) = private_config.into_inner() {
        assert!(snapshot.failures.iter().all(|failure| !failure
            .message
            .contains(path.parent().unwrap().to_str().unwrap())));
        assert!(
            !path.exists(),
            "temporary connection and certificates must be removed"
        );
    }
    assert!(snapshot.commands.iter().all(|command| !command
        .args
        .iter()
        .any(|arg| arg == "import" || arg == "export" || arg == "--config")));
    snapshot
}

#[test]
fn scan_binds_every_query_to_the_exported_connection_despite_external_context_changes() {
    for (context, endpoint) in [
        ("default", "tcp://127.0.0.1:2376"),
        ("desktop", "unix:///var/run/docker.sock"),
        ("remote", "ssh://user@example.test"),
    ] {
        let snapshot = scan_fixture(context, endpoint, [r#""engine-a""#, r#""engine-a""#], None);
        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(
            snapshot.scope_key,
            Some(json!(["docker-observation-source-v2", endpoint, "engine-a"]).to_string())
        );
    }
}

#[test]
fn scan_keeps_inventory_but_no_source_when_either_daemon_identity_is_unreliable() {
    for identities in [
        [r#""engine-a""#, r#""engine-b""#],
        ["timeout", r#""engine-a""#],
        [r#""engine-a""#, "timeout"],
        ["null", r#""engine-a""#],
        [r#""engine-a""#, r#""""#],
        [r#""engine-a""#, "invalid json"],
    ] {
        let snapshot = scan_fixture("desktop", "unix:///var/run/docker.sock", identities, None);
        assert_eq!(snapshot.status, ManagerStatus::Partial);
        assert!(snapshot.scope_key.is_none());
        assert!(!snapshot.failures.is_empty());
    }
}

#[test]
fn scan_keeps_inventory_but_never_assigns_a_source_if_connection_freezing_fails() {
    for step in [
        "show",
        "export",
        "import",
        "inspect",
        "config",
        "empty-context",
        "invalid-endpoint",
    ] {
        let snapshot = scan_fixture(
            "default",
            "tcp://127.0.0.1:2375",
            ["unused", "unused"],
            Some(step),
        );
        assert_eq!(snapshot.status, ManagerStatus::Partial);
        assert!(snapshot.scope_key.is_none());
    }
}

#[test]
fn scan_retains_known_source_and_read_inventory_without_archiving_temporary_paths_on_query_failure()
{
    let snapshot = scan_fixture(
        "desktop",
        "unix:///var/run/docker.sock",
        [r#""engine-a""#, r#""engine-a""#],
        Some("container-timeout"),
    );
    assert_eq!(snapshot.status, ManagerStatus::Partial);
    assert!(snapshot.scope_key.is_some());
}

#[test]
#[ignore = "requires Docker CLI; uses only temporary contexts and mocked daemon queries"]
fn native_cli_freezes_default_tls_and_named_ssh_connections() {
    use crate::types::CommandRun;
    use std::process::Command;
    use std::time::Duration;

    for named in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let config = home.path().join(".docker");
        fs::create_dir(&config).unwrap();
        fs::write(
            config.join("config.json"),
            r#"{"HttpHeaders":{"X-Observer":"original"}}"#,
        )
        .unwrap();
        // Export/import reads opaque certificate bytes; no TLS handshake occurs.
        for file in ["ca.pem", "cert.pem", "key.pem"] {
            fs::write(config.join(file), format!("original-{file}")).unwrap();
        }
        let endpoint = if named {
            "ssh://user@example.test"
        } else {
            "tcp://127.0.0.1:2376"
        };
        let native = |args: &[&str], timeout: Duration| {
            let mut command = Command::new("docker");
            for (name, _) in std::env::vars_os()
                .filter(|(name, _)| name.to_string_lossy().starts_with("DOCKER_"))
            {
                command.env_remove(name);
            }
            command.env("DOCKER_CONFIG", &config);
            if named {
                command.env("DOCKER_CONTEXT", "original");
            } else {
                command
                    .env("DOCKER_HOST", "tcp://127.0.0.1:2376")
                    .env("DOCKER_TLS_VERIFY", "1")
                    .env("DOCKER_CERT_PATH", &config);
            }
            let output = command.args(args).output().expect("run Docker CLI");
            Ok::<_, CommandFailure>(CommandRun {
                envelope: envelope("docker", args, timeout.as_millis() as u64),
                stdout: String::from_utf8(output.stdout).unwrap(),
                stderr: String::from_utf8(output.stderr).unwrap(),
                exit_code: output.status.code(),
                duration_ms: 0,
            })
        };
        if named {
            let created = native(
                &[
                    "context",
                    "create",
                    "original",
                    "--docker",
                    &format!("host={endpoint}"),
                ],
                Duration::from_secs(10),
            )
            .unwrap();
            assert_eq!(created.exit_code, Some(0), "{}", created.stderr);
        }
        let queries = Cell::new(0);
        let frozen_path = RefCell::new(None::<PathBuf>);
        let runner = |program: &str, args: &[&str], timeout| {
            if let ["--config", directory, "--context", "observation", query @ ..] = args {
                let directory = PathBuf::from(directory);
                frozen_path.replace(Some(directory.clone()));
                let inspected = native(
                    &[
                        "--config",
                        directory.to_str().unwrap(),
                        "context",
                        "inspect",
                        "observation",
                    ],
                    timeout,
                )
                .unwrap();
                assert_eq!(inspected.exit_code, Some(0), "{}", inspected.stderr);
                let value: Value = serde_json::from_str(&inspected.stdout).unwrap();
                assert_eq!(value[0]["Endpoints"]["docker"]["Host"], endpoint);
                assert_eq!(value[0]["Endpoints"]["docker"]["SkipTLSVerify"], false);
                if !named {
                    let tls = PathBuf::from(value[0]["Storage"]["TLSPath"].as_str().unwrap())
                        .join("docker");
                    for file in ["ca.pem", "cert.pem", "key.pem"] {
                        assert_eq!(
                            fs::read_to_string(tls.join(file)).unwrap(),
                            format!("original-{file}")
                        );
                        fs::write(config.join(file), "externally changed").unwrap();
                    }
                }
                if queries.get() == 0 && named {
                    let changed = native(
                        &[
                            "context",
                            "update",
                            "original",
                            "--docker",
                            "host=ssh://other@example.test",
                        ],
                        timeout,
                    )
                    .unwrap();
                    assert_eq!(changed.exit_code, Some(0), "{}", changed.stderr);
                }
                queries.set(queries.get() + 1);
                return Ok(fake_run(
                    program,
                    args,
                    timeout,
                    if query[0] == "info" {
                        r#""engine-a""#
                    } else {
                        ""
                    },
                ));
            }
            native(args, timeout)
        };
        let snapshot =
            scan_docker_with_runner_and_config(&runner, Some(home.path()), Some(&config));
        assert_eq!(
            snapshot.status,
            ManagerStatus::Ready,
            "{:?}",
            snapshot.failures
        );
        assert_eq!(
            snapshot.scope_key,
            Some(json!(["docker-observation-source-v2", endpoint, "engine-a"]).to_string())
        );
        assert_eq!(queries.get(), 6);
        assert!(!frozen_path.into_inner().unwrap().exists());
    }
}
