use crate::command::run_command;
use crate::session_records::{
    age_eligible_counts, now_ms, open_files_under, parse_rfc3339_millis, SessionRecord,
    SessionRemovalItem, SessionRemovalProgress, SessionRemovalReason, SessionRemovalResult,
    SessionRemovalStatus, SessionScanStatus, SessionSourceKind, SessionSourceScan,
};
use crate::session_scan_cache::{
    DirFingerprint, SessionScanState, TranscriptKind, TranscriptState,
};
use crate::types::AgeEligibleCounts;
use serde::Deserialize;
use serde_json::value::RawValue;
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

const UNNAMED_TITLE: &str = "未命名会话";
const TITLE_LIMIT: usize = 140;
const INVALID_RECORD: &str = "无法确认这条 Qoder 记录的身份，请刷新后重试。";
const SIDECAR_LIMIT: u64 = 4 * 1024 * 1024;
const MEASURE_BUDGET: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QoderEdition {
    International,
    Cn,
}

impl QoderEdition {
    pub(crate) fn from_source(source: SessionSourceKind) -> Option<Self> {
        match source {
            SessionSourceKind::Qoder => Some(Self::International),
            SessionSourceKind::QoderCn => Some(Self::Cn),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::International => "Qoder",
            Self::Cn => "Qoder CN",
        }
    }

    fn home_name(self) -> &'static str {
        match self {
            Self::International => ".qoder",
            Self::Cn => ".qoder-cn",
        }
    }

    fn cli_name(self) -> &'static str {
        match self {
            Self::International => "qodercli",
            Self::Cn => "qoderclicn",
        }
    }

    pub(crate) fn projects_dir(self) -> Result<PathBuf, String> {
        let home = std::env::var_os("HOME")
            .filter(|value| Path::new(value).is_absolute())
            .ok_or_else(|| "无法确定当前用户的主目录".to_string())?;
        Ok(PathBuf::from(home).join(self.home_name()).join("projects"))
    }
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

fn failed_scan(directory: String, message: String) -> SessionSourceScan {
    SessionSourceScan {
        directory,
        status: SessionScanStatus::Failed,
        records: Vec::new(),
        message: Some(message),
        removal_blocked_reason: None,
        age_eligible: AgeEligibleCounts::default(),
    }
}

fn plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
}

fn plain_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

#[derive(Default)]
struct ParsedTranscript {
    ai_title: Option<String>,
    custom_title: Option<String>,
    working_directory: Option<String>,
    last_activity_ms: Option<i64>,
}

impl ParsedTranscript {
    fn title(&self) -> Option<String> {
        self.custom_title.clone().or_else(|| self.ai_title.clone())
    }
}

#[derive(Deserialize)]
struct QoderLine<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    #[serde(borrow)]
    timestamp: Option<&'a RawValue>,
    cwd: Option<&'a str>,
    #[serde(rename = "aiTitle")]
    ai_title: Option<&'a str>,
    #[serde(rename = "customTitle")]
    custom_title: Option<&'a str>,
    directories: Option<Vec<String>>,
}

fn normalize_title(text: &str) -> Option<String> {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    let mut chars = compact.chars();
    let mut truncated = chars.by_ref().take(TITLE_LIMIT).collect::<String>();
    if chars.next().is_some() {
        truncated.push_str("...");
    }
    Some(truncated)
}

fn timestamp_millis(raw: &RawValue) -> Option<i64> {
    let text = raw.get().trim();
    if text.starts_with('"') {
        serde_json::from_str::<String>(text)
            .ok()
            .and_then(|value| parse_rfc3339_millis(&value))
    } else {
        text.parse::<i64>().ok()
    }
}

fn note_timestamp(parsed: &mut TranscriptState, raw: Option<&RawValue>) {
    let Some(raw) = raw else {
        return;
    };
    let Some(millis) = timestamp_millis(raw) else {
        return;
    };
    parsed.last_activity_ms = Some(
        parsed
            .last_activity_ms
            .map(|current| current.max(millis))
            .unwrap_or(millis),
    );
}

fn parse_transcript(path: &Path, state: &SessionScanState) -> ParsedTranscript {
    state
        .transcripts()
        .read(TranscriptKind::Qoder, path, &mut apply_qoder_line)
        .map(|parsed| ParsedTranscript {
            ai_title: parsed.ai_title,
            custom_title: parsed.custom_title,
            working_directory: parsed.working_directory,
            last_activity_ms: parsed.last_activity_ms,
        })
        .unwrap_or_default()
}

fn apply_qoder_line(parsed: &mut TranscriptState, trimmed: &str) {
    let Ok(record) = serde_json::from_str::<QoderLine>(trimmed) else {
        return;
    };
    note_timestamp(parsed, record.timestamp);
    if parsed.working_directory.is_none() {
        parsed.working_directory = record
            .cwd
            .filter(|cwd| !cwd.trim().is_empty())
            .map(str::to_owned);
    }
    if parsed.working_directory.is_none() {
        parsed.working_directory = record
            .directories
            .as_ref()
            .and_then(|directories| {
                directories
                    .iter()
                    .find(|directory| !directory.trim().is_empty())
            })
            .cloned();
    }
    match record.kind {
        Some("ai-title") => {
            if let Some(title) = record.ai_title.and_then(normalize_title) {
                parsed.ai_title = Some(title);
            }
        }
        Some("custom-title") => {
            if let Some(title) = record.custom_title.and_then(normalize_title) {
                parsed.custom_title = Some(title);
            }
        }
        _ => {}
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarState {
    updated_at: Option<String>,
    workspace_directories: Option<Vec<String>>,
}

fn read_sidecar(sidecar: &Path) -> Option<SidecarState> {
    let path = sidecar.join("state.json");
    if !plain_file(&path) {
        return None;
    }
    let file = File::open(&path).ok()?;
    let mut contents = Vec::new();
    file.take(SIDECAR_LIMIT + 1).read_to_end(&mut contents).ok()?;
    if contents.len() as u64 > SIDECAR_LIMIT {
        return None;
    }
    serde_json::from_slice(&contents).ok()
}

fn modified_ms(path: &Path) -> Option<i64> {
    let modified = fs::symlink_metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

struct RecordPaths {
    slug: String,
    stem: String,
    transcript: Option<PathBuf>,
    sidecar: Option<PathBuf>,
}

impl RecordPaths {
    fn id(&self) -> String {
        format!("{}/{}", self.slug, self.stem)
    }

    fn is_open(&self, open_paths: &HashSet<PathBuf>) -> bool {
        self.transcript
            .as_deref()
            .is_some_and(|path| open_paths.contains(path))
            || self.sidecar.as_deref().is_some_and(|directory| {
                open_paths
                    .iter()
                    .any(|path| path.starts_with(directory))
            })
    }

    fn activity_ms(&self, state: &SessionScanState) -> Option<i64> {
        read_details(self, state).last_activity_ms
    }
}

struct RecordDetails {
    title: Option<String>,
    working_directory: Option<String>,
    last_activity_ms: Option<i64>,
}

fn read_details(paths: &RecordPaths, state: &SessionScanState) -> RecordDetails {
    let parsed = paths
        .transcript
        .as_deref()
        .map(|path| parse_transcript(path, state))
        .unwrap_or_default();
    let sidecar = paths.sidecar.as_deref().and_then(read_sidecar);
    let working_directory = parsed.working_directory.clone().or_else(|| {
        sidecar.as_ref().and_then(|state| {
            state
                .workspace_directories
                .as_ref()?
                .iter()
                .find(|directory| !directory.trim().is_empty())
                .cloned()
        })
    });
    let last_activity_ms = parsed
        .last_activity_ms
        .or_else(|| {
            sidecar
                .as_ref()
                .and_then(|state| state.updated_at.as_deref())
                .and_then(parse_rfc3339_millis)
        })
        .or_else(|| {
            paths
                .transcript
                .as_deref()
                .and_then(modified_ms)
                .or_else(|| paths.sidecar.as_deref().and_then(modified_ms))
        });
    RecordDetails {
        title: parsed.title(),
        working_directory,
        last_activity_ms,
    }
}

fn measure(path: &Path, budget: &mut usize) -> u64 {
    if *budget == 0 {
        return 0;
    }
    *budget -= 1;
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.file_type().is_symlink() {
        return 0;
    }
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut bytes = 0u64;
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        bytes = bytes.saturating_add(measure(&entry.path(), budget));
        if *budget == 0 {
            break;
        }
    }
    bytes
}

fn record_bytes(paths: &RecordPaths, state: &SessionScanState) -> u64 {
    let transcript = paths
        .transcript
        .as_deref()
        .and_then(|path| fs::symlink_metadata(path).ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let sidecar = paths
        .sidecar
        .as_deref()
        .map(|directory| sidecar_bytes(directory, state))
        .unwrap_or(0);
    transcript.saturating_add(sidecar)
}

fn sidecar_bytes(directory: &Path, state: &SessionScanState) -> u64 {
    let fingerprint = DirFingerprint::read(directory);
    if let Some(fingerprint) = fingerprint {
        if let Ok(cache) = state.qoder_sidecar_bytes().lock() {
            if let Some((cached, bytes)) = cache.get(directory) {
                if *cached == fingerprint {
                    return *bytes;
                }
            }
        }
    }
    let mut budget = MEASURE_BUDGET;
    let bytes = measure(directory, &mut budget);
    if let (Some(fingerprint), Ok(mut cache)) = (fingerprint, state.qoder_sidecar_bytes().lock()) {
        cache.insert(directory.to_path_buf(), (fingerprint, bytes));
    }
    bytes
}

fn list_records(
    root: &Path,
    label: &str,
    open_paths: &HashSet<PathBuf>,
    state: &SessionScanState,
) -> SessionSourceScan {
    let mut scan = empty_scan(root);
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            scan.status = SessionScanStatus::Missing;
            return scan;
        }
        _ if !plain_directory(root) => {
            scan.status = SessionScanStatus::Failed;
            scan.message = Some(format!("{label} 会话来源不可读、不是普通目录或是符号链接。"));
            return scan;
        }
        _ => {}
    }
    let mut groups: BTreeMap<(String, String), RecordPaths> = BTreeMap::new();
    let mut unreadable = 0usize;
    let Ok(slugs) = fs::read_dir(root) else {
        scan.status = SessionScanStatus::Failed;
        scan.message = Some(format!("无法读取 {label} 会话来源。"));
        return scan;
    };
    for slug in slugs {
        let Ok(slug) = slug else {
            unreadable += 1;
            continue;
        };
        let Ok(kind) = slug.file_type() else {
            unreadable += 1;
            continue;
        };
        if !kind.is_dir() {
            continue;
        }
        let slug_name = slug.file_name().to_string_lossy().into_owned();
        let slug_path = slug.path();
        let Ok(entries) = fs::read_dir(&slug_path) else {
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
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_file() {
                let Some(stem) = name.strip_suffix(".jsonl").filter(|stem| !stem.is_empty()) else {
                    continue;
                };
                groups
                    .entry((slug_name.clone(), stem.to_string()))
                    .or_insert_with(|| RecordPaths {
                        slug: slug_name.clone(),
                        stem: stem.to_string(),
                        transcript: None,
                        sidecar: None,
                    })
                    .transcript = Some(entry.path());
            } else if kind.is_dir() && !name.is_empty() {
                groups
                    .entry((slug_name.clone(), name.clone()))
                    .or_insert_with(|| RecordPaths {
                        slug: slug_name.clone(),
                        stem: name.clone(),
                        transcript: None,
                        sidecar: None,
                    })
                    .sidecar = Some(entry.path());
            }
        }
    }
    let mut seen = HashSet::new();
    let mut seen_sidecars = HashSet::new();
    for paths in groups.into_values() {
        if let Some(transcript) = paths.transcript.as_deref() {
            seen.insert(transcript.to_path_buf());
        }
        if let Some(sidecar) = paths.sidecar.as_deref() {
            seen_sidecars.insert(sidecar.to_path_buf());
        }
        let details = read_details(&paths, state);
        scan.records.push(SessionRecord {
            id: paths.id(),
            title: details.title.unwrap_or_else(|| UNNAMED_TITLE.to_string()),
            last_activity_ms: details.last_activity_ms,
            working_directory: details.working_directory,
            bytes: record_bytes(&paths, state),
            in_use: paths.is_open(open_paths),
            grok: None,
        });
    }
    state.transcripts().retain_source(root, &seen);
    if let Ok(mut cache) = state.qoder_sidecar_bytes().lock() {
        cache.retain(|path, _| !path.starts_with(root) || seen_sidecars.contains(path));
    }
    scan.records.sort_by(|left, right| {
        right
            .last_activity_ms
            .cmp(&left.last_activity_ms)
            .then(left.id.cmp(&right.id))
    });
    if unreadable > 0 {
        scan.status = SessionScanStatus::Partial;
        scan.message = Some(format!(
            "{unreadable} 处会话目录未能完整读取；无法确认身份的目录不能移除。"
        ));
    }
    scan.age_eligible = age_eligible_counts(&scan.records, now_ms());
    scan
}

pub(crate) fn scan_default(edition: QoderEdition, state: &SessionScanState) -> SessionSourceScan {
    let root = match edition.projects_dir() {
        Ok(root) => root,
        Err(message) => return failed_scan(String::new(), message),
    };
    let (open_paths, lsof_error) = match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            match state.open_files().under(&root) {
                Ok(paths) => (paths, None),
                Err(message) => (HashSet::new(), Some(message)),
            }
        }
        _ => (HashSet::new(), None),
    };
    let mut scan = list_records(&root, edition.label(), &open_paths, state);
    if let Some(message) = lsof_error {
        if scan.message.is_none() {
            scan.message = Some(message);
        }
    }
    scan
}

fn expected_root(edition: QoderEdition, expected: Option<&str>) -> Result<PathBuf, String> {
    let root = edition.projects_dir()?;
    if expected != root.to_str() {
        return Err(format!(
            "{} 来源范围已变化或未确认，请刷新后重新确认。",
            edition.label()
        ));
    }
    Ok(root)
}

fn record_paths(root: &Path, id: &str) -> Result<RecordPaths, String> {
    let parts = Path::new(id).components().collect::<Vec<_>>();
    if parts.len() != 2 || parts.iter().any(|part| !matches!(part, Component::Normal(_))) {
        return Err(INVALID_RECORD.into());
    }
    let slug = parts[0].as_os_str().to_string_lossy().into_owned();
    let stem = parts[1].as_os_str().to_string_lossy().into_owned();
    if !plain_directory(root) {
        return Err(INVALID_RECORD.into());
    }
    let slug_path = root.join(&slug);
    if !plain_directory(&slug_path) {
        return Err(INVALID_RECORD.into());
    }
    let transcript_path = slug_path.join(format!("{stem}.jsonl"));
    let sidecar_path = slug_path.join(&stem);
    let transcript = plain_file(&transcript_path).then_some(transcript_path);
    let sidecar = plain_directory(&sidecar_path).then_some(sidecar_path);
    if transcript.is_none() && sidecar.is_none() {
        return Err(INVALID_RECORD.into());
    }
    Ok(RecordPaths {
        slug,
        stem,
        transcript,
        sidecar,
    })
}

pub(crate) fn remove_default(
    edition: QoderEdition,
    expected: Option<&str>,
    ids: Option<&[String]>,
    cutoff_ms: Option<i64>,
    report: &mut dyn FnMut(SessionRemovalProgress),
    on_item: &mut dyn FnMut(&SessionRemovalItem),
) -> Result<SessionRemovalResult, String> {
    let root = expected_root(edition, expected)?;
    let open_paths = match open_files_under(&root) {
        Ok(paths) => paths,
        Err(message) => return Ok(SessionRemovalResult::aborted(message)),
    };
    Ok(remove_records(
        &root,
        edition.label(),
        ids,
        cutoff_ms,
        &open_paths,
        &mut crate::session_records::move_paths_to_trash,
        report,
        on_item,
    ))
}

struct ItemOutcome {
    status: SessionRemovalStatus,
    reason: Option<SessionRemovalReason>,
    message: Option<String>,
}

fn skipped(reason: SessionRemovalReason, message: Option<String>) -> ItemOutcome {
    ItemOutcome {
        status: SessionRemovalStatus::Skipped,
        reason: Some(reason),
        message,
    }
}

fn remove_record(
    root: &Path,
    id: &str,
    cutoff_ms: Option<i64>,
    open_paths: &HashSet<PathBuf>,
    trash: &mut dyn FnMut(&[PathBuf]) -> Result<(), String>,
) -> ItemOutcome {
    let paths = match record_paths(root, id) {
        Ok(paths) => paths,
        Err(message) => return skipped(SessionRemovalReason::NoLongerRecord, Some(message)),
    };
    if paths.is_open(open_paths) {
        return skipped(SessionRemovalReason::InUse, None);
    }
    if let Some(cutoff) = cutoff_ms {
        let state = SessionScanState::default();
        match paths.activity_ms(&state) {
            None => return skipped(SessionRemovalReason::ActivityUnknown, None),
            Some(activity) if activity >= cutoff => {
                return skipped(SessionRemovalReason::ActivityChanged, None);
            }
            Some(_) => {}
        }
    }
    let targets = [paths.transcript.clone(), paths.sidecar.clone()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let trash_result = trash(&targets);
    let remaining = targets
        .iter()
        .filter(|path| fs::symlink_metadata(path).is_ok())
        .count();
    if remaining == 0 {
        return ItemOutcome {
            status: SessionRemovalStatus::Moved,
            reason: None,
            message: None,
        };
    }
    ItemOutcome {
        status: SessionRemovalStatus::Failed,
        reason: Some(SessionRemovalReason::TrashFailed),
        message: Some(match trash_result {
            Err(message) => message,
            Ok(()) => "部分数据未能移入废纸篓，请刷新后重试。".to_string(),
        }),
    }
}

fn remove_records(
    root: &Path,
    label: &str,
    ids: Option<&[String]>,
    cutoff_ms: Option<i64>,
    open_paths: &HashSet<PathBuf>,
    trash: &mut dyn FnMut(&[PathBuf]) -> Result<(), String>,
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
        let scan = list_records(root, label, &HashSet::new(), &SessionScanState::default());
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
        let outcome = remove_record(root, id, cutoff_ms, open_paths, trash);
        result.record(id, outcome.status, outcome.reason, outcome.message);
        on_item(result.items.last().expect("each candidate produces an outcome"));
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

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn open_default(
    edition: QoderEdition,
    id: &str,
    expected: &str,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("继续 Qoder 会话目前只支持 macOS。".into());
    }
    let root = expected_root(edition, Some(expected))?;
    let paths = record_paths(&root, id)?;
    let transcript = paths
        .transcript
        .as_deref()
        .ok_or("会话转写缺失，无法继续会话。")?;
    if !uuid_id(&paths.stem) {
        return Err("此标识暂无法保证按精确 ID 继续，请在 Qoder 中打开会话。".into());
    }
    let details = read_details(&paths, &SessionScanState::default());
    let cwd = details
        .working_directory
        .filter(|cwd| Path::new(cwd).is_absolute() && Path::new(cwd).is_dir())
        .ok_or("原工作目录未记录或已不存在，无法继续会话。")?;
    let path_list = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let binary = crate::environment_inspection::resolved_target(edition.cli_name(), &path_list)
        .ok_or_else(|| {
            format!(
                "未找到 {} CLI，请确认应用 PATH 中有 {}。",
                edition.label(),
                edition.cli_name()
            )
        })?;
    let command = format!(
        "if test -f {} && cd -- {}; then {} --resume {}; else printf '%s\\n' '原工作目录或会话记录已不存在，请刷新后重试。'; fi",
        shell_quote(&transcript.to_string_lossy()),
        shell_quote(&cwd),
        shell_quote(&binary),
        shell_quote(&paths.stem),
    );
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
        Err(format!(
            "无法在 Terminal 中打开 {}，请检查系统自动化权限后重试。",
            edition.label()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    struct Fixture {
        dir: TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn root(&self) -> PathBuf {
            self.dir.path().join("projects")
        }

        fn write(&self, relative: &str, contents: &str) -> PathBuf {
            let path = self.root().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            path
        }

        fn session(&self, slug: &str, stem: &str) -> PathBuf {
            let lines = [
                format!(
                    "{{\"type\":\"workspace-directories\",\"sessionId\":\"{stem}\",\"directories\":[\"/Users/test/{slug}\"]}}"
                ),
                format!(
                    "{{\"type\":\"runtime-config\",\"sessionId\":\"{stem}\",\"timestamp\":1735689600000}}"
                ),
                format!(
                    "{{\"type\":\"user\",\"timestamp\":\"2025-01-01T00:00:02.000Z\",\"cwd\":\"/Users/test/{slug}\",\"sessionId\":\"{stem}\",\"isSidechain\":false}}"
                ),
                format!("{{\"type\":\"ai-title\",\"sessionId\":\"{stem}\",\"aiTitle\":\"AI 标题\"}}"),
                format!(
                    "{{\"type\":\"custom-title\",\"sessionId\":\"{stem}\",\"customTitle\":\"自定义标题\"}}"
                ),
            ]
            .join("\n");
            self.write(&format!("{slug}/{stem}.jsonl"), &lines)
        }

        fn sidecar(&self, slug: &str, stem: &str, updated_at: &str) -> PathBuf {
            self.write(
                &format!("{slug}/{stem}/state.json"),
                &format!(
                    "{{\"sessionId\":\"{stem}\",\"createdAt\":\"2025-01-01T00:00:00.000Z\",\"updatedAt\":\"{updated_at}\",\"workspaceDirectories\":[\"/Users/test/{slug}\"]}}"
                ),
            );
            self.write(&format!("{slug}/{stem}/subagents/agent.jsonl"), "{}\n")
        }
    }

    const STEM: &str = "11111111-2222-3333-4444-555555555555";
    const ORPHAN: &str = "99999999-8888-7777-6666-555555555555";

    #[test]
    fn scan_reads_titles_directories_activity_and_sidecar_bytes() {
        let fixture = Fixture::new();
        let transcript = fixture.session("-Users-test-proj", STEM);
        fixture.sidecar("-Users-test-proj", STEM, "2025-01-03T00:00:00.000Z");
        fixture.sidecar("-Users-test-proj", ORPHAN, "2025-01-02T00:00:00.000Z");
        fixture.write("-Users-test-proj/notes.txt", "ignored");
        let linked = fixture.dir.path().join("linked.jsonl");
        fs::write(&linked, "").unwrap();
        symlink(&linked, fixture.root().join("-Users-test-proj/linked.jsonl")).unwrap();

        let mut open = HashSet::new();
        open.insert(fixture.root().join("-Users-test-proj").join(STEM));

        let scan = list_records(
            &fixture.root(),
            "Qoder",
            &open,
            &SessionScanState::default(),
        );
        assert_eq!(scan.status, SessionScanStatus::Ready);
        assert_eq!(scan.records.len(), 2);
        let record = scan
            .records
            .iter()
            .find(|record| record.id == format!("-Users-test-proj/{STEM}"))
            .unwrap();
        assert_eq!(record.title, "自定义标题");
        assert_eq!(
            record.working_directory.as_deref(),
            Some("/Users/test/-Users-test-proj")
        );
        // Transcript timestamps win over the sidecar's updatedAt.
        assert_eq!(
            record.last_activity_ms,
            parse_rfc3339_millis("2025-01-01T00:00:02.000Z")
        );
        assert!(record.bytes > fs::metadata(&transcript).unwrap().len());
        assert!(record.in_use);
        let orphan = scan
            .records
            .iter()
            .find(|record| record.id == format!("-Users-test-proj/{ORPHAN}"))
            .unwrap();
        assert_eq!(orphan.title, UNNAMED_TITLE);
        assert_eq!(
            orphan.last_activity_ms,
            parse_rfc3339_millis("2025-01-02T00:00:00.000Z")
        );
        assert!(!orphan.in_use);
        assert_eq!(scan.age_eligible.days7, 1);
        assert_eq!(scan.age_eligible.days30, 1);
    }

    #[test]
    fn repeated_scans_reuse_transcript_parses() {
        let fixture = Fixture::new();
        fixture.session("-Users-test-proj", STEM);
        fixture.sidecar("-Users-test-proj", STEM, "2025-01-03T00:00:00.000Z");
        let state = SessionScanState::default();
        let first = list_records(&fixture.root(), "Qoder", &HashSet::new(), &state);
        let after_first = state.transcripts().stats();
        assert!(after_first.bytes_read > 0);

        let second = list_records(&fixture.root(), "Qoder", &HashSet::new(), &state);
        assert_eq!(second.records.len(), first.records.len());
        let after_second = state.transcripts().stats();
        assert_eq!(after_second.bytes_read, after_first.bytes_read);
        assert!(after_second.reused > after_first.reused);
    }

    #[test]
    fn scan_reports_missing_and_symlinked_roots() {
        let fixture = Fixture::new();
        let state = SessionScanState::default();
        let missing = list_records(&fixture.root(), "Qoder", &HashSet::new(), &state);
        assert_eq!(missing.status, SessionScanStatus::Missing);

        fs::create_dir_all(fixture.dir.path().join("real")).unwrap();
        symlink(
            fixture.dir.path().join("real"),
            fixture.root(),
        )
        .unwrap();
        let linked = list_records(&fixture.root(), "Qoder CN", &HashSet::new(), &state);
        assert_eq!(linked.status, SessionScanStatus::Failed);
        assert!(linked.message.unwrap().contains("Qoder CN"));
    }

    #[test]
    fn removal_trashes_transcript_and_sidecar_and_skips_in_use_records() {
        let fixture = Fixture::new();
        let transcript = fixture.session("-Users-test-proj", STEM);
        let sidecar = fixture.root().join("-Users-test-proj").join(STEM);
        fs::create_dir_all(&sidecar).unwrap();
        let orphan_transcript = fixture.session("-Users-test-proj", ORPHAN);
        let orphan_sidecar = fixture.root().join("-Users-test-proj").join(ORPHAN);
        fs::create_dir_all(&orphan_sidecar).unwrap();

        let mut open = HashSet::new();
        open.insert(sidecar.join("state.json"));
        let mut trashed: Vec<Vec<PathBuf>> = Vec::new();
        let mut trash = |paths: &[PathBuf]| -> Result<(), String> {
            trashed.push(paths.to_vec());
            for path in paths {
                if path.is_dir() {
                    fs::remove_dir_all(path).unwrap();
                } else {
                    fs::remove_file(path).unwrap();
                }
            }
            Ok(())
        };
        let ids = vec![
            format!("-Users-test-proj/{STEM}"),
            format!("-Users-test-proj/{ORPHAN}"),
            "-Users-test-proj/missing".to_string(),
            "../escape".to_string(),
        ];
        let result = remove_records(
            &fixture.root(),
            "Qoder",
            Some(&ids),
            None,
            &open,
            &mut trash,
            &mut |_| {},
            &mut |_| {},
        );
        assert_eq!(result.moved, 1);
        assert_eq!(result.skipped, 3);
        assert_eq!(result.failed, 0);
        assert_eq!(trashed.len(), 1);
        assert!(trashed[0].contains(&orphan_transcript));
        assert!(trashed[0].contains(&orphan_sidecar));
        assert!(transcript.exists());
        assert!(sidecar.exists());
        assert!(!orphan_transcript.exists());
        assert!(!orphan_sidecar.exists());
        assert!(result.items.iter().any(|item| item.status == SessionRemovalStatus::Skipped
            && item.reason == Some(SessionRemovalReason::InUse)));
        assert!(result.items.iter().any(|item| item.reason == Some(SessionRemovalReason::NoLongerRecord)));
    }

    #[test]
    fn removal_by_age_respects_cutoff() {
        let fixture = Fixture::new();
        fixture.session("-Users-test-proj", STEM);
        fixture.sidecar("-Users-test-proj", ORPHAN, "2025-01-02T00:00:00.000Z");
        let cutoff = parse_rfc3339_millis("2025-01-02T00:00:00.000Z").unwrap();
        let result = remove_records(
            &fixture.root(),
            "Qoder",
            None,
            Some(cutoff),
            &HashSet::new(),
            &mut |paths| -> Result<(), String> {
                for path in paths {
                    if path.is_dir() {
                        fs::remove_dir_all(path).unwrap();
                    } else {
                        fs::remove_file(path).unwrap();
                    }
                }
                Ok(())
            },
            &mut |_| {},
            &mut |_| {},
        );
        assert_eq!(result.moved, 1);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, format!("-Users-test-proj/{STEM}"));
        assert!(!fixture
            .root()
            .join("-Users-test-proj")
            .join(format!("{STEM}.jsonl"))
            .exists());
        assert!(fixture
            .root()
            .join("-Users-test-proj")
            .join(ORPHAN)
            .exists());
    }

    #[test]
    fn record_paths_rejects_traversal_and_symlinks() {
        let fixture = Fixture::new();
        fixture.session("-Users-test-proj", STEM);
        assert!(record_paths(&fixture.root(), &format!("-Users-test-proj/{STEM}")).is_ok());
        assert!(record_paths(&fixture.root(), "../escape").is_err());
        assert!(record_paths(&fixture.root(), &format!("-Users-test-proj/../../{STEM}")).is_err());

        let outside = fixture.dir.path().join("outside.jsonl");
        fs::write(&outside, "{}\n").unwrap();
        symlink(
            &outside,
            fixture
                .root()
                .join("-Users-test-proj")
                .join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
        )
        .unwrap();
        let scan = list_records(
            &fixture.root(),
            "Qoder",
            &HashSet::new(),
            &SessionScanState::default(),
        );
        assert_eq!(scan.records.len(), 1);
    }

    #[test]
    fn scan_payload_and_source_ids_use_the_expected_keys() {
        let scan = crate::session_records::SessionRecordScan {
            codex: empty_scan(Path::new("")),
            claude: empty_scan(Path::new("")),
            grok: None,
            qoder: Some(empty_scan(Path::new("/qoder"))),
            qoder_cn: Some(empty_scan(Path::new("/qoder-cn"))),
        };
        let value = serde_json::to_value(&scan).unwrap();
        assert!(value.get("qoder").is_some());
        assert!(value.get("qoder-cn").is_some());
        assert_eq!(
            serde_json::from_str::<SessionSourceKind>("\"qoder-cn\"").unwrap(),
            SessionSourceKind::QoderCn
        );
    }
}
