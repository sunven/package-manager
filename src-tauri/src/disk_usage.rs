use crate::types::{DiskUsage, DiskUsageStatus, PathInfo, PathKind};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

pub(crate) fn parse_size(number: &str, unit: &str) -> Option<u64> {
    let value = number.parse::<f64>().ok()?;
    let multiplier = match unit.to_ascii_lowercase().as_str() {
        "b" | "byte" | "bytes" => 1_f64,
        "k" | "kb" | "kib" => 1024_f64,
        "m" | "mb" | "mib" => 1024_f64.powi(2),
        "g" | "gb" | "gib" => 1024_f64.powi(3),
        "t" | "tb" | "tib" => 1024_f64.powi(4),
        _ => return None,
    };

    Some((value * multiplier).round() as u64)
}

pub(crate) fn path_info(label: &str, kind: PathKind, path: String) -> PathInfo {
    PathInfo {
        label: label.to_string(),
        kind,
        path,
        size: pending_disk_usage(),
    }
}

fn pending_disk_usage() -> DiskUsage {
    DiskUsage {
        status: DiskUsageStatus::Pending,
        bytes: None,
        human: None,
        files: 0,
        directories: 0,
        skipped: 0,
        message: Some("Size scan pending".to_string()),
    }
}

pub(crate) fn disk_usage(path: &Path) -> DiskUsage {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return DiskUsage {
                status: DiskUsageStatus::Missing,
                bytes: None,
                human: None,
                files: 0,
                directories: 0,
                skipped: 0,
                message: Some("Path does not exist".to_string()),
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return DiskUsage {
                status: DiskUsageStatus::PermissionDenied,
                bytes: None,
                human: None,
                files: 0,
                directories: 0,
                skipped: 0,
                message: Some(err.to_string()),
            }
        }
        Err(err) => {
            return DiskUsage {
                status: DiskUsageStatus::Error,
                bytes: None,
                human: None,
                files: 0,
                directories: 0,
                skipped: 0,
                message: Some(err.to_string()),
            }
        }
    };

    let mut stats = UsageStats::default();
    let mut seen = HashSet::new();

    if metadata.is_file() {
        add_file(&mut stats, &mut seen, &metadata);
    } else if metadata.is_dir() {
        walk_dir(path, &mut stats, &mut seen);
    }

    DiskUsage {
        status: DiskUsageStatus::Ready,
        bytes: Some(stats.bytes),
        human: Some(format_bytes(stats.bytes)),
        files: stats.files,
        directories: stats.directories,
        skipped: stats.skipped,
        message: None,
    }
}

#[derive(Default)]
struct UsageStats {
    bytes: u64,
    files: u64,
    directories: u64,
    skipped: u64,
}

fn walk_dir(path: &Path, stats: &mut UsageStats, seen: &mut HashSet<(u64, u64)>) {
    stats.directories += 1;
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => {
            stats.skipped += 1;
            return;
        }
    };

    for entry in entries.flatten() {
        let entry_path: PathBuf = entry.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            stats.skipped += 1;
            continue;
        }

        if metadata.is_dir() {
            walk_dir(&entry_path, stats, seen);
        } else if metadata.is_file() {
            add_file(stats, seen, &metadata);
        }
    }
}

#[cfg(unix)]
fn add_file(stats: &mut UsageStats, seen: &mut HashSet<(u64, u64)>, metadata: &fs::Metadata) {
    let key = (metadata.dev(), metadata.ino());
    if seen.insert(key) {
        stats.files += 1;
        stats.bytes += metadata.blocks().saturating_mul(512);
    } else {
        stats.skipped += 1;
    }
}

#[cfg(not(unix))]
fn add_file(stats: &mut UsageStats, _seen: &mut HashSet<(u64, u64)>, metadata: &fs::Metadata) {
    stats.files += 1;
    stats.bytes += metadata.len();
}

pub(crate) fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;

    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }

    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}
