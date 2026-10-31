use crate::command::run_command;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

const MAX_TEXT_ENTRIES: usize = 40_000;
const OPEN_FILES_TTL: Duration = Duration::from_secs(2);
const OPEN_FILES_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FileFingerprint {
    pub ino: u64,
    pub len: u64,
    pub mtime_secs: i64,
    pub mtime_nanos: i64,
}

impl FileFingerprint {
    pub(crate) fn read(path: &Path) -> Option<Self> {
        Self::from_metadata(&fs::symlink_metadata(path).ok()?)
    }

    pub(crate) fn from_metadata(metadata: &fs::Metadata) -> Option<Self> {
        if !metadata.is_file() {
            return None;
        }
        fingerprint_fields(metadata).map(|(ino, len, mtime_secs, mtime_nanos)| Self {
            ino,
            len,
            mtime_secs,
            mtime_nanos,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DirFingerprint {
    pub ino: u64,
    pub mtime_secs: i64,
    pub mtime_nanos: i64,
}

impl DirFingerprint {
    pub(crate) fn read(path: &Path) -> Option<Self> {
        let metadata = fs::symlink_metadata(path).ok()?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return None;
        }
        fingerprint_fields(&metadata).map(|(ino, _, mtime_secs, mtime_nanos)| Self {
            ino,
            mtime_secs,
            mtime_nanos,
        })
    }
}

#[cfg(unix)]
fn fingerprint_fields(metadata: &fs::Metadata) -> Option<(u64, u64, i64, i64)> {
    Some((
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
    ))
}

#[cfg(not(unix))]
fn fingerprint_fields(_metadata: &fs::Metadata) -> Option<(u64, u64, i64, i64)> {
    None
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum TranscriptKind {
    Codex,
    Claude,
    Qoder,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TranscriptState {
    pub user_title: Option<String>,
    pub ai_title: Option<String>,
    pub custom_title: Option<String>,
    pub working_directory: Option<String>,
    pub last_activity_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct CacheKey {
    kind: TranscriptKind,
    path: PathBuf,
}

struct CachedText<S> {
    fingerprint: FileFingerprint,
    consumed: u64,
    state: S,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TextCacheStats {
    pub reused: u64,
    pub parsed: u64,
    pub bytes_read: u64,
}

pub(crate) struct TextCache<S> {
    entries: Mutex<HashMap<CacheKey, CachedText<S>>>,
    reused: AtomicU64,
    parsed: AtomicU64,
    bytes_read: AtomicU64,
}

impl<S> Default for TextCache<S> {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            reused: AtomicU64::new(0),
            parsed: AtomicU64::new(0),
            bytes_read: AtomicU64::new(0),
        }
    }
}

impl<S: Clone + Default> TextCache<S> {
    pub(crate) fn read(
        &self,
        kind: TranscriptKind,
        path: &Path,
        apply: &mut dyn FnMut(&mut S, &str),
    ) -> Option<S> {
        let fingerprint = FileFingerprint::read(path)?;
        let key = CacheKey {
            kind,
            path: path.to_path_buf(),
        };

        let (mut state, start, incremental) = {
            let entries = self.entries.lock().ok()?;
            match entries.get(&key) {
                Some(entry) if entry.fingerprint == fingerprint => {
                    self.reused.fetch_add(1, Ordering::Relaxed);
                    return Some(entry.state.clone());
                }
                Some(entry)
                    if entry.fingerprint.ino == fingerprint.ino
                        && fingerprint.len > entry.consumed =>
                {
                    (entry.state.clone(), entry.consumed, true)
                }
                _ => (S::default(), 0, false),
            }
        };

        if !incremental {
            state = S::default();
        }
        let consumed = match read_lines(path, start, &mut state, apply, &self.bytes_read) {
            Some(consumed) => consumed,
            None if incremental => {
                state = S::default();
                read_lines(path, 0, &mut state, apply, &self.bytes_read)?
            }
            None => return None,
        };
        self.parsed.fetch_add(1, Ordering::Relaxed);
        let next_fingerprint = FileFingerprint::read(path).unwrap_or(fingerprint);
        self.store(
            key,
            CachedText {
                fingerprint: next_fingerprint,
                consumed,
                state: state.clone(),
            },
        );
        Some(state)
    }

    fn store(&self, key: CacheKey, entry: CachedText<S>) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if entries.len() >= MAX_TEXT_ENTRIES && !entries.contains_key(&key) {
            let victims = entries
                .keys()
                .take(entries.len().saturating_sub(MAX_TEXT_ENTRIES / 2))
                .cloned()
                .collect::<Vec<_>>();
            for victim in victims {
                entries.remove(&victim);
            }
        }
        entries.insert(key, entry);
    }

    pub(crate) fn retain_source(&self, root: &Path, seen: &HashSet<PathBuf>) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.retain(|key, _| !key.path.starts_with(root) || seen.contains(&key.path));
    }

    pub(crate) fn stats(&self) -> TextCacheStats {
        TextCacheStats {
            reused: self.reused.load(Ordering::Relaxed),
            parsed: self.parsed.load(Ordering::Relaxed),
            bytes_read: self.bytes_read.load(Ordering::Relaxed),
        }
    }
}

fn read_lines<S>(
    path: &Path,
    start: u64,
    state: &mut S,
    apply: &mut dyn FnMut(&mut S, &str),
    bytes_read: &AtomicU64,
) -> Option<u64> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    reader.seek(SeekFrom::Start(start)).ok()?;

    let mut offset = start;
    let mut pending = Vec::new();
    let mut total = 0u64;
    loop {
        let mut chunk = Vec::new();
        let read = reader.read_until(b'\n', &mut chunk).ok()?;
        if read == 0 {
            break;
        }
        total += read as u64;
        pending.extend_from_slice(&chunk);
        if chunk.last() == Some(&b'\n') {
            offset += pending.len() as u64;
            apply_line(&pending, state, apply);
            pending.clear();
        }
    }
    if !pending.is_empty() {
        // The last JSONL line may lack a trailing newline. Apply it now; it is
        // re-applied after the next append, which is safe for every field.
        apply_line(&pending, state, apply);
    }
    bytes_read.fetch_add(total, Ordering::Relaxed);
    Some(offset)
}

fn apply_line<S>(bytes: &[u8], state: &mut S, apply: &mut dyn FnMut(&mut S, &str)) {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    apply(state, trimmed);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TreeFingerprint {
    pub dir: DirFingerprint,
    pub updates: Option<FileFingerprint>,
    pub summary: Option<FileFingerprint>,
    pub subagents: Option<DirFingerprint>,
}

#[derive(Clone, Debug)]
pub(crate) struct CachedTree {
    pub fingerprint: TreeFingerprint,
    pub bytes: u64,
    pub bytes_complete: bool,
    pub related_ids: Vec<String>,
    pub relations_complete: bool,
}

struct Timed<T> {
    at: Instant,
    value: T,
}

pub(crate) struct TimedCache<T> {
    inner: Mutex<Option<Timed<Result<T, String>>>>,
}

impl<T> Default for TimedCache<T> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

impl<T: Clone> TimedCache<T> {
    pub(crate) fn get(
        &self,
        max_age: Duration,
        load: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "会话扫描缓存状态不可用".to_string())?;
        if let Some(timed) = guard.as_ref() {
            if timed.at.elapsed() <= max_age {
                return timed.value.clone();
            }
        }
        let value = load();
        *guard = Some(Timed {
            at: Instant::now(),
            value: value.clone(),
        });
        value
    }
}

#[derive(Default)]
pub(crate) struct OpenFilesCache {
    snapshot: TimedCache<Arc<HashSet<PathBuf>>>,
}

impl OpenFilesCache {
    pub(crate) fn under(&self, root: &Path) -> Result<HashSet<PathBuf>, String> {
        let snapshot = self
            .snapshot
            .get(OPEN_FILES_TTL, load_open_files)?;
        Ok(under_root(&snapshot, root))
    }
}

fn load_open_files() -> Result<Arc<HashSet<PathBuf>>, String> {
    let run = run_command(
        "/usr/sbin/lsof",
        &["-nP", "-Fpn0"],
        OPEN_FILES_TIMEOUT,
    )
    .map_err(|failure| format!("无法判断哪些会话记录正在使用：{}", failure.message))?;
    if !matches!(run.exit_code, Some(0) | Some(1)) {
        return Err("无法判断哪些会话记录正在使用".to_string());
    }
    Ok(Arc::new(parse_lsof_names(&run.stdout)))
}

fn parse_lsof_names(output: &str) -> HashSet<PathBuf> {
    output
        .split('\0')
        .map(|field| field.trim_start_matches('\n'))
        .filter_map(|field| field.strip_prefix('n'))
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn under_root(open_files: &HashSet<PathBuf>, root: &Path) -> HashSet<PathBuf> {
    let canonical = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    open_files
        .iter()
        .filter_map(|path| {
            path.strip_prefix(&canonical)
                .ok()
                .map(|relative| root.join(relative))
        })
        .collect()
}

#[derive(Clone, Default)]
pub(crate) struct SessionScanState(Arc<SessionScanCache>);

#[derive(Default)]
struct SessionScanCache {
    transcripts: TextCache<TranscriptState>,
    qoder_sidecar_bytes: Mutex<HashMap<PathBuf, (DirFingerprint, u64)>>,
    grok_trees: Mutex<HashMap<PathBuf, CachedTree>>,
    open_files: OpenFilesCache,
    processes: TimedCache<Arc<HashMap<u32, String>>>,
}

impl SessionScanState {
    pub(crate) fn transcripts(&self) -> &TextCache<TranscriptState> {
        &self.0.transcripts
    }

    pub(crate) fn open_files(&self) -> &OpenFilesCache {
        &self.0.open_files
    }

    pub(crate) fn processes(&self) -> &TimedCache<Arc<HashMap<u32, String>>> {
        &self.0.processes
    }

    pub(crate) fn qoder_sidecar_bytes(
        &self,
    ) -> &Mutex<HashMap<PathBuf, (DirFingerprint, u64)>> {
        &self.0.qoder_sidecar_bytes
    }

    pub(crate) fn grok_trees(&self) -> &Mutex<HashMap<PathBuf, CachedTree>> {
        &self.0.grok_trees
    }
}

pub(crate) fn timing_enabled() -> bool {
    std::env::var_os("PACKAGE_MANAGER_SESSION_TIMING").is_some_and(|value| !value.is_empty())
}

pub(crate) fn timed<T>(label: &str, run: impl FnOnce() -> T) -> T {
    if !timing_enabled() {
        return run();
    }
    let started = Instant::now();
    let value = run();
    eprintln!(
        "[session-scan] {label}: {}ms",
        started.elapsed().as_millis()
    );
    value
}

pub(crate) fn log_cache_stats(label: &str, stats: TextCacheStats) {
    if timing_enabled() {
        eprintln!(
            "[session-scan] {label} cache: reused={} parsed={} bytes_read={}",
            stats.reused, stats.parsed, stats.bytes_read
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_parser(state: &mut usize, _line: &str) {
        *state += 1;
    }

    #[test]
    fn unchanged_files_are_reused_without_reading() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        fs::write(&path, b"one\ntwo\n").unwrap();
        let cache = TextCache::<usize>::default();

        let first = cache
            .read(TranscriptKind::Codex, &path, &mut line_parser)
            .unwrap();
        assert_eq!(first, 2);
        let first_stats = cache.stats();
        assert_eq!(first_stats.parsed, 1);

        let second = cache
            .read(TranscriptKind::Codex, &path, &mut line_parser)
            .unwrap();
        assert_eq!(second, 2);
        let second_stats = cache.stats();
        assert_eq!(second_stats.reused, 1);
        assert_eq!(second_stats.bytes_read, first_stats.bytes_read);
    }

    #[test]
    fn appended_lines_are_read_incrementally() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        fs::write(&path, b"one\ntwo\n").unwrap();
        let cache = TextCache::<usize>::default();
        cache
            .read(TranscriptKind::Codex, &path, &mut line_parser)
            .unwrap();
        let before = cache.stats().bytes_read;

        fs::write(&path, b"one\ntwo\nthree\n").unwrap();
        let state = cache
            .read(TranscriptKind::Codex, &path, &mut line_parser)
            .unwrap();
        assert_eq!(state, 3);
        assert_eq!(cache.stats().bytes_read - before, b"three\n".len() as u64);
    }

    #[test]
    fn truncated_files_are_reparsed_from_scratch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        fs::write(&path, b"one\ntwo\nthree\n").unwrap();
        let cache = TextCache::<usize>::default();
        cache
            .read(TranscriptKind::Codex, &path, &mut line_parser)
            .unwrap();

        fs::write(&path, b"fresh\n").unwrap();
        let state = cache
            .read(TranscriptKind::Codex, &path, &mut line_parser)
            .unwrap();
        assert_eq!(state, 1);
    }

    #[test]
    fn lsof_nul_fields_become_paths() {
        let paths = parse_lsof_names(
            "p10\0fcwd\0n/Users/example/a.jsonl\0n/Users/example/b.jsonl\0",
        );
        assert!(paths.contains(&PathBuf::from("/Users/example/a.jsonl")));
        assert!(paths.contains(&PathBuf::from("/Users/example/b.jsonl")));
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn open_files_are_mapped_back_under_the_source_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("sessions");
        fs::create_dir(&root).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        let open_files = HashSet::from([
            canonical.join("a.jsonl"),
            canonical.parent().unwrap().join("other/b.jsonl"),
        ]);
        let paths = under_root(&open_files, &root);
        assert_eq!(paths, HashSet::from([root.join("a.jsonl")]));
    }
}
