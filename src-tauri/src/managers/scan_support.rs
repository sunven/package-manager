use crate::types::*;
use serde_json::Value;
use std::env;
use std::path::{Path, PathBuf};

pub(super) fn split_package_version(raw: &str) -> (String, String) {
    if let Some(index) = raw.rfind('@') {
        if index > 0 && index + 1 < raw.len() {
            return (raw[..index].to_string(), raw[index + 1..].to_string());
        }
    }

    (raw.to_string(), "unknown".to_string())
}

pub(super) fn package_row(
    name: String,
    version: String,
    path: Option<String>,
    source: &str,
    kind: PackageKind,
) -> PackageRow {
    PackageRow {
        name,
        version,
        path,
        source: source.to_string(),
        kind,
        signals: Vec::new(),
        actions: Vec::new(),
    }
}

pub(super) fn push_signal(package: &mut PackageRow, signal: PackageSignal) {
    if !package.signals.contains(&signal) {
        package.signals.push(signal);
    }
}

pub(super) fn json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

pub(super) fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub(super) fn expand_tilde(value: &str, home: Option<&Path>) -> PathBuf {
    if value == "~" {
        if let Some(home) = home {
            return home.to_path_buf();
        }
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

pub(super) fn finish(mut snapshot: ManagerSnapshot) -> ManagerSnapshot {
    if matches!(snapshot.status, ManagerStatus::Unsupported) {
        return snapshot;
    }

    if snapshot.version.is_none()
        && snapshot.failures.iter().any(|failure| {
            matches!(
                failure.kind,
                FailureKind::MissingBinary | FailureKind::MissingPath
            )
        })
    {
        snapshot.status = ManagerStatus::Missing;
    } else if !snapshot.packages.is_empty() || !snapshot.paths.is_empty() {
        if snapshot.failures.is_empty() {
            snapshot.status = ManagerStatus::Ready;
        } else {
            snapshot.status = ManagerStatus::Partial;
        }
    } else if snapshot.failures.is_empty() {
        snapshot.status = ManagerStatus::Ready;
    } else {
        snapshot.status = ManagerStatus::Failed;
    }

    snapshot
}

pub(super) fn empty_snapshot(id: ManagerId, label: &str) -> ManagerSnapshot {
    ManagerSnapshot {
        id,
        label: label.to_string(),
        status: ManagerStatus::Failed,
        version: None,
        packages: Vec::new(),
        paths: Vec::new(),
        commands: Vec::new(),
        failures: Vec::new(),
        unsupported_reason: None,
        homebrew: None,
        maven: None,
        pip: None,
        docker: None,
    }
}

pub(super) fn trimmed(value: String) -> String {
    value.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::split_package_version;

    #[test]
    fn split_package_version_handles_scoped_packages() {
        let (name, version) = split_package_version("@scope/tool@2.0.0");

        assert_eq!(name, "@scope/tool");
        assert_eq!(version, "2.0.0");
    }
}
