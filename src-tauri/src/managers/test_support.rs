use crate::command::envelope;
use crate::types::CommandRun;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

pub(super) fn fake_run(
    program: &str,
    args: &[&str],
    timeout: Duration,
    stdout: &str,
) -> CommandRun {
    CommandRun {
        envelope: envelope(program, args, timeout.as_millis() as u64),
        stdout: stdout.to_string(),
        stderr: String::new(),
        exit_code: Some(0),
        duration_ms: 1,
    }
}

pub(super) fn fake_failed_run(
    program: &str,
    args: &[&str],
    timeout: Duration,
    stderr: &str,
) -> CommandRun {
    CommandRun {
        envelope: envelope(program, args, timeout.as_millis() as u64),
        stdout: String::new(),
        stderr: stderr.to_string(),
        exit_code: Some(1),
        duration_ms: 1,
    }
}

pub(super) fn temp_dir(label: &str) -> TempDirGuard {
    let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "package-manager-control-center-{label}-{stamp}-{suffix}"
    ));
    fs::create_dir_all(&path).expect("create temp dir");
    TempDirGuard(path)
}

pub(super) fn write_file(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    let mut file = fs::File::create(path).expect("create file");
    file.write_all(contents).expect("write file");
}

pub(super) struct TempDirGuard(PathBuf);

impl TempDirGuard {
    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
