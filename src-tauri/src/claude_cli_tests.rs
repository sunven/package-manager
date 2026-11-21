use super::*;

#[test]
fn one_shot_preserves_context_arguments_and_nonzero_exit() {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().canonicalize().unwrap();
    let argument = "literal; $(exit 99)";
    let output = run_program(
        &home,
        "/bin/sh",
        &[
            "-c",
            "printf '%s\\n' \"$PWD\" \"$CLAUDE_CONFIG_DIR\" \"$GIT_TERMINAL_PROMPT\" \"$GCM_INTERACTIVE\" \"$SSH_ASKPASS_REQUIRE\" \"$1\"; read ignored || printf closed; printf diagnostic >&2; exit 7",
            "probe",
            argument,
        ],
        Duration::from_secs(2),
    )
    .unwrap();
    assert!(!output.success);
    assert_eq!(
        output.stdout,
        format!("/\n{}\n0\nnever\nnever\n{argument}\nclosed", home.display()),
    );
    assert_eq!(output.stderr, "diagnostic");
}

#[test]
fn one_shot_caps_each_stream_before_decoding() {
    let directory = tempfile::tempdir().unwrap();
    let output = run_program(
        directory.path(),
        "/bin/sh",
        &[
            "-c",
            "head -c 9437184 /dev/zero; printf '\\377'; head -c 9437184 /dev/zero >&2; printf '\\377' >&2",
        ],
        Duration::from_secs(2),
    )
    .unwrap();
    assert!(output.success);
    assert_eq!(output.stdout.len(), 8 * 1024 * 1024);
    assert_eq!(output.stderr.len(), 8 * 1024 * 1024);
}

#[test]
fn one_shot_rejects_invalid_utf8_including_a_character_cut_by_the_cap() {
    let directory = tempfile::tempdir().unwrap();
    for script in [
        "printf '\\377'",
        "printf '\\377' >&2",
        "head -c 8388607 /dev/zero; printf '\\303\\251'",
    ] {
        let error = run_program(
            directory.path(),
            "/bin/sh",
            &["-c", script],
            Duration::from_secs(2),
        )
        .err()
        .unwrap();
        assert!(error.contains("UTF-8"), "{error}");
    }
}

#[test]
fn one_shot_normal_exits_stop_descendants() {
    let directory = tempfile::tempdir().unwrap();
    for exit_code in ["0", "7"] {
        let marker = directory.path().join(exit_code);
        let output = run_program(
            directory.path(),
            "/bin/sh",
            &[
                "-c",
                "printf started; (sleep 1; touch \"$1\") & exit \"$2\"",
                "probe",
                marker.to_str().unwrap(),
                exit_code,
            ],
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(output.success, exit_code == "0");
        assert_eq!(output.stdout, "started");
    }
    std::thread::sleep(Duration::from_millis(1200));
    assert!(!directory.path().join("0").exists());
    assert!(!directory.path().join("7").exists());
}

#[test]
fn one_shot_missing_and_timeout_keep_their_domain_messages() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("missing-cli");
    let error = run_program(
        directory.path(),
        missing.to_str().unwrap(),
        &[],
        Duration::from_secs(2),
    )
    .err()
    .unwrap();
    assert_eq!(error, "未找到 Claude CLI，请确认应用 PATH 中有 claude。");
    let error = run_program(
        directory.path(),
        "/bin/sh",
        &["-c", "sleep 2"],
        Duration::from_millis(100),
    )
    .err()
    .unwrap();
    assert_eq!(
        error,
        "Claude 操作超时，结果尚未确认。请重新读取清单核对；需要认证时先在 Claude CLI 完成。",
    );
}
