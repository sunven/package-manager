use crate::command::run_command;
use crate::session_records::{
    age_eligible_counts, move_path_to_trash, now_ms, parse_rfc3339_millis, SessionRecord,
    SessionRemovalItem, SessionRemovalProgress, SessionRemovalReason, SessionRemovalResult,
    SessionRemovalStatus, SessionScanStatus, SessionSourceScan,
};
use crate::types::AgeEligibleCounts;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const INVALID_RECORD: &str = "无法确认这条 Grok Build 记录的身份，请刷新后重试。";
const RUNTIME_UNKNOWN: &str =
    "无法可靠检查 Grok Build 是否已退出，暂不能移除；请退出 Grok Build 后刷新。";
const RUNTIME_RUNNING: &str = "Grok Build 或其会话宿主仍在运行，请退出后刷新再移除。";
const SUMMARY_LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordDetails {
    pub session_id: String,
    pub bytes_complete: bool,
    pub resume_error: Option<String>,
    pub parent_session_id: Option<String>,
    pub related_session_ids: Vec<String>,
    pub relations_complete: bool,
}

pub(crate) fn sessions_dir() -> Result<PathBuf, String> {
    let home = match std::env::var_os("GROK_HOME").filter(|value| !value.is_empty()) {
        Some(home) => PathBuf::from(home),
        None => {
            PathBuf::from(std::env::var_os("HOME").ok_or("无法确定当前用户的主目录")?).join(".grok")
        }
    };
    if !home.is_absolute() {
        return Err("GROK_HOME 必须是绝对路径".into());
    }
    Ok(home.join("sessions"))
}

fn plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
}

fn plain_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn record_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let parts = Path::new(id).components().collect::<Vec<_>>();
    if parts.len() != 2
        || parts
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(INVALID_RECORD.into());
    }
    let group = root.join(parts[0].as_os_str());
    let path = group.join(parts[1].as_os_str());
    if !plain_directory(root) || !plain_directory(&group) || !plain_directory(&path) {
        return Err(INVALID_RECORD.into());
    }
    Ok(path)
}

fn read_metadata(path: &Path) -> Result<Value, String> {
    if !plain_file(path) {
        return Err(INVALID_RECORD.into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|_| INVALID_RECORD.to_string())?;
    if !file
        .metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() <= SUMMARY_LIMIT)
    {
        return Err(INVALID_RECORD.into());
    }
    let mut contents = Vec::new();
    file.take(SUMMARY_LIMIT + 1)
        .read_to_end(&mut contents)
        .map_err(|_| INVALID_RECORD.to_string())?;
    if contents.len() as u64 > SUMMARY_LIMIT {
        return Err(INVALID_RECORD.into());
    }
    serde_json::from_slice(&contents).map_err(|_| INVALID_RECORD.to_string())
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)?
        .as_str()
        .filter(|text| !text.trim().is_empty())
}

fn activity_time(value: &str) -> Option<i64> {
    let year = value.get(..4)?.parse::<u32>().ok()?;
    let month = value.get(5..7)?.parse::<u32>().ok()?;
    let day = value.get(8..10)?.parse::<u32>().ok()?;
    let maximum = match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return None,
    };
    if day == 0 || day > maximum {
        return None;
    }
    parse_rfc3339_millis(value)
}

fn uuid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn resume_error(path: &Path, session_id: &str, cwd: Option<&str>) -> Option<String> {
    if !uuid_id(session_id) {
        return Some("此标识暂无法保证按精确 ID 继续，请在 Grok Build 中打开。".into());
    }
    if !cwd.is_some_and(|cwd| Path::new(cwd).is_absolute() && Path::new(cwd).is_dir()) {
        return Some("原工作目录未记录或已不存在，无法继续会话。".into());
    }
    if !plain_file(&path.join("updates.jsonl")) {
        return Some("会话恢复日志缺失或不是普通文件，无法继续会话。".into());
    }
    None
}

fn measure(path: &Path, budget: &mut usize) -> (u64, bool) {
    if *budget == 0 {
        return (0, false);
    }
    *budget -= 1;
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return (0, false);
    };
    if metadata.file_type().is_symlink() {
        return (0, true);
    }
    if metadata.is_file() {
        return (metadata.len(), true);
    }
    if !metadata.is_dir() {
        return (0, false);
    }
    let Ok(entries) = fs::read_dir(path) else {
        return (0, false);
    };
    let mut bytes = 0u64;
    let mut complete = true;
    for entry in entries {
        let Ok(entry) = entry else {
            complete = false;
            continue;
        };
        let (next, measured) = measure(&entry.path(), budget);
        bytes = bytes.saturating_add(next);
        complete &= measured;
        if *budget == 0 {
            complete = false;
            break;
        }
    }
    (bytes, complete)
}

fn subagent_relations(
    path: &Path,
    parent: &str,
    depth: usize,
    budget: &mut usize,
    ids: &mut Vec<String>,
) -> bool {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return true,
        Err(_) => return false,
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    if depth > 8 || *budget == 0 {
        return false;
    }
    *budget -= 1;
    if metadata.is_file() {
        if path.file_name().is_some_and(|name| name == "meta.json") {
            let Ok(value) = read_metadata(path) else {
                return false;
            };
            if text_field(&value, "parent_session_id") == Some(parent) {
                if let Some(child) = text_field(&value, "child_session_id") {
                    ids.push(child.into());
                }
            }
        }
        return true;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    let mut complete = true;
    for entry in entries {
        let Ok(entry) = entry else {
            complete = false;
            continue;
        };
        complete &= subagent_relations(&entry.path(), parent, depth + 1, budget, ids);
        if *budget == 0 {
            return false;
        }
    }
    complete
}

fn read_record(root: &Path, id: &str, measure_bytes: bool) -> Result<SessionRecord, String> {
    let path = record_path(root, id)?;
    let summary = read_metadata(&path.join("summary.json"))?;
    let info = summary.get("info").ok_or(INVALID_RECORD)?;
    let session_id = text_field(info, "id").ok_or(INVALID_RECORD)?;
    if path.file_name().and_then(|name| name.to_str()) != Some(session_id) {
        return Err(INVALID_RECORD.into());
    }
    let cwd = text_field(info, "cwd").map(str::to_owned);
    let manual = summary.get("title_is_manual").and_then(Value::as_bool) == Some(true);
    let title = if manual {
        text_field(&summary, "session_summary").or_else(|| text_field(&summary, "generated_title"))
    } else {
        text_field(&summary, "generated_title").or_else(|| text_field(&summary, "session_summary"))
    }
    .unwrap_or(session_id)
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");
    let (bytes, bytes_complete) = if measure_bytes {
        measure(&path, &mut 100_000)
    } else {
        (0, true)
    };
    let mut related_session_ids = Vec::new();
    let relations_complete = !measure_bytes
        || subagent_relations(
            &path.join("subagents"),
            session_id,
            0,
            &mut 10_000,
            &mut related_session_ids,
        );
    Ok(SessionRecord {
        id: id.into(),
        title: title.chars().take(200).collect(),
        last_activity_ms: text_field(&summary, "last_active_at").and_then(activity_time),
        working_directory: cwd.clone(),
        bytes,
        in_use: false,
        grok: Some(RecordDetails {
            session_id: session_id.into(),
            bytes_complete,
            resume_error: resume_error(&path, session_id, cwd.as_deref()),
            parent_session_id: text_field(&summary, "parent_session_id").map(str::to_owned),
            related_session_ids,
            relations_complete,
        }),
    })
}

fn empty_scan(root: &Path) -> SessionSourceScan {
    SessionSourceScan {
        directory: root.to_string_lossy().into_owned(),
        status: SessionScanStatus::Ready,
        records: Vec::new(),
        message: None,
        removal_blocked_reason: None,
        age_eligible: AgeEligibleCounts::default(),
    }
}

fn list_records(root: &Path) -> SessionSourceScan {
    let mut scan = empty_scan(root);
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            scan.status = SessionScanStatus::Missing;
            return scan;
        }
        _ if !plain_directory(root) => {
            scan.status = SessionScanStatus::Failed;
            scan.message = Some("Grok Build 会话来源不可读、不是普通目录或是符号链接。".into());
            return scan;
        }
        _ => {}
    }
    let mut unreadable = 0usize;
    let Ok(groups) = fs::read_dir(root) else {
        scan.status = SessionScanStatus::Failed;
        scan.message = Some("无法读取 Grok Build 会话来源。".into());
        return scan;
    };
    for group in groups {
        let Ok(group) = group else {
            unreadable += 1;
            continue;
        };
        let Ok(kind) = group.file_type() else {
            unreadable += 1;
            continue;
        };
        if !kind.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(group.path()) else {
            unreadable += 1;
            continue;
        };
        for entry in entries {
            let Ok(entry) = entry else {
                unreadable += 1;
                continue;
            };
            let Ok(kind) = entry.file_type() else {
                unreadable += 1;
                continue;
            };
            if !kind.is_dir() {
                continue;
            }
            let Some(id) = entry
                .path()
                .strip_prefix(root)
                .ok()
                .and_then(|id| id.to_str())
                .map(str::to_owned)
            else {
                unreadable += 1;
                continue;
            };
            match read_record(root, &id, true) {
                Ok(record) => {
                    if record.grok.as_ref().is_some_and(|details| {
                        !details.bytes_complete || !details.relations_complete
                    }) {
                        unreadable += 1;
                    }
                    scan.records.push(record);
                }
                Err(_) => unreadable += 1,
            }
        }
    }
    let relations = scan
        .records
        .iter()
        .filter_map(|record| {
            let details = record.grok.as_ref()?;
            Some((
                details.session_id.clone(),
                details.parent_session_id.clone(),
            ))
        })
        .collect::<Vec<_>>();
    for record in &mut scan.records {
        let details = record
            .grok
            .as_mut()
            .expect("Grok records carry their metadata");
        details
            .related_session_ids
            .extend(relations.iter().filter_map(|(id, parent)| {
                (parent.as_deref() == Some(&details.session_id)).then(|| id.clone())
            }));
        if let Some(parent) = &details.parent_session_id {
            details.related_session_ids.push(parent.clone());
        }
        details.related_session_ids.sort();
        details.related_session_ids.dedup();
    }
    scan.records.sort_by(|left, right| {
        right
            .last_activity_ms
            .cmp(&left.last_activity_ms)
            .then(left.id.cmp(&right.id))
    });
    if unreadable > 0 {
        scan.status = SessionScanStatus::Partial;
        scan.message = Some(format!("{unreadable} 处记录或目录未能完整读取；无法确认身份的目录不能移除，大小可能仅为已测部分。"));
    }
    scan
}

fn process_snapshot(output: &str) -> Result<HashMap<u32, String>, String> {
    let mut processes = HashMap::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let line = line.trim_start();
        let split = line.find(char::is_whitespace).ok_or(RUNTIME_UNKNOWN)?;
        let pid = line[..split]
            .parse::<u32>()
            .map_err(|_| RUNTIME_UNKNOWN.to_string())?;
        let executable = line[split..].trim();
        if executable.is_empty() {
            return Err(RUNTIME_UNKNOWN.into());
        }
        processes.insert(pid, executable.to_string());
    }
    if processes.is_empty() {
        return Err(RUNTIME_UNKNOWN.into());
    }
    Ok(processes)
}

fn grok_host(executable: &str) -> bool {
    Path::new(executable).components().any(|part| {
        let name = part.as_os_str().to_string_lossy().to_ascii_lowercase();
        name == ".grok"
            || name == "grok"
            || name.starts_with("grok-")
            || name == "grove"
            || name.starts_with("grove-")
            || name == "grok.app"
            || name == "grok build.app"
    })
}

struct ProbeOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

// Drain both pipes while waiting: a developer's process list can exceed pipe capacity.
// These probes run fixed system binaries that do not delegate to long-lived children.
fn probe_command(program: &str, args: &[&str], timeout: Duration) -> Result<ProbeOutput, String> {
    fn drain(reader: impl Read) -> Result<String, String> {
        let mut bytes = Vec::new();
        reader
            .take(SUMMARY_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| RUNTIME_UNKNOWN)?;
        if bytes.len() as u64 > SUMMARY_LIMIT {
            return Err(RUNTIME_UNKNOWN.into());
        }
        String::from_utf8(bytes).map_err(|_| RUNTIME_UNKNOWN.into())
    }
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| RUNTIME_UNKNOWN)?;
    let stdout = child.stdout.take().ok_or(RUNTIME_UNKNOWN)?;
    let stderr = child.stderr.take().ok_or(RUNTIME_UNKNOWN)?;
    let out_reader = thread::spawn(move || drain(stdout));
    let err_reader = thread::spawn(move || drain(stderr));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code()),
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(RUNTIME_UNKNOWN.to_string());
            }
        }
    };
    let stdout = out_reader.join().map_err(|_| RUNTIME_UNKNOWN)?;
    let stderr = err_reader.join().map_err(|_| RUNTIME_UNKNOWN)?;
    Ok(ProbeOutput {
        stdout: stdout?,
        stderr: stderr?,
        exit_code: status?,
    })
}

fn check_runtime(root: &Path) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err(RUNTIME_UNKNOWN.into());
    }
    let run = probe_command(
        "/bin/ps",
        &["-axww", "-o", "pid=,comm="],
        Duration::from_secs(5),
    )
    .map_err(|_| RUNTIME_UNKNOWN.to_string())?;
    if run.exit_code != Some(0) || !run.stderr.trim().is_empty() {
        return Err(RUNTIME_UNKNOWN.into());
    }
    let processes = process_snapshot(&run.stdout)?;
    if processes.values().any(|path| grok_host(path)) {
        return Err(RUNTIME_RUNNING.into());
    }
    let home = root.parent().ok_or(RUNTIME_UNKNOWN)?;
    if home.join("active_sessions.json.corrupt").exists() {
        return Err(RUNTIME_UNKNOWN.into());
    }
    let registry_path = home.join("active_sessions.json");
    match fs::symlink_metadata(&registry_path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(RUNTIME_UNKNOWN.into()),
        Ok(_) => {
            let registry =
                read_metadata(&registry_path).map_err(|_| RUNTIME_UNKNOWN.to_string())?;
            let rows = registry.as_array().ok_or(RUNTIME_UNKNOWN)?;
            for row in rows {
                let pid = row
                    .get("pid")
                    .or_else(|| row.get("process_id"))
                    .and_then(Value::as_u64)
                    .and_then(|pid| u32::try_from(pid).ok())
                    .ok_or(RUNTIME_UNKNOWN)?;
                if processes.contains_key(&pid) {
                    return Err(RUNTIME_RUNNING.into());
                }
            }
        }
    }
    Ok(())
}

fn open_paths(root: &Path) -> Result<HashSet<PathBuf>, String> {
    // lsof reports canonical paths (e.g. /private/var instead of /var on macOS).
    let canonical = fs::canonicalize(root).map_err(|_| RUNTIME_UNKNOWN)?;
    let root_text = canonical.to_str().ok_or(RUNTIME_UNKNOWN)?;
    let run = probe_command(
        "/usr/sbin/lsof",
        &["-nP", "-Fpn0", "+D", root_text],
        Duration::from_secs(10),
    )
    .map_err(|_| "无法检查记录是否被其他进程打开，暂不能移除。".to_string())?;
    if !matches!(run.exit_code, Some(0) | Some(1)) || !run.stderr.trim().is_empty() {
        return Err("无法完整检查记录是否被其他进程打开，暂不能移除。".into());
    }
    parse_open_paths(&run.stdout, run.exit_code, &canonical, root)
        .map_err(|_| "无法解析记录文件占用状态，暂不能移除。".into())
}

fn parse_open_paths(
    output: &str,
    exit_code: Option<i32>,
    canonical: &Path,
    root: &Path,
) -> Result<HashSet<PathBuf>, String> {
    if output.is_empty() {
        return if exit_code == Some(1) {
            Ok(HashSet::new())
        } else {
            Err(RUNTIME_UNKNOWN.into())
        };
    }
    if !output.ends_with('\0') && !output.ends_with("\0\n") {
        return Err(RUNTIME_UNKNOWN.into());
    }
    let mut paths = HashSet::new();
    let mut process_seen = false;
    for field in output
        .split('\0')
        .map(|field| field.trim_start_matches('\n'))
        .filter(|field| !field.is_empty())
    {
        if let Some(pid) = field.strip_prefix('p') {
            if !pid.parse::<u32>().is_ok_and(|pid| pid > 0) {
                return Err(RUNTIME_UNKNOWN.into());
            }
            process_seen = true;
        } else if let Some(name) = field.strip_prefix('n') {
            if !process_seen {
                return Err(RUNTIME_UNKNOWN.into());
            }
            let relative = Path::new(name)
                .strip_prefix(canonical)
                .map_err(|_| RUNTIME_UNKNOWN)?;
            paths.insert(root.join(relative));
        } else if !process_seen || !field.starts_with('f') || field.len() < 2 {
            return Err(RUNTIME_UNKNOWN.into());
        }
    }
    if paths.is_empty() {
        return Err(RUNTIME_UNKNOWN.into());
    }
    Ok(paths)
}

pub(crate) fn scan_default() -> SessionSourceScan {
    let root = match sessions_dir() {
        Ok(root) => root,
        Err(message) => {
            let mut scan = empty_scan(Path::new(""));
            scan.status = SessionScanStatus::Failed;
            scan.message = Some(message);
            return scan;
        }
    };
    let mut scan = list_records(&root);
    if matches!(
        scan.status,
        SessionScanStatus::Missing | SessionScanStatus::Failed
    ) {
        return scan;
    }
    scan.removal_blocked_reason = check_runtime(&root).err();
    match open_paths(&root) {
        Ok(open) => {
            for record in &mut scan.records {
                let path = root.join(&record.id);
                record.in_use = open.iter().any(|entry| entry.starts_with(&path));
            }
        }
        Err(message) => {
            scan.removal_blocked_reason.get_or_insert(message);
        }
    }
    scan.age_eligible = age_eligible_counts(&scan.records, now_ms());
    scan
}

fn expected_root(expected: Option<&str>) -> Result<PathBuf, String> {
    let root = sessions_dir()?;
    if expected != root.to_str() {
        return Err("Grok Build 来源范围已变化或未确认，请刷新后重新确认。".into());
    }
    Ok(root)
}

pub(crate) fn remove_default(
    expected: Option<&str>,
    ids: Option<&[String]>,
    cutoff_ms: Option<i64>,
    report: &mut dyn FnMut(SessionRemovalProgress),
    on_item: &mut dyn FnMut(&SessionRemovalItem),
) -> Result<SessionRemovalResult, String> {
    let root = expected_root(expected)?;
    let mut check = || {
        expected_root(expected)?;
        check_runtime(&root)?;
        open_paths(&root)
    };
    Ok(remove_records(
        &root,
        ids,
        cutoff_ms,
        &mut check,
        &mut move_path_to_trash,
        report,
        on_item,
    ))
}

fn remove_records(
    root: &Path,
    ids: Option<&[String]>,
    cutoff_ms: Option<i64>,
    check: &mut dyn FnMut() -> Result<HashSet<PathBuf>, String>,
    trash: &mut dyn FnMut(&Path) -> Result<(), String>,
    report: &mut dyn FnMut(SessionRemovalProgress),
    on_item: &mut dyn FnMut(&SessionRemovalItem),
) -> SessionRemovalResult {
    report(SessionRemovalProgress::Preparing);
    let candidates = if let Some(ids) = ids {
        let mut seen = HashSet::new();
        ids.iter()
            .filter(|id| seen.insert((*id).clone()))
            .cloned()
            .collect::<Vec<_>>()
    } else {
        let Some(cutoff) = cutoff_ms else {
            return SessionRemovalResult::aborted("缺少已确认的年龄门槛。".into());
        };
        let scan = list_records(root);
        if scan.status == SessionScanStatus::Failed {
            return SessionRemovalResult::aborted(
                scan.message.unwrap_or_else(|| INVALID_RECORD.into()),
            );
        }
        scan.records
            .into_iter()
            .filter(|record| record.last_activity_ms.is_some_and(|time| time < cutoff))
            .map(|record| record.id)
            .collect()
    };
    let total = candidates.len();
    report(SessionRemovalProgress::Started { total });
    let mut result = SessionRemovalResult::default();
    for (index, id) in candidates.iter().enumerate() {
        let open = match check() {
            Ok(open) => open,
            Err(message) => {
                result.message = Some(message.clone());
                for pending in &candidates[index..] {
                    result.record(
                        pending,
                        SessionRemovalStatus::NotAttempted,
                        Some(SessionRemovalReason::RuntimeBlocked),
                        Some(message.clone()),
                    );
                    on_item(result.items.last().expect("just recorded"));
                }
                if index == 0 {
                    result.operation_error = Some(message);
                }
                break;
            }
        };
        let record = read_record(root, id, false);
        let path = root.join(id);
        match record {
            Err(message) => result.record(
                id,
                SessionRemovalStatus::Skipped,
                Some(SessionRemovalReason::NoLongerRecord),
                Some(message),
            ),
            Ok(_) if open.iter().any(|entry| entry.starts_with(&path)) => {
                result.record(
                    id,
                    SessionRemovalStatus::Skipped,
                    Some(SessionRemovalReason::InUse),
                    None,
                );
            }
            Ok(record) if cutoff_ms.is_some() && record.last_activity_ms.is_none() => {
                result.record(
                    id,
                    SessionRemovalStatus::Skipped,
                    Some(SessionRemovalReason::ActivityUnknown),
                    None,
                );
            }
            Ok(record)
                if cutoff_ms.is_some_and(|cutoff| {
                    record.last_activity_ms.is_some_and(|time| time >= cutoff)
                }) =>
            {
                result.record(
                    id,
                    SessionRemovalStatus::Skipped,
                    Some(SessionRemovalReason::ActivityChanged),
                    None,
                );
            }
            Ok(_) => match record_path(root, id).and_then(|path| trash(&path)) {
                Ok(()) => result.record(id, SessionRemovalStatus::Moved, None, None),
                Err(message) => result.record(
                    id,
                    SessionRemovalStatus::Failed,
                    Some(SessionRemovalReason::TrashFailed),
                    Some(message),
                ),
            },
        }
        on_item(
            result
                .items
                .last()
                .expect("each candidate produces an outcome"),
        );
        report(SessionRemovalProgress::Advanced {
            processed: index + 1,
            total,
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
        });
    }
    result
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn launch_command(binary: &Path, root: &Path, record: &SessionRecord) -> Result<String, String> {
    let details = record.grok.as_ref().ok_or(INVALID_RECORD)?;
    let path = record_path(root, &record.id)?;
    if let Some(error) = resume_error(
        &path,
        &details.session_id,
        record.working_directory.as_deref(),
    ) {
        return Err(error);
    }
    let cwd = record.working_directory.as_deref().ok_or(INVALID_RECORD)?;
    let home = root.parent().and_then(Path::to_str).ok_or(INVALID_RECORD)?;
    Ok(format!(
        "if test -f {} && test -f {} && cd -- {}; then env GROK_HOME={} {} --cwd {} --resume {}; else printf '%s\\n' '原工作目录或会话记录已不存在，请刷新后重试。'; fi",
        shell_quote(&path.join("summary.json").to_string_lossy()), shell_quote(&path.join("updates.jsonl").to_string_lossy()),
        shell_quote(cwd), shell_quote(home), shell_quote(&binary.to_string_lossy()), shell_quote(cwd), shell_quote(&details.session_id),
    ))
}

pub(crate) fn open_default(id: &str, expected: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("继续 Grok Build 会话目前只支持 macOS。".into());
    }
    let root = expected_root(Some(expected))?;
    let record = read_record(&root, id, false)?;
    let paths = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let binary = crate::environment_inspection::resolved_target("grok", &paths)
        .ok_or("未找到 Grok Build CLI，请确认应用 PATH 中有 grok。")?;
    let command = launch_command(Path::new(&binary), &root, &record)?;
    let quoted = format!(
        "\"{}\"",
        command
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    );
    let script = format!("tell application \"Terminal\"\nactivate\ndo script {quoted}\nend tell");
    let run = run_command(
        "/usr/bin/osascript",
        &["-e", &script],
        Duration::from_secs(10),
    )
    .map_err(|_| "无法打开 Terminal，请检查系统自动化权限后重试。".to_string())?;
    if run.exit_code == Some(0) {
        Ok(())
    } else {
        Err("无法在 Terminal 中打开 Grok Build，请检查系统自动化权限后重试。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIRST: &str = "019a1b24-1122-7333-8444-555555555555";
    const SECOND: &str = "019a1b24-1122-7333-8444-666666666666";
    const OLD: &str = "2020-01-01T00:00:00Z";

    fn fixture(root: &Path, group: &str, id: &str, time: Option<&str>) -> String {
        let key = format!("{group}/{id}");
        let path = root.join(&key);
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("summary.json"),
            serde_json::to_vec(&json!({
                "info": { "id": id, "cwd": root.to_string_lossy() },
                "generated_title": "生成的标题", "session_summary": "手动标题",
                "last_active_at": time, "updated_at": "2099-01-01T00:00:00Z"
            }))
            .unwrap(),
        )
        .unwrap();
        // Deliberately not JSON: listing must not parse the conversation.
        fs::write(path.join("updates.jsonl"), "private conversation payload").unwrap();
        key
    }

    fn edit(root: &Path, id: &str, update: impl FnOnce(&mut Value)) {
        let path = root.join(id).join("summary.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        update(&mut value);
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn remove(
        root: &Path,
        ids: Option<&[String]>,
        cutoff: Option<i64>,
        moved: &mut Vec<PathBuf>,
    ) -> SessionRemovalResult {
        remove_records(
            root,
            ids,
            cutoff,
            &mut || Ok(HashSet::new()),
            &mut |path| {
                moved.push(path.into());
                Ok(())
            },
            &mut |_| {},
            &mut |_| {},
        )
    }

    #[test]
    fn lists_across_groups_using_only_metadata_and_measures_the_whole_record() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let first = fixture(root, "project-a", FIRST, Some(OLD));
        fixture(root, "project-b", SECOND, None);
        fs::create_dir_all(root.join(&first).join("attachments")).unwrap();
        fs::write(root.join(&first).join("attachments/image.bin"), [0u8; 100]).unwrap();
        fs::write(root.join("session_search.sqlite"), [0u8; 500]).unwrap();
        edit(root, &first, |value| {
            value["title_is_manual"] = json!(true);
        });
        let scan = list_records(root);
        assert_eq!(scan.status, SessionScanStatus::Ready);
        assert_eq!(scan.records.len(), 2);
        let row = scan.records.iter().find(|row| row.id == first).unwrap();
        assert_eq!(row.title, "手动标题");
        assert_eq!(row.last_activity_ms, activity_time(OLD));
        assert_eq!(
            row.bytes,
            fs::metadata(root.join(&first).join("summary.json"))
                .unwrap()
                .len()
                + b"private conversation payload".len() as u64
                + 100
        );
        assert!(row.grok.as_ref().unwrap().bytes_complete);
        assert!(scan
            .records
            .iter()
            .any(|row| row.last_activity_ms.is_none()));
        assert!(!serde_json::to_string(&scan)
            .unwrap()
            .contains("private conversation payload"));
    }

    #[test]
    fn malformed_identity_is_diagnostic_but_optional_metadata_does_not_hide_records() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let first = fixture(root, "a", FIRST, Some("2026-02-31T00:00:00Z"));
        let second = fixture(root, "b", SECOND, Some(OLD));
        edit(root, &first, |value| {
            value["info"]["cwd"] = Value::Null;
        });
        edit(root, &second, |value| {
            value["info"]["id"] = json!("wrong-id");
        });
        let scan = list_records(root);
        assert_eq!(scan.status, SessionScanStatus::Partial);
        assert_eq!(scan.records.len(), 1);
        assert!(scan.records[0].last_activity_ms.is_none());
        assert!(scan.records[0].working_directory.is_none());
        assert!(scan.records[0]
            .grok
            .as_ref()
            .unwrap()
            .resume_error
            .is_some());
        let mut moved = Vec::new();
        let result = remove(root, Some(&[second]), None, &mut moved);
        assert_eq!(result.skipped, 1);
        assert!(moved.is_empty());
    }

    #[test]
    fn age_excludes_equal_unknown_and_recent_records_but_explicit_selection_keeps_its_scope() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let first = fixture(root, "a", FIRST, Some(OLD));
        let second = fixture(root, "b", SECOND, None);
        let mut moved = Vec::new();
        assert_eq!(remove(root, None, activity_time(OLD), &mut moved).moved, 0);
        assert_eq!(
            remove(
                root,
                None,
                activity_time("2020-01-02T00:00:00Z"),
                &mut moved
            )
            .moved,
            1
        );
        assert_eq!(moved, vec![root.join(&first)]);
        moved.clear();
        let result = remove(root, Some(&[second.clone(), second]), None, &mut moved);
        assert_eq!(result.moved, 1);
        assert_eq!(moved.len(), 1);
    }

    #[test]
    fn rechecks_age_after_candidates_are_found() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = fixture(root, "a", FIRST, Some(OLD));
        let mut moved = Vec::new();
        let result = remove_records(
            root,
            None,
            activity_time("2020-01-02T00:00:00Z"),
            &mut || {
                edit(root, &id, |value| {
                    value["last_active_at"] = json!("2026-10-27T00:00:00Z");
                });
                Ok(HashSet::new())
            },
            &mut |path| {
                moved.push(path.to_path_buf());
                Ok(())
            },
            &mut |_| {},
            &mut |_| {},
        );
        assert_eq!(result.skipped, 1);
        assert_eq!(
            result.items[0].reason,
            Some(SessionRemovalReason::ActivityChanged)
        );
        assert!(moved.is_empty());
    }

    #[test]
    fn runtime_change_stops_remaining_records_without_undoing_success() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let first = fixture(root, "a", FIRST, Some(OLD));
        let second = fixture(root, "b", SECOND, Some(OLD));
        let mut checks = 0;
        let mut moved = Vec::new();
        let mut observed = Vec::new();
        let result = remove_records(
            root,
            Some(&[first.clone(), second.clone()]),
            None,
            &mut || {
                checks += 1;
                if checks == 1 {
                    Ok(HashSet::new())
                } else {
                    Err(RUNTIME_RUNNING.into())
                }
            },
            &mut |path| {
                moved.push(path.to_path_buf());
                Ok(())
            },
            &mut |_| {},
            &mut |item| {
                observed.push(item.id.clone());
            },
        );
        assert_eq!(moved, vec![root.join(&first)]);
        assert_eq!(result.moved, 1);
        assert_eq!(result.items[1].status, SessionRemovalStatus::NotAttempted);
        assert_eq!(observed, vec![first, second]);
        assert!(result.operation_error.is_none());
    }

    #[test]
    fn unknown_runtime_never_moves_records() {
        let temp = tempfile::tempdir().unwrap();
        let id = fixture(temp.path(), "a", FIRST, Some(OLD));
        let result = remove_records(
            temp.path(),
            Some(&[id]),
            None,
            &mut || Err(RUNTIME_UNKNOWN.into()),
            &mut |_| panic!("must not trash"),
            &mut |_| {},
            &mut |_| {},
        );
        assert!(result.operation_error.is_some());
        assert_eq!(result.items[0].status, SessionRemovalStatus::NotAttempted);
    }

    #[test]
    fn open_attachments_block_the_record_and_individual_trash_failure_does_not_stop_the_batch() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let first = fixture(root, "a", FIRST, Some(OLD));
        let second = fixture(root, "b", SECOND, Some(OLD));
        let result = remove_records(
            root,
            Some(&[first.clone(), second.clone()]),
            None,
            &mut || {
                Ok(HashSet::from([root
                    .join(&first)
                    .join("attachments/image.bin")]))
            },
            &mut |_| Ok(()),
            &mut |_| {},
            &mut |_| {},
        );
        assert_eq!((result.skipped, result.moved), (1, 1));
        let result = remove_records(
            root,
            Some(&[first.clone(), second]),
            None,
            &mut || Ok(HashSet::new()),
            &mut |path| {
                if path == root.join(&first) {
                    Err("synthetic failure".into())
                } else {
                    Ok(())
                }
            },
            &mut |_| {},
            &mut |_| {},
        );
        assert_eq!((result.failed, result.moved), (1, 1));
    }

    #[test]
    fn related_records_remain_independent_and_shared_indexes_are_never_targets() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let first = fixture(root, "a", FIRST, Some(OLD));
        let second = fixture(root, "b", SECOND, Some("2026-10-27T00:00:00Z"));
        edit(root, &second, |value| {
            value["parent_session_id"] = json!(FIRST);
        });
        fs::write(root.join("session_search.sqlite"), "shared index").unwrap();
        let before = fs::read(root.join(&second).join("summary.json")).unwrap();
        let scan = list_records(root);
        let parent = scan.records.iter().find(|row| row.id == first).unwrap();
        assert_eq!(
            parent.grok.as_ref().unwrap().related_session_ids,
            vec![SECOND]
        );
        let mut moved = Vec::new();
        remove(
            root,
            None,
            activity_time("2020-01-02T00:00:00Z"),
            &mut moved,
        );
        assert_eq!(moved, vec![root.join(first)]);
        assert_eq!(
            fs::read(root.join(second).join("summary.json")).unwrap(),
            before
        );
        assert_eq!(
            fs::read_to_string(root.join("session_search.sqlite")).unwrap(),
            "shared index"
        );
    }

    #[test]
    fn subagent_metadata_reports_only_confirmed_relations_without_exposing_prompts() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = fixture(root, "a", FIRST, Some(OLD));
        let subagent = root.join(&id).join("subagents/worker/attempt");
        fs::create_dir_all(&subagent).unwrap();
        fs::write(
            subagent.join("meta.json"),
            serde_json::to_vec(&json!({
                "parent_session_id": FIRST, "child_session_id": SECOND,
                "child_cwd": "/example", "prompt": "private subagent prompt"
            }))
            .unwrap(),
        )
        .unwrap();
        let scan = list_records(root);
        let details = scan.records[0].grok.as_ref().unwrap();
        assert_eq!(details.related_session_ids, vec![SECOND]);
        assert!(details.relations_complete);
        assert!(!serde_json::to_string(&scan)
            .unwrap()
            .contains("private subagent prompt"));
        fs::write(subagent.join("meta.json"), "broken").unwrap();
        let partial = list_records(root);
        assert_eq!(partial.status, SessionScanStatus::Partial);
        assert!(!partial.records[0].grok.as_ref().unwrap().relations_complete);
    }

    #[test]
    fn file_probe_maps_canonical_paths_and_rejects_ambiguous_output() {
        let canonical = Path::new("/private/var/example");
        let root = Path::new("/var/example");
        let output = "p123\0\nf3\0n/private/var/example/a/session/updates.jsonl\0\n";
        assert_eq!(
            parse_open_paths(output, Some(1), canonical, root).unwrap(),
            HashSet::from([root.join("a/session/updates.jsonl")])
        );
        assert!(parse_open_paths("", Some(1), canonical, root)
            .unwrap()
            .is_empty());
        for output in [
            "",
            "truncated",
            "p123\0\n",
            "p123\0n/elsewhere\0\n",
            "n/private/var/example/a\0\n",
        ] {
            assert!(parse_open_paths(output, Some(0), canonical, root).is_err());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_probes_drain_large_output_and_find_open_fixture_files() {
        let run = probe_command(
            "/usr/bin/head",
            &["-c", "262144", "/dev/zero"],
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(run.stdout.len(), 262144);
        assert_eq!(run.exit_code, Some(0));
        let ps = probe_command(
            "/bin/ps",
            &["-axww", "-o", "pid=,comm="],
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(process_snapshot(&ps.stdout)
            .unwrap()
            .contains_key(&std::process::id()));
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("synthetic-data");
        fs::write(&path, "fixture").unwrap();
        let held = fs::File::open(&path).unwrap();
        assert!(open_paths(temp.path()).unwrap().contains(&path));
        drop(held);
        assert!(open_paths(temp.path()).unwrap().is_empty());
        assert!(probe_command("/bin/sleep", &["5"], Duration::from_millis(30)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_group_record_summary_or_attachment_symlinks_or_path_traversal() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = temp.path();
        let id = fixture(root, "a", FIRST, Some(OLD));
        symlink(root.join("a"), root.join("linked-group")).unwrap();
        symlink(root.join(&id), root.join("a/linked-record")).unwrap();
        fs::write(outside.path().join("asset"), [0u8; 4096]).unwrap();
        symlink(
            outside.path().join("asset"),
            root.join(&id).join("linked-asset"),
        )
        .unwrap();
        let scan = list_records(root);
        assert_eq!(scan.records.len(), 1);
        assert!(scan.records[0].bytes < 4096);
        for invalid in [
            "../outside",
            "/tmp/other",
            "a/linked-record",
            "linked-group/anything",
            "a/../a/x",
        ] {
            assert!(record_path(root, invalid).is_err());
        }
        let summary = root.join(&id).join("summary.json");
        fs::rename(&summary, outside.path().join("summary.json")).unwrap();
        symlink(outside.path().join("summary.json"), &summary).unwrap();
        assert!(read_record(root, &id, true).is_err());
    }

    #[test]
    fn process_evidence_covers_binary_versions_and_hosts_without_confusing_project_names() {
        let snapshot = process_snapshot("  12 /usr/bin/login\n42 /Users/example/.grok/downloads/grok-1.0.70-macos-aarch64\n99 /usr/local/bin/grove\n").unwrap();
        assert!(grok_host(&snapshot[&42]));
        assert!(grok_host(&snapshot[&99]));
        assert!(!grok_host("/usr/bin/login"));
        assert!(!grok_host(
            "/Applications/DevScope.app/Contents/MacOS/package-manager-control-center"
        ));
        assert!(process_snapshot("").is_err());
        assert!(process_snapshot("truncated").is_err());
    }

    #[test]
    fn continue_uses_exact_uuid_and_quotes_paths_and_refuses_missing_or_ambiguous_inputs() {
        let temp = tempfile::Builder::new()
            .prefix("grok-'$()-")
            .tempdir()
            .unwrap();
        let root = temp.path();
        let id = fixture(root, "a", FIRST, Some(OLD));
        let record = read_record(root, &id, false).unwrap();
        let command =
            launch_command(Path::new("/Applications/Grok Build/grok"), root, &record).unwrap();
        assert!(command.contains(&format!("--resume '{FIRST}'")));
        assert!(command.contains(&format!("--cwd {}", shell_quote(root.to_str().unwrap()))));
        assert!(command.contains("env GROK_HOME="));
        assert!(!command.contains("--fork"));
        assert!(!command.contains("--restore-code"));
        fs::remove_file(root.join(&id).join("updates.jsonl")).unwrap();
        assert!(launch_command(Path::new("/bin/grok"), root, &record).is_err());
        let custom = fixture(root, "b", "custom-title", Some(OLD));
        assert!(read_record(root, &custom, false)
            .unwrap()
            .grok
            .unwrap()
            .resume_error
            .is_some());
    }

    #[test]
    fn missing_source_is_empty_and_measurement_budget_is_explicitly_partial() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            list_records(&temp.path().join("missing")).status,
            SessionScanStatus::Missing
        );
        let id = fixture(temp.path(), "a", FIRST, Some(OLD));
        assert!(!measure(&temp.path().join(id), &mut 1).1);
        assert!(activity_time("2024-02-29T00:00:00Z").is_some());
        assert!(activity_time("2023-02-29T00:00:00Z").is_none());
    }
}
