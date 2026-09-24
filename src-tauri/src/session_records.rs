use serde::Deserialize;
use serde::Serialize;
use serde_json::value::RawValue;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const TITLE_LIMIT: usize = 140;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRecordScan {
    pub codex: SessionSourceScan,
    pub claude: SessionSourceScan,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSourceScan {
    pub directory: String,
    pub status: SessionScanStatus,
    pub records: Vec<SessionRecord>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) enum SessionScanStatus {
    Ready,
    Partial,
    Missing,
    Failed,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRecord {
    pub id: String,
    pub title: String,
    pub last_activity_ms: Option<i64>,
    pub working_directory: Option<String>,
    pub bytes: u64,
    pub in_use: bool,
}

pub(crate) fn scan_default() -> Result<SessionRecordScan, String> {
    if !cfg!(target_os = "macos") {
        return Err("会话记录目前只支持 macOS".to_string());
    }
    Ok(SessionRecordScan {
        codex: scan_source(codex_sessions_dir(), RecordFormat::Codex),
        claude: scan_source(claude_projects_dir(), RecordFormat::Claude),
    })
}

fn scan_source(directory: Result<PathBuf, String>, format: RecordFormat) -> SessionSourceScan {
    let directory = match directory {
        Ok(directory) => directory,
        Err(message) => return failed_source(String::new(), message),
    };
    let open_paths = match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            match open_files_under(&directory) {
                Ok(paths) => paths,
                Err(message) => {
                    return match list_records(&directory, &|_| false, format) {
                        Ok(mut scan) => {
                            scan.message = Some(message);
                            scan
                        }
                        Err(error) => {
                            failed_source(directory.to_string_lossy().into_owned(), error)
                        }
                    };
                }
            }
        }
        _ => HashSet::new(),
    };
    source_or_failure(&directory, &|path| open_paths.contains(path), format)
}

fn failed_source(directory: String, message: String) -> SessionSourceScan {
    SessionSourceScan {
        directory,
        status: SessionScanStatus::Failed,
        records: Vec::new(),
        message: Some(message),
    }
}

pub(crate) fn codex_sessions_dir() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("CODEX_HOME") {
        if !value.is_empty() {
            let home = PathBuf::from(&value);
            if !home.is_absolute() {
                return Err("CODEX_HOME 必须是绝对路径".to_string());
            }
            return Ok(sessions_dir_from(Some(home.as_path()), Path::new("")));
        }
    }
    let home = std::env::var_os("HOME")
        .filter(|value| Path::new(value).is_absolute())
        .ok_or_else(|| "无法确定当前用户的主目录".to_string())?;
    Ok(sessions_dir_from(None, Path::new(&home)))
}

pub(crate) fn claude_projects_dir() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        if !value.is_empty() {
            let home = PathBuf::from(&value);
            if !home.is_absolute() {
                return Err("CLAUDE_CONFIG_DIR 必须是绝对路径".to_string());
            }
            return Ok(projects_dir_from(Some(home.as_path()), Path::new("")));
        }
    }
    let home = std::env::var_os("HOME")
        .filter(|value| Path::new(value).is_absolute())
        .ok_or_else(|| "无法确定当前用户的主目录".to_string())?;
    Ok(projects_dir_from(None, Path::new(&home)))
}

#[derive(Clone, Copy)]
pub(crate) enum RecordFormat {
    Codex,
    Claude,
}

#[cfg(test)]
pub(crate) fn list_session_sources(
    codex_dir: &Path,
    claude_dir: &Path,
    is_open: &dyn Fn(&Path) -> bool,
) -> SessionRecordScan {
    SessionRecordScan {
        codex: source_or_failure(codex_dir, is_open, RecordFormat::Codex),
        claude: source_or_failure(claude_dir, is_open, RecordFormat::Claude),
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SessionSourceKind {
    Codex,
    Claude,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRemovalResult {
    pub moved: u32,
    pub failed: u32,
    pub message: Option<String>,
}

pub(crate) fn remove_default(
    source: SessionSourceKind,
    id: &str,
) -> Result<SessionRemovalResult, String> {
    let directory = match source {
        SessionSourceKind::Codex => codex_sessions_dir()?,
        SessionSourceKind::Claude => claude_projects_dir()?,
    };
    let open_paths = match open_files_under(&directory) {
        Ok(paths) => paths,
        Err(message) => {
            return Ok(SessionRemovalResult {
                moved: 0,
                failed: 1,
                message: Some(message),
            });
        }
    };
    Ok(remove_one(
        &directory,
        id,
        &|path| open_paths.contains(path),
        &mut move_path_to_trash,
    ))
}

pub(crate) fn remove_older_default(
    source: SessionSourceKind,
    days: u64,
) -> Result<SessionRemovalResult, String> {
    if days != 7 && days != 30 {
        return Err("只支持移除 7 天前或 30 天前的会话记录".to_string());
    }
    let directory = match source {
        SessionSourceKind::Codex => codex_sessions_dir()?,
        SessionSourceKind::Claude => claude_projects_dir()?,
    };
    let open_paths = match open_files_under(&directory) {
        Ok(paths) => paths,
        Err(message) => {
            return Ok(SessionRemovalResult {
                moved: 0,
                failed: 1,
                message: Some(message),
            });
        }
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0);
    let format = match source {
        SessionSourceKind::Codex => RecordFormat::Codex,
        SessionSourceKind::Claude => RecordFormat::Claude,
    };
    Ok(remove_older_than(
        &directory,
        days,
        now_ms,
        &|path| open_paths.contains(path),
        format,
        &mut move_path_to_trash,
    ))
}

pub(crate) fn remove_older_than(
    directory: &Path,
    days: u64,
    now_ms: i64,
    is_open: &dyn Fn(&Path) -> bool,
    format: RecordFormat,
    trash: &mut dyn FnMut(&Path) -> Result<(), String>,
) -> SessionRemovalResult {
    let cutoff = now_ms.saturating_sub(i64::try_from(days).unwrap_or(0).saturating_mul(86_400_000));
    let scan = match list_records(directory, is_open, format) {
        Ok(scan) => scan,
        Err(message) => {
            return SessionRemovalResult {
                moved: 0,
                failed: 1,
                message: Some(message),
            };
        }
    };
    let mut moved = 0;
    let mut failed = 0;
    let mut message = None;
    for record in scan.records {
        let Some(listed_ms) = record.last_activity_ms else {
            continue;
        };
        if listed_ms >= cutoff || record.in_use {
            continue;
        }
        let path = match session_record_file(directory, &record.id) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if is_open(&path) {
            continue;
        }
        let parsed = match format {
            RecordFormat::Codex => parse_session_file(&path),
            RecordFormat::Claude => parse_claude_file(&path),
        };
        let Some(latest_ms) = parsed.last_activity_ms else {
            continue;
        };
        if latest_ms >= cutoff {
            continue;
        }
        match trash(&path) {
            Ok(()) => moved += 1,
            Err(error) => {
                failed += 1;
                message.get_or_insert(error);
            }
        }
    }
    SessionRemovalResult {
        moved,
        failed,
        message,
    }
}

pub(crate) fn remove_one(
    directory: &Path,
    id: &str,
    is_open: &dyn Fn(&Path) -> bool,
    trash: &mut dyn FnMut(&Path) -> Result<(), String>,
) -> SessionRemovalResult {
    let path = match session_record_file(directory, id) {
        Ok(path) => path,
        Err(message) => {
            return SessionRemovalResult {
                moved: 0,
                failed: 0,
                message: Some(message),
            };
        }
    };
    if is_open(&path) {
        return SessionRemovalResult {
            moved: 0,
            failed: 0,
            message: Some("这条会话记录正在使用，留在原处".to_string()),
        };
    }
    match trash(&path) {
        Ok(()) => SessionRemovalResult {
            moved: 1,
            failed: 0,
            message: None,
        },
        Err(message) => SessionRemovalResult {
            moved: 0,
            failed: 1,
            message: Some(message),
        },
    }
}

fn session_record_file(directory: &Path, id: &str) -> Result<PathBuf, String> {
    let relative = Path::new(id.trim());
    let stayed = "这条记录已不再是会话记录，留在原处";
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || relative.extension() != Some(std::ffi::OsStr::new("jsonl"))
    {
        return Err(stayed.to_string());
    }
    let directory_meta = fs::symlink_metadata(directory).map_err(|_| stayed.to_string())?;
    if !directory_meta.is_dir() || directory_meta.file_type().is_symlink() {
        return Err(stayed.to_string());
    }
    let path = directory.join(relative);
    if !normalize_lexical(&path).starts_with(&normalize_lexical(directory)) {
        return Err(stayed.to_string());
    }
    let metadata = fs::symlink_metadata(&path).map_err(|_| stayed.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(stayed.to_string());
    }
    Ok(path)
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn move_path_to_trash(path: &Path) -> Result<(), String> {
    let quoted = apple_script_string(&path.to_string_lossy());
    let script = format!("tell application \"Finder\" to delete POSIX file {quoted}");
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("无法移入废纸篓：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        Err(if detail.is_empty() {
            "无法移入废纸篓".to_string()
        } else {
            format!("无法移入废纸篓：{detail}")
        })
    }
}

fn apple_script_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn source_or_failure(
    directory: &Path,
    is_open: &dyn Fn(&Path) -> bool,
    format: RecordFormat,
) -> SessionSourceScan {
    match list_records(directory, is_open, format) {
        Ok(scan) => scan,
        Err(message) => failed_source(directory.to_string_lossy().into_owned(), message),
    }
}

fn list_records(
    directory: &Path,
    is_open: &dyn Fn(&Path) -> bool,
    format: RecordFormat,
) -> Result<SessionSourceScan, String> {
    let mut scan = SessionSourceScan {
        directory: directory.to_string_lossy().into_owned(),
        status: SessionScanStatus::Ready,
        records: Vec::new(),
        message: None,
    };
    let metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            scan.status = SessionScanStatus::Missing;
            return Ok(scan);
        }
        Err(error) => return Err(format!("无法读取会话记录目录：{error}")),
    };
    if metadata.file_type().is_symlink() {
        scan.message = Some("目录是符号链接，未跟随".to_string());
        return Ok(scan);
    }
    if !metadata.is_dir() {
        return Err("会话记录路径不是目录".to_string());
    }

    let mut files = Vec::new();
    collect_session_files(directory, &mut files, &mut scan);
    files.sort();
    for path in files {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => metadata,
            _ => continue,
        };
        let parsed = match format {
            RecordFormat::Codex => parse_session_file(&path),
            RecordFormat::Claude => parse_claude_file(&path),
        };
        let id = path
            .strip_prefix(directory)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        let title = parsed.title.unwrap_or_else(|| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| id.clone())
        });
        scan.records.push(SessionRecord {
            id,
            title,
            last_activity_ms: parsed.last_activity_ms,
            working_directory: parsed.working_directory,
            bytes: metadata.len(),
            in_use: is_open(&path),
        });
    }
    Ok(scan)
}

fn collect_session_files(dir: &Path, files: &mut Vec<PathBuf>, scan: &mut SessionSourceScan) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            scan.status = SessionScanStatus::Partial;
            scan.message
                .get_or_insert_with(|| format!("部分 sessions 目录无法读取：{error}"));
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                scan.status = SessionScanStatus::Partial;
                scan.message
                    .get_or_insert_with(|| format!("部分 sessions 目录无法读取：{error}"));
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                scan.status = SessionScanStatus::Partial;
                scan.message
                    .get_or_insert_with(|| format!("部分会话记录无法读取：{error}"));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_session_files(&path, files, scan);
            continue;
        }
        if metadata.is_file() && path.extension().is_some_and(|ext| ext == "jsonl") {
            files.push(path);
        }
    }
}

struct ParsedSession {
    title: Option<String>,
    working_directory: Option<String>,
    last_activity_ms: Option<i64>,
}

fn parse_claude_file(path: &Path) -> ParsedSession {
    let mut parsed = ParsedSession {
        title: None,
        working_directory: None,
        last_activity_ms: None,
    };
    let mut user_title = None;
    let mut ai_title = None;
    let Ok(file) = File::open(path) else {
        return parsed;
    };
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<ClaudeLine>(trimmed) else {
            continue;
        };
        note_timestamp(&mut parsed, record.timestamp.as_deref());
        if parsed.working_directory.is_none() {
            parsed.working_directory = record.cwd.filter(|cwd| !cwd.is_empty());
        }
        match record.kind.as_deref() {
            Some("ai-title") => {
                if let Some(title) = record.ai_title.filter(|value| !value.trim().is_empty()) {
                    ai_title = Some(truncate_chars(
                        &title.split_whitespace().collect::<Vec<_>>().join(" "),
                        TITLE_LIMIT,
                    ));
                }
            }
            Some("user") => {
                if record.is_sidechain == Some(true) {
                    continue;
                }
                let Some(text) = record.message.and_then(claude_message_text) else {
                    continue;
                };
                if !is_human_prompt(&text) || user_title.is_some() {
                    continue;
                }
                let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
                if !compact.is_empty() {
                    user_title = Some(truncate_chars(&compact, TITLE_LIMIT));
                }
            }
            _ => {}
        }
    }
    parsed.title = ai_title.or(user_title);
    parsed
}

fn claude_message_text(message: &RawValue) -> Option<String> {
    let payload = serde_json::from_str::<ClaudeMessage>(message.get()).ok()?;
    match payload.content? {
        ClaudeContent::Text(text) => Some(text),
        ClaudeContent::Items(items) => {
            let parts = items
                .into_iter()
                .filter(|item| item.kind.as_deref() == Some("text"))
                .filter_map(|item| item.text)
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
    }
}

fn is_human_prompt(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty()
        && !(trimmed.starts_with("<command-name>")
            || trimmed.starts_with("<command-message>")
            || trimmed.starts_with("<local-command")
            || trimmed.starts_with("<bash-")
            || trimmed.starts_with("<system-reminder")
            || trimmed.starts_with("Caveat:")
            || trimmed.starts_with("[Request interrupted"))
}

fn parse_session_file(path: &Path) -> ParsedSession {
    let mut parsed = ParsedSession {
        title: None,
        working_directory: None,
        last_activity_ms: None,
    };
    let Ok(file) = File::open(path) else {
        return parsed;
    };
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(envelope) = serde_json::from_str::<LineEnvelope>(trimmed) else {
            continue;
        };
        note_timestamp(&mut parsed, envelope.timestamp);
        let Some(kind) = envelope.kind else {
            continue;
        };
        let Some(payload) = envelope.payload else {
            continue;
        };
        match kind {
            "session_meta" => {
                if let Ok(meta) = serde_json::from_str::<MetaPayload>(payload.get()) {
                    note_timestamp(&mut parsed, meta.timestamp.as_deref());
                    if parsed.working_directory.is_none() {
                        parsed.working_directory = meta.cwd.filter(|cwd| !cwd.is_empty());
                    }
                }
            }
            "response_item" => {
                if let Ok(message) = serde_json::from_str::<MessagePayload>(payload.get()) {
                    note_user_title(&mut parsed, user_text_from_message(&message));
                }
            }
            "event_msg" => {
                if let Ok(event) = serde_json::from_str::<EventPayload>(payload.get()) {
                    if event.kind.as_deref() == Some("user_message") {
                        note_user_title(&mut parsed, event.message);
                    }
                }
            }
            _ => {}
        }
    }
    parsed
}

fn note_timestamp(parsed: &mut ParsedSession, value: Option<&str>) {
    let Some(value) = value else {
        return;
    };
    let Some(millis) = parse_rfc3339_millis(value) else {
        return;
    };
    parsed.last_activity_ms = Some(
        parsed
            .last_activity_ms
            .map(|current| current.max(millis))
            .unwrap_or(millis),
    );
}

fn note_user_title(parsed: &mut ParsedSession, text: Option<String>) {
    if parsed.title.is_some() {
        return;
    }
    let Some(text) = text else {
        return;
    };
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty()
        || compact.starts_with("<environment_context")
        || compact.starts_with("<skill>")
    {
        return;
    }
    parsed.title = Some(truncate_chars(&compact, TITLE_LIMIT));
}

fn user_text_from_message(message: &MessagePayload) -> Option<String> {
    if message.kind.as_deref() != Some("message") || message.role.as_deref() != Some("user") {
        return None;
    }
    let content = message.content?;
    let items = serde_json::from_str::<Vec<ContentItem>>(content.get()).ok()?;
    let parts = items
        .into_iter()
        .filter_map(|item| item.text)
        .collect::<Vec<_>>();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn truncate_chars(text: &str, limit: usize) -> String {
    let mut chars = text.chars();
    let mut truncated = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        truncated.push_str("...");
    }
    truncated
}

fn open_files_under(root: &Path) -> Result<HashSet<PathBuf>, String> {
    let output = Command::new("lsof")
        .args(["-Fn", "-n", "-P", "+D"])
        .arg(root)
        .output()
        .map_err(|error| format!("无法判断哪些会话记录正在使用：{error}"))?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err("无法判断哪些会话记录正在使用".to_string());
    }
    Ok(parse_lsof_paths(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_lsof_paths(output: &str) -> HashSet<PathBuf> {
    output
        .lines()
        .filter_map(|line| line.strip_prefix('n'))
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn parse_rfc3339_millis(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 {
        return None;
    }
    let year = parse_u32(&bytes[0..4])?;
    if bytes[4] != b'-' || bytes[7] != b'-' || (bytes[10] != b'T' && bytes[10] != b't') {
        return None;
    }
    let month = parse_u32(&bytes[5..7])?;
    let day = parse_u32(&bytes[8..10])?;
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let hour = parse_u32(&bytes[11..13])?;
    let minute = parse_u32(&bytes[14..16])?;
    let second = parse_u32(&bytes[17..19])?;
    let mut index = 19;
    let mut millis = 0;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
        }
        if index == start {
            return None;
        }
        millis = fraction_millis(&value[start..index])?;
    }
    let offset_seconds = parse_offset(&bytes[index..])?;
    if hour > 23
        || minute > 59
        || second > 60
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
    {
        return None;
    }
    let days = days_from_civil(year, month, day)?;
    days.checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600)?
        .checked_add(i64::from(minute) * 60)?
        .checked_add(i64::from(second))?
        .checked_sub(offset_seconds)?
        .checked_mul(1_000)?
        .checked_add(i64::from(millis))
}

fn fraction_millis(fraction: &str) -> Option<u32> {
    let mut digits = String::new();
    for ch in fraction.chars().take(3) {
        if !ch.is_ascii_digit() {
            return None;
        }
        digits.push(ch);
    }
    while digits.len() < 3 {
        digits.push('0');
    }
    digits.parse().ok()
}

fn parse_offset(bytes: &[u8]) -> Option<i64> {
    if bytes == b"Z" || bytes == b"z" {
        return Some(0);
    }
    if bytes.len() != 6 || bytes[3] != b':' {
        return None;
    }
    let sign = match bytes[0] {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let hours = parse_u32(&bytes[1..3])?;
    let minutes = parse_u32(&bytes[4..6])?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(sign * (i64::from(hours) * 3_600 + i64::from(minutes) * 60))
}

fn parse_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || bytes.iter().any(|byte| !byte.is_ascii_digit()) {
        return None;
    }
    std::str::from_utf8(bytes).ok()?.parse().ok()
}

fn days_from_civil(year: u32, month: u32, day: u32) -> Option<i64> {
    let year = i32::try_from(year).ok()?;
    let month = i32::try_from(month).ok()?;
    let day = i32::try_from(day).ok()?;
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u64;
    let month_prime = if month > 2 { month - 3 } else { month + 9 } as u64;
    let day_of_year = (153 * month_prime + 2) / 5 + day as u64 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(i64::from(era) * 146_097 + day_of_era as i64 - 719_468)
}

#[derive(Deserialize)]
struct LineEnvelope<'a> {
    timestamp: Option<&'a str>,
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    #[serde(borrow)]
    payload: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct MetaPayload {
    timestamp: Option<String>,
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct MessagePayload<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    role: Option<&'a str>,
    #[serde(borrow)]
    content: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct EventPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct ContentItem {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeLine<'a> {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    #[serde(rename = "aiTitle")]
    ai_title: Option<String>,
    #[serde(borrow)]
    message: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    content: Option<ClaudeContent>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ClaudeContent {
    Text(String),
    Items(Vec<ClaudeContentItem>),
}

#[derive(Deserialize)]
struct ClaudeContentItem {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root =
                std::env::temp_dir().join(format!("codex-sessions-{stamp}-{}", std::process::id()));
            fs::create_dir_all(root.join("sessions")).unwrap();
            Self(root)
        }

        fn sessions(&self) -> PathBuf {
            self.0.join("sessions")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn session_line(timestamp: &str, kind: &str, payload: &str) -> String {
        format!(r#"{{"timestamp":"{timestamp}","type":"{kind}","payload":{payload}}}"#)
    }

    #[test]
    fn lists_regular_jsonl_fields_and_skips_other_entries() {
        let fixture = Fixture::new();
        let sessions = fixture.sessions();
        let day = sessions.join("2026/09/24");
        fs::create_dir_all(&day).unwrap();
        let chat = day.join("chat.jsonl");
        fs::write(
            &chat,
            [
                session_line(
                    "2026-09-24T01:00:00Z",
                    "session_meta",
                    r#"{"cwd":"/work/package-manager","timestamp":"2026-09-24T00:00:00Z"}"#,
                ),
                session_line(
                    "2026-09-24T02:00:00Z",
                    "event_msg",
                    r#"{"type":"user_message","message":"<environment_context>ignored</environment_context>"}"#,
                ),
                session_line(
                    "2026-09-24T03:00:00.500Z",
                    "response_item",
                    r#"{"type":"message","role":"user","content":[{"text":"修一下登录"}]}"#,
                ),
            ]
            .join("\n"),
        )
        .unwrap();
        fs::write(day.join("notes.txt"), b"not a session").unwrap();
        fs::create_dir(day.join("subdir.jsonl")).unwrap();
        symlink("chat.jsonl", day.join("alias.jsonl")).unwrap();
        let outside = fixture.0.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.jsonl"), b"{}\n").unwrap();
        symlink(&outside, sessions.join("linked")).unwrap();
        let untitled = day.join("plain.jsonl");
        fs::write(&untitled, b"{}\n").unwrap();

        let scan = list_records(&sessions, &|path| path == chat, RecordFormat::Codex).unwrap();

        assert_eq!(scan.status, SessionScanStatus::Ready);
        assert_eq!(scan.records.len(), 2);
        let named = scan
            .records
            .iter()
            .find(|record| record.title == "修一下登录")
            .unwrap();
        assert_eq!(
            named.working_directory.as_deref(),
            Some("/work/package-manager")
        );
        assert_eq!(named.bytes, fs::metadata(&chat).unwrap().len());
        assert!(named.in_use);
        assert_eq!(
            named.last_activity_ms,
            parse_rfc3339_millis("2026-09-24T03:00:00.500Z")
        );
        let plain = scan
            .records
            .iter()
            .find(|record| record.id.ends_with("plain.jsonl"))
            .unwrap();
        assert_eq!(plain.title, "plain.jsonl");
        assert_eq!(plain.working_directory, None);
        assert_eq!(plain.last_activity_ms, None);
        assert!(!plain.in_use);
        assert!(scan
            .records
            .iter()
            .all(|record| !record.id.contains("secret")));
        assert!(scan
            .records
            .iter()
            .all(|record| !record.id.contains("alias")));
    }

    #[test]
    fn missing_sessions_directory_is_an_empty_scan() {
        let fixture = Fixture::new();
        fs::remove_dir_all(fixture.sessions()).unwrap();
        let scan = list_records(&fixture.sessions(), &|_| true, RecordFormat::Codex).unwrap();
        assert_eq!(scan.status, SessionScanStatus::Missing);
        assert!(scan.records.is_empty());
    }

    #[test]
    fn symlink_sessions_directory_is_not_followed() {
        let fixture = Fixture::new();
        let real = fixture.0.join("real-sessions");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("hidden.jsonl"), b"{}\n").unwrap();
        let link = fixture.0.join("linked-sessions");
        symlink(&real, &link).unwrap();
        let scan = list_records(&link, &|_| false, RecordFormat::Codex).unwrap();
        assert!(scan.records.is_empty());
        assert!(scan.message.unwrap().contains("符号链接"));
    }

    #[test]
    fn rfc3339_offsets_share_one_instant() {
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:01.5Z"), Some(1_500));
        assert_eq!(parse_rfc3339_millis("1970-01-01T08:00:00+08:00"), Some(0));
    }

    #[test]
    fn lsof_names_become_paths() {
        let paths = parse_lsof_paths("p10\nn/tmp/a.jsonl\nfcwd\nn/tmp/b.jsonl\n");
        assert!(paths.contains(&PathBuf::from("/tmp/a.jsonl")));
        assert!(paths.contains(&PathBuf::from("/tmp/b.jsonl")));
    }

    #[test]
    fn resolved_home_uses_codex_home_or_default() {
        let home = Path::new("/Users/example");
        assert_eq!(
            sessions_dir_from(Some(Path::new("/custom/codex")), home),
            PathBuf::from("/custom/codex/sessions")
        );
        assert_eq!(
            sessions_dir_from(None, home),
            PathBuf::from("/Users/example/.codex/sessions")
        );
        assert_eq!(
            projects_dir_from(Some(Path::new("/custom/claude")), home),
            PathBuf::from("/custom/claude/projects")
        );
        assert_eq!(
            projects_dir_from(None, home),
            PathBuf::from("/Users/example/.claude/projects")
        );
    }

    #[test]
    fn lists_claude_records_and_skips_symlinks() {
        let fixture = Fixture::new();
        let projects = fixture.0.join("projects");
        let project = projects.join("-work-app");
        fs::create_dir_all(&project).unwrap();
        let chat = project.join("chat.jsonl");
        fs::write(
            &chat,
            [
                r#"{"type":"user","timestamp":"2026-08-01T01:00:00Z","cwd":"/work/app","isSidechain":true,"message":{"content":[{"type":"text","text":"旁路"}]}}"#,
                r#"{"type":"user","timestamp":"2026-08-02T01:00:00Z","message":{"content":"<command-name>foo</command-name>"}}"#,
                r#"{"type":"user","timestamp":"2026-09-24T01:00:00Z","cwd":"/work/app","message":{"content":[{"type":"text","text":"看看日志"}]}}"#,
                r#"{"type":"ai-title","timestamp":"2026-09-24T03:00:00Z","aiTitle":"日志排查"}"#,
                r#"{"type":"assistant","timestamp":"2026-09-01T00:00:00Z"}"#,
            ]
            .join("\n"),
        )
        .unwrap();
        fs::write(project.join("notes.txt"), b"nope").unwrap();
        symlink("chat.jsonl", project.join("alias.jsonl")).unwrap();
        let plain = project.join("plain.jsonl");
        fs::write(&plain, b"{}\n").unwrap();

        let scan = list_records(&projects, &|path| path == chat, RecordFormat::Claude).unwrap();

        assert_eq!(scan.status, SessionScanStatus::Ready);
        assert_eq!(scan.records.len(), 2);
        let named = scan
            .records
            .iter()
            .find(|record| record.title == "日志排查")
            .unwrap();
        assert_eq!(named.working_directory.as_deref(), Some("/work/app"));
        assert!(named.in_use);
        assert_eq!(
            named.last_activity_ms,
            parse_rfc3339_millis("2026-09-24T03:00:00Z")
        );
        let untitled = scan
            .records
            .iter()
            .find(|record| record.id.ends_with("plain.jsonl"))
            .unwrap();
        assert_eq!(untitled.title, "plain.jsonl");
        assert_eq!(untitled.working_directory, None);
        assert!(scan
            .records
            .iter()
            .all(|record| !record.id.contains("alias")));
    }

    #[test]
    fn one_source_failure_keeps_the_other_source() {
        let fixture = Fixture::new();
        let sessions = fixture.sessions();
        fs::write(sessions.join("keep.jsonl"), b"{}\n").unwrap();
        let projects = fixture.0.join("not-a-directory.jsonl");
        fs::write(&projects, b"{}\n").unwrap();

        let scan = list_session_sources(&sessions, &projects, &|_| false);

        assert_eq!(scan.codex.status, SessionScanStatus::Ready);
        assert_eq!(scan.codex.records.len(), 1);
        assert_eq!(scan.claude.status, SessionScanStatus::Failed);
        assert!(scan.claude.records.is_empty());
        assert!(scan.claude.message.is_some());
    }

    #[test]
    fn missing_claude_projects_directory_stays_empty() {
        let fixture = Fixture::new();
        fs::write(fixture.sessions().join("keep.jsonl"), b"{}\n").unwrap();
        let missing = fixture.0.join("projects");
        let scan = list_session_sources(&fixture.sessions(), &missing, &|_| false);
        assert_eq!(scan.codex.records.len(), 1);
        assert_eq!(scan.claude.status, SessionScanStatus::Missing);
        assert!(scan.claude.records.is_empty());
    }

    fn trash_aside(trash_dir: &Path) -> impl FnMut(&Path) -> Result<(), String> + '_ {
        move |path| {
            fs::create_dir_all(trash_dir).unwrap();
            let name = path.file_name().unwrap();
            fs::rename(path, trash_dir.join(name)).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn single_removal_hands_a_regular_file_to_trash_for_either_source() {
        let fixture = Fixture::new();
        let sessions = fixture.sessions();
        let day = sessions.join("2026/09/24");
        fs::create_dir_all(&day).unwrap();
        let chat = day.join("chat.jsonl");
        fs::write(&chat, "{\"timestamp\":\"2020-01-01T00:00:00Z\"}\n").unwrap();
        fs::write(&chat, "{\"timestamp\":\"2026-09-24T03:00:00Z\"}\n").unwrap();
        let projects = fixture.0.join("projects").join("app");
        fs::create_dir_all(&projects).unwrap();
        let claude = projects.join("chat.jsonl");
        fs::write(&claude, "{}\n").unwrap();
        let trash_dir = fixture.0.join("trash");

        let codex = remove_one(
            &sessions,
            "2026/09/24/chat.jsonl",
            &|_| false,
            &mut trash_aside(&trash_dir),
        );
        assert_eq!(codex.moved, 1);
        assert_eq!(codex.failed, 0);
        assert!(!chat.exists());
        assert!(trash_dir.join("chat.jsonl").is_file());
        let remaining = list_records(&sessions, &|_| false, RecordFormat::Codex).unwrap();
        assert!(remaining.records.is_empty());

        let claude_result = remove_one(
            &projects,
            "chat.jsonl",
            &|_| false,
            &mut trash_aside(&trash_dir),
        );
        assert_eq!(claude_result.moved, 1);
        assert!(!claude.exists());
    }

    #[test]
    fn single_removal_leaves_symlinks_escapes_and_open_files() {
        let fixture = Fixture::new();
        let sessions = fixture.sessions();
        let chat = sessions.join("chat.jsonl");
        fs::write(&chat, "{}\n").unwrap();
        symlink(&chat, sessions.join("alias.jsonl")).unwrap();
        let outside = fixture.0.join("secret.jsonl");
        fs::write(&outside, "{}\n").unwrap();
        let mut calls = 0;
        let mut refuse = |path: &Path| {
            calls += 1;
            let _ = path;
            Ok(())
        };

        let symlink_result = remove_one(&sessions, "alias.jsonl", &|_| false, &mut refuse);
        let escape = remove_one(&sessions, "../secret.jsonl", &|_| false, &mut refuse);
        let in_use = remove_one(&sessions, "chat.jsonl", &|_| true, &mut refuse);
        let trash_error = remove_one(&sessions, "chat.jsonl", &|_| false, &mut |_| {
            Err("废纸篓拒绝".to_string())
        });

        assert_eq!(calls, 0);
        assert_eq!(symlink_result.moved, 0);
        assert_eq!(escape.moved, 0);
        assert_eq!(in_use.moved, 0);
        assert!(chat.exists());
        assert!(outside.exists());
        assert_eq!(trash_error.failed, 1);
        assert_eq!(trash_error.moved, 0);
        assert!(chat.exists());
    }

    fn write_codex(path: &Path, timestamp: &str) {
        fs::write(
            path,
            format!(
                r#"{{"timestamp":"{timestamp}","type":"session_meta","payload":{{"timestamp":"{timestamp}"}}}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn age_removal_rechecks_and_continues_after_a_failure() {
        let fixture = Fixture::new();
        let sessions = fixture.sessions();
        let now = parse_rfc3339_millis("1970-01-15T00:00:00Z").unwrap();
        write_codex(&sessions.join("exact.jsonl"), "1970-01-08T00:00:00Z");
        write_codex(&sessions.join("just-old.jsonl"), "1970-01-07T23:59:59.999Z");
        write_codex(&sessions.join("recent.jsonl"), "1970-01-14T00:00:00Z");
        fs::write(sessions.join("unknown.jsonl"), b"{}\n").unwrap();
        write_codex(&sessions.join("busy.jsonl"), "1970-01-01T00:00:00Z");
        write_codex(&sessions.join("refreshed.jsonl"), "1970-01-01T00:00:00Z");
        write_codex(&sessions.join("zzz.jsonl"), "1970-01-01T00:00:00Z");
        symlink(sessions.join("first.jsonl"), sessions.join("alias.jsonl")).unwrap();
        let trash_dir = fixture.0.join("trash");
        let mut seen_refreshed = false;

        let result = remove_older_than(
            &sessions,
            7,
            now,
            &|path| path.ends_with("busy.jsonl"),
            RecordFormat::Codex,
            &mut |path| {
                if path.ends_with("zzz.jsonl") {
                    return Err("废纸篓拒绝".to_string());
                }
                if path.ends_with("just-old.jsonl") {
                    write_codex(&sessions.join("refreshed.jsonl"), "1970-01-15T00:00:00Z");
                    seen_refreshed = true;
                }
                fs::create_dir_all(&trash_dir).unwrap();
                let name = path.file_name().unwrap();
                fs::rename(path, trash_dir.join(name)).map_err(|error| error.to_string())
            },
        );

        assert!(seen_refreshed);
        assert_eq!(result.failed, 1);
        assert_eq!(result.moved, 1);
        assert!(sessions.join("zzz.jsonl").is_file());
        assert!(sessions.join("refreshed.jsonl").is_file());
        assert!(sessions.join("exact.jsonl").is_file());
        assert!(sessions.join("recent.jsonl").is_file());
        assert!(sessions.join("unknown.jsonl").is_file());
        assert!(sessions.join("busy.jsonl").is_file());
        assert!(fs::symlink_metadata(sessions.join("alias.jsonl"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(trash_dir.join("just-old.jsonl").is_file());
        assert!(!sessions.join("just-old.jsonl").exists());
        let remaining = list_records(&sessions, &|_| false, RecordFormat::Codex).unwrap();
        assert!(remaining
            .records
            .iter()
            .all(|record| !record.id.ends_with("just-old.jsonl")));
    }
}

fn sessions_dir_from(codex_home: Option<&Path>, user_home: &Path) -> PathBuf {
    match codex_home {
        Some(home) => home.join("sessions"),
        None => user_home.join(".codex").join("sessions"),
    }
}

fn projects_dir_from(claude_config_dir: Option<&Path>, user_home: &Path) -> PathBuf {
    match claude_config_dir {
        Some(home) => home.join("projects"),
        None => user_home.join(".claude").join("projects"),
    }
}
