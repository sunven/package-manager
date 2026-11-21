use super::*;

#[test]
fn one_shot_preserves_context_arguments_nonzero_exit_and_lossy_output() {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().canonicalize().unwrap();
    let argument = "literal; $(exit 99)";
    let output = run_program(
        &home,
        "/bin/sh",
        &[
            "-c",
            "printf '%s\\n' \"$PWD\" \"$CODEX_HOME\" \"$GIT_TERMINAL_PROMPT\" \"$GCM_INTERACTIVE\" \"$SSH_ASKPASS_REQUIRE\" \"$1\"; read ignored || printf closed; printf '\\377' >&2; exit 7",
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
    assert_eq!(output.stderr, "\u{fffd}");
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
fn one_shot_timeout_keeps_its_domain_message() {
    let directory = tempfile::tempdir().unwrap();
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
        "Codex 操作超时。请检查网络和本机 Git 认证，再重新读取清单核对结果。",
    );
}
