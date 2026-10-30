use super::scan_support::{empty_snapshot, expand_tilde, finish, home_dir, package_row, path_scope_key};
use crate::command::{command_failure, envelope_owned};
use crate::disk_usage::path_info;
use crate::types::{
    AndroidSdkCli, AndroidSdkCliFlavor, AndroidSdkMaintenance, AndroidSdkMaintenanceOperation,
    AsyncStatus, CommandEnvelope, CommandFailure, CommandRun, FailureKind, MaintenanceRunPreview,
    ManagerId, ManagerSnapshot, ManagerStatus, PackageKind, PathKind,
};
use roxmltree::Document;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_COMPONENT_DEPTH: usize = 8;
const REMOVAL_TIMEOUT_SECS: u64 = 300;

pub(super) fn scan_android_sdk() -> ManagerSnapshot {
    scan_android_sdk_with_root(resolve_sdk_root_from_env())
}

fn scan_android_sdk_with_root(root: Option<PathBuf>) -> ManagerSnapshot {
    let mut snapshot = empty_snapshot(ManagerId::AndroidSdk, "Android SDK");
    let Some(root) = root else {
        snapshot.failures.push(CommandFailure {
            kind: FailureKind::MissingPath,
            message: "未找到 Android SDK 根目录（ANDROID_HOME、ANDROID_SDK_ROOT、~/Library/Android/sdk 均不存在）"
                .into(),
            command: None,
            stdout: String::new(),
            stderr: String::new(),
        });
        return finish(snapshot);
    };

    snapshot.paths.push(path_info(
        "Android SDK root",
        PathKind::AndroidSdkRoot,
        root.display().to_string(),
    ));

    let cli = resolve_maintenance_cli(&root);
    snapshot.android_sdk = Some(AndroidSdkMaintenance { cli: cli.clone() });

    let mut failures = Vec::new();
    let components = collect_components(&root, &mut failures);
    snapshot.failures.extend(failures);

    if components.is_empty() {
        snapshot.scope_key = path_scope_key(&snapshot, &[PathKind::AndroidSdkRoot], None);
        if root.join("packages.xml").is_file() {
            snapshot.status = ManagerStatus::Unsupported;
            snapshot.unsupported_reason =
                Some("旧版 Android SDK 布局只提供集中式包索引，无法提供逐组件清单。".into());
            return finish(snapshot);
        }
        snapshot.failures.push(scan_failure(
            "未找到可识别的 SDK 组件元数据，SDK 根目录的占用仍可查看。".into(),
        ));
        return finish(snapshot);
    }

    for component in components {
        let mut row = package_row(
            component.id.clone(),
            component.version,
            Some(component.path.display().to_string()),
            &component.display_name,
            PackageKind::AndroidSdkComponent,
        );
        if let Some(cli) = cli.as_ref() {
            // cmdline-tools is the maintenance CLI itself and its metadata path
            // (`cmdline-tools;22.0`) may differ from the installed channel
            // (`cmdline-tools/latest`); a copied update command could miss.
            if !component.id.starts_with("cmdline-tools;") {
                row.actions.push(update_action(cli, &component.id));
            }
        }
        snapshot.packages.push(row);
    }

    snapshot.version = snapshot
        .packages
        .iter()
        .find(|package| {
            package.name.starts_with("cmdline-tools;")
                && package
                    .path
                    .as_deref()
                    .is_some_and(|path| path.ends_with("/latest"))
        })
        .or_else(|| {
            snapshot
                .packages
                .iter()
                .find(|package| package.name.starts_with("cmdline-tools;"))
        })
        .map(|package| package.version.clone());

    snapshot.scope_key = path_scope_key(&snapshot, &[PathKind::AndroidSdkRoot], None);
    finish(snapshot)
}

fn resolve_sdk_root_from_env() -> Option<PathBuf> {
    let home = home_dir();
    resolve_sdk_root(
        env::var("ANDROID_HOME").ok().as_deref(),
        env::var("ANDROID_SDK_ROOT").ok().as_deref(),
        home.as_deref(),
    )
}

fn resolve_sdk_root(
    android_home: Option<&str>,
    android_sdk_root: Option<&str>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    for value in [android_home, android_sdk_root].into_iter().flatten() {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let path = expand_tilde(value, home);
        if path.is_dir() {
            return Some(path);
        }
    }

    let default = home?.join("Library/Android/sdk");
    default.is_dir().then_some(default)
}

#[derive(Debug, Clone)]
struct SdkComponent {
    id: String,
    version: String,
    display_name: String,
    path: PathBuf,
}

fn collect_components(root: &Path, failures: &mut Vec<CommandFailure>) -> Vec<SdkComponent> {
    let mut components = BTreeMap::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];

    while let Some((directory, depth)) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                if directory != root {
                    failures.push(scan_failure(format!(
                        "无法读取 SDK 目录 {}：{error}",
                        directory.display()
                    )));
                }
                continue;
            }
        };

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "licenses" {
                continue;
            }
            let path = entry.path();

            if path.join("package.xml").is_file() {
                match parse_package_xml(&path.join("package.xml"), &path, root) {
                    Ok(Some(component)) => {
                        components.insert(component.id.clone(), component);
                    }
                    Ok(None) => {}
                    Err(message) => failures.push(scan_failure(message)),
                }
                continue;
            }

            match parse_source_properties(&path, root) {
                Ok(Some(component)) => {
                    components.insert(component.id.clone(), component);
                    continue;
                }
                Ok(None) => {}
                Err(message) => failures.push(scan_failure(message)),
            }

            if depth < MAX_COMPONENT_DEPTH {
                stack.push((path, depth + 1));
            }
        }
    }

    components.into_values().collect()
}

fn parse_package_xml(
    file: &Path,
    directory: &Path,
    root: &Path,
) -> Result<Option<SdkComponent>, String> {
    let contents = fs::read_to_string(file)
        .map_err(|error| format!("无法读取 {}：{error}", file.display()))?;
    let document = Document::parse(&contents)
        .map_err(|error| format!("无法解析 {}：{error}", file.display()))?;
    let Some(local_package) = document
        .descendants()
        .find(|node| node.tag_name().name() == "localPackage")
    else {
        return Ok(None);
    };
    let id = local_package
        .attribute("path")
        .map(normalize_component_id)
        .filter(|id| !id.is_empty())
        .or_else(|| relative_component_id(directory, root));
    let Some(id) = id else {
        return Ok(None);
    };
    let version = revision_text(local_package).unwrap_or_else(|| "unknown".to_string());
    let display_name = child_text(local_package, "display-name").unwrap_or_else(|| id.clone());

    Ok(Some(SdkComponent {
        id,
        version,
        display_name,
        path: directory.to_path_buf(),
    }))
}

fn parse_source_properties(directory: &Path, root: &Path) -> Result<Option<SdkComponent>, String> {
    let file = directory.join("source.properties");
    if !file.is_file() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&file)
        .map_err(|error| format!("无法读取 {}：{error}", file.display()))?;
    let mut values = BTreeMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            values.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    let Some(version) = values
        .get("Pkg.Revision")
        .cloned()
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let id = values
        .get("Pkg.Path")
        .cloned()
        .filter(|value| !value.is_empty())
        .map(|value| normalize_component_id(&value))
        .filter(|id| !id.is_empty())
        .or_else(|| relative_component_id(directory, root));
    let Some(id) = id else {
        return Ok(None);
    };
    let display_name = values
        .get("Pkg.Desc")
        .cloned()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| id.clone());

    Ok(Some(SdkComponent {
        id,
        version,
        display_name,
        path: directory.to_path_buf(),
    }))
}

fn normalize_component_id(value: &str) -> String {
    value.replace('/', ";").trim_matches(';').to_string()
}

fn relative_component_id(directory: &Path, root: &Path) -> Option<String> {
    let relative = directory.strip_prefix(root).ok()?;
    let id = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(";");
    (!id.is_empty()).then_some(id)
}

fn revision_text(package: roxmltree::Node<'_, '_>) -> Option<String> {
    let revision = package
        .children()
        .find(|node| node.tag_name().name() == "revision")?;
    let mut parts = Vec::new();
    for key in ["major", "minor", "micro"] {
        if let Some(value) = child_text(revision, key) {
            parts.push(value);
        }
    }
    if parts.is_empty() {
        child_text(revision, "preview")
    } else {
        Some(parts.join("."))
    }
}

fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|child| child.tag_name().name() == name)
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn scan_failure(message: String) -> CommandFailure {
    CommandFailure {
        kind: FailureKind::ParseFailure,
        message,
        command: None,
        stdout: String::new(),
        stderr: String::new(),
    }
}

pub(super) fn resolve_maintenance_cli(root: &Path) -> Option<AndroidSdkCli> {
    let mut android = Vec::new();
    let mut sdkmanager = Vec::new();

    if let Ok(entries) = fs::read_dir(root.join("cmdline-tools")) {
        for entry in entries.flatten() {
            let directory = entry.path();
            if !directory.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let android_binary = directory.join("bin").join("android");
            if android_binary.is_file() {
                android.push((name.clone(), android_binary));
            }
            let sdkmanager_binary = directory.join("bin").join("sdkmanager");
            if sdkmanager_binary.is_file() {
                sdkmanager.push((name, sdkmanager_binary));
            }
        }
    }

    sort_cli_candidates(&mut android);
    sort_cli_candidates(&mut sdkmanager);

    let sdk_root = root.display().to_string();
    if let Some((_, program)) = android.into_iter().next() {
        return Some(AndroidSdkCli {
            program: program.display().to_string(),
            flavor: AndroidSdkCliFlavor::Android,
            sdk_root,
        });
    }
    let (_, program) = sdkmanager.into_iter().next()?;
    Some(AndroidSdkCli {
        program: program.display().to_string(),
        flavor: AndroidSdkCliFlavor::Sdkmanager,
        sdk_root,
    })
}

fn sort_cli_candidates(candidates: &mut [(String, PathBuf)]) {
    candidates.sort_by(|a, b| {
        (b.0 == "latest")
            .cmp(&(a.0 == "latest"))
            .then_with(|| b.0.cmp(&a.0))
    });
}

fn update_action(cli: &AndroidSdkCli, package_id: &str) -> CommandEnvelope {
    match cli.flavor {
        AndroidSdkCliFlavor::Android => envelope_owned(
            &cli.program,
            vec![
                format!("--sdk={}", cli.sdk_root),
                "sdk".to_string(),
                "update".to_string(),
                package_id.replace(';', "/"),
            ],
            0,
        ),
        AndroidSdkCliFlavor::Sdkmanager => envelope_owned(
            &cli.program,
            vec![
                format!("--sdk_root={}", cli.sdk_root),
                "--install".to_string(),
                format!("\"{package_id}\""),
            ],
            0,
        ),
    }
}

pub(crate) fn run_android_sdk_uninstall_with_runner<F>(
    operation: AndroidSdkMaintenanceOperation,
    runner: &F,
) -> MaintenanceRunPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let AndroidSdkMaintenanceOperation::UninstallSdkComponent {
        package_id,
        sdk_root,
    } = operation;
    run_android_sdk_uninstall_with_root(Some(PathBuf::from(sdk_root)), package_id, runner)
}

fn run_android_sdk_uninstall_with_root<F>(
    root: Option<PathBuf>,
    package_id: String,
    runner: &F,
) -> MaintenanceRunPreview
where
    F: Fn(&str, &[String], Duration) -> Result<CommandRun, CommandFailure>,
{
    let fallback_command = envelope_owned(
        "sdkmanager",
        vec!["--uninstall".to_string(), package_id.clone()],
        0,
    );

    if !valid_component_id(&package_id) {
        return failed_preview(
            fallback_command,
            FailureKind::ParseFailure,
            "无法识别的 SDK 组件 ID；组件 ID 只能包含字母、数字、点、下划线、连字符和分号。".into(),
        );
    }

    let Some(root) = root.filter(|root| root.is_absolute()) else {
        return failed_preview(
            fallback_command,
            FailureKind::MissingPath,
            "确认时的 SDK 根目录无效，无法卸载组件；请刷新清单后重新确认。".into(),
        );
    };
    if !root.is_dir() {
        return failed_preview(
            fallback_command,
            FailureKind::MissingPath,
            "确认时的 SDK 根目录已不存在或不可访问，无法卸载组件；请刷新清单后重新确认。".into(),
        );
    }

    let Some(cli) = resolve_maintenance_cli(&root) else {
        return failed_preview(
            fallback_command,
            FailureKind::MissingBinary,
            "SDK 根目录内未找到可用的 android 或 sdkmanager CLI，无法卸载组件。".into(),
        );
    };

    if package_id.starts_with("cmdline-tools;") {
        let (_, _, command) = removal_command(&cli, &package_id);
        return failed_preview(
            command,
            FailureKind::CommandFailed,
            "cmdline-tools 提供本工具使用的维护 CLI，不能在应用内卸载。".into(),
        );
    }

    let mut failures = Vec::new();
    let components = collect_components(&root, &mut failures);
    if !components.iter().any(|component| component.id == package_id) {
        let (_, _, command) = removal_command(&cli, &package_id);
        return failed_preview(
            command,
            FailureKind::CommandFailed,
            format!("组件 {package_id} 已不在 SDK 清单中；请刷新后重新选择。"),
        );
    }

    let (program, args, command) = removal_command(&cli, &package_id);
    match runner(&program, &args, Duration::from_secs(REMOVAL_TIMEOUT_SECS)) {
        Ok(run) if run.exit_code == Some(0) => MaintenanceRunPreview {
            status: AsyncStatus::Ready,
            command,
            stdout: run.stdout,
            stderr: run.stderr,
            message: None,
            failure: None,
        },
        Ok(run) => {
            let failure =
                command_failure(FailureKind::CommandFailed, "Android SDK 组件卸载失败", run);
            let preview_command = failure.command.clone().unwrap_or(command);
            MaintenanceRunPreview {
                status: AsyncStatus::Failed,
                command: preview_command,
                stdout: failure.stdout.clone(),
                stderr: failure.stderr.clone(),
                message: Some(failure.message.clone()),
                failure: Some(failure),
            }
        }
        Err(failure) => MaintenanceRunPreview {
            status: AsyncStatus::Failed,
            command,
            stdout: failure.stdout.clone(),
            stderr: failure.stderr.clone(),
            message: Some(failure.message.clone()),
            failure: Some(failure),
        },
    }
}

fn removal_command(cli: &AndroidSdkCli, package_id: &str) -> (String, Vec<String>, CommandEnvelope) {
    match cli.flavor {
        AndroidSdkCliFlavor::Android => {
            let args = vec![
                format!("--sdk={}", cli.sdk_root),
                "sdk".to_string(),
                "remove".to_string(),
                package_id.replace(';', "/"),
            ];
            let command = envelope_owned(&cli.program, args.clone(), REMOVAL_TIMEOUT_SECS * 1_000);
            (cli.program.clone(), args, command)
        }
        AndroidSdkCliFlavor::Sdkmanager => {
            let args = vec![
                format!("--sdk_root={}", cli.sdk_root),
                "--uninstall".to_string(),
                package_id.to_string(),
            ];
            // The preview is meant to be pasted into a shell, where `;` would
            // separate commands. The executed args never carry the quotes.
            let preview_command = envelope_owned(
                &cli.program,
                vec![
                    format!("--sdk_root={}", cli.sdk_root),
                    "--uninstall".to_string(),
                    format!("\"{package_id}\""),
                ],
                REMOVAL_TIMEOUT_SECS * 1_000,
            );
            (cli.program.clone(), args, preview_command)
        }
    }
}

fn valid_component_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with(';')
        && !id.ends_with(';')
        && id.split(';').all(|segment| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        })
}

fn failed_preview(
    command: CommandEnvelope,
    kind: FailureKind,
    message: String,
) -> MaintenanceRunPreview {
    MaintenanceRunPreview {
        status: AsyncStatus::Failed,
        command: command.clone(),
        stdout: String::new(),
        stderr: String::new(),
        message: Some(message.clone()),
        failure: Some(CommandFailure {
            kind,
            message,
            command: Some(command),
            stdout: String::new(),
            stderr: String::new(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{fake_run, temp_dir, write_file};
    use super::{
        collect_components, resolve_sdk_root, run_android_sdk_uninstall_with_root,
        scan_android_sdk_with_root,
    };
    use crate::types::{AsyncStatus, ManagerStatus, PathKind};
    use std::path::Path;
    use std::time::Duration;

    const PLATFORM_XML: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?><ns2:repository xmlns:ns2="urn:android"><localPackage path="platforms;android-36"><revision><major>2</major></revision><display-name>Android SDK Platform 36</display-name></localPackage></ns2:repository>"#;
    const CMDLINE_PROPERTIES: &[u8] = b"Pkg.Revision=22.0\nPkg.Path=cmdline-tools;22.0\nPkg.Desc=Android SDK Command-line Tools\n";
    const NDK_PROPERTIES: &[u8] = b"Pkg.Desc = Android NDK\nPkg.Revision = 27.0.12077973\n";

    #[test]
    fn resolves_the_first_existing_root_then_the_platform_default() {
        let home = temp_dir("android-sdk-home");
        let first = temp_dir("android-sdk-first");
        let second = temp_dir("android-sdk-second");
        let missing = home.path().join("missing-sdk");

        assert_eq!(
            resolve_sdk_root(
                Some(missing.to_str().unwrap()),
                Some(second.path().to_str().unwrap()),
                Some(home.path())
            ),
            Some(second.path().to_path_buf())
        );
        assert_eq!(
            resolve_sdk_root(
                Some(first.path().to_str().unwrap()),
                Some(second.path().to_str().unwrap()),
                Some(home.path())
            ),
            Some(first.path().to_path_buf())
        );

        let default = home.path().join("Library/Android/sdk");
        std::fs::create_dir_all(&default).unwrap();
        assert_eq!(
            resolve_sdk_root(None, None, Some(home.path())),
            Some(default)
        );
    }

    #[test]
    fn parses_package_xml_and_source_properties_components() {
        let root = temp_dir("android-sdk-parse");
        write_file(
            &root.path().join("platforms/android-36/package.xml"),
            PLATFORM_XML,
        );
        write_file(
            &root.path().join("ndk/27.0.12077973/source.properties"),
            NDK_PROPERTIES,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/source.properties"),
            CMDLINE_PROPERTIES,
        );

        let mut failures = Vec::new();
        let components = collect_components(root.path(), &mut failures);

        assert!(failures.is_empty());
        assert_eq!(components.len(), 3);
        let platform = components
            .iter()
            .find(|component| component.id == "platforms;android-36")
            .expect("platform component");
        assert_eq!(platform.version, "2");
        assert_eq!(platform.display_name, "Android SDK Platform 36");
        assert!(components
            .iter()
            .any(|component| component.id == "ndk;27.0.12077973"));
        assert!(components
            .iter()
            .any(|component| component.id == "cmdline-tools;22.0"));
    }

    #[test]
    fn scan_reports_components_version_actions_and_maintenance_cli() {
        let root = temp_dir("android-sdk-scan");
        write_file(
            &root.path().join("platforms/android-36/package.xml"),
            PLATFORM_XML,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/source.properties"),
            CMDLINE_PROPERTIES,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/bin/android"),
            b"",
        );

        let snapshot = scan_android_sdk_with_root(Some(root.path().to_path_buf()));

        assert_eq!(snapshot.status, ManagerStatus::Ready);
        assert_eq!(snapshot.version.as_deref(), Some("22.0"));
        assert_eq!(snapshot.packages.len(), 2);
        assert!(snapshot
            .paths
            .iter()
            .any(|path| path.kind == PathKind::AndroidSdkRoot));
        assert!(snapshot
            .android_sdk
            .as_ref()
            .and_then(|maintenance| maintenance.cli.as_ref())
            .is_some());
        let platform = snapshot
            .packages
            .iter()
            .find(|package| package.name == "platforms;android-36")
            .expect("platform row");
        assert!(platform
            .actions
            .iter()
            .any(|action| action.preview.contains("sdk update platforms/android-36")));
        assert!(snapshot
            .packages
            .iter()
            .find(|package| package.name.starts_with("cmdline-tools;"))
            .expect("cmdline-tools row")
            .actions
            .is_empty());
    }

    #[test]
    fn scan_reports_missing_without_a_root() {
        let snapshot = scan_android_sdk_with_root(None);

        assert_eq!(snapshot.status, ManagerStatus::Missing);
        assert!(snapshot.packages.is_empty());
        assert!(snapshot
            .failures
            .iter()
            .any(|failure| failure.message.contains("未找到 Android SDK 根目录")));
    }

    #[test]
    fn scan_reports_unsupported_for_the_legacy_layout() {
        let root = temp_dir("android-sdk-legacy");
        write_file(&root.path().join("packages.xml"), b"<sdk></sdk>");

        let snapshot = scan_android_sdk_with_root(Some(root.path().to_path_buf()));

        assert_eq!(snapshot.status, ManagerStatus::Unsupported);
        assert!(snapshot.unsupported_reason.is_some());
    }

    #[test]
    fn scan_reports_partial_when_no_component_metadata_is_readable() {
        let root = temp_dir("android-sdk-empty");

        let snapshot = scan_android_sdk_with_root(Some(root.path().to_path_buf()));

        assert_eq!(snapshot.status, ManagerStatus::Partial);
        assert!(snapshot
            .failures
            .iter()
            .any(|failure| failure.message.contains("未找到可识别的 SDK 组件元数据")));
    }

    #[test]
    fn removal_binds_the_sdk_root_and_prefers_the_new_cli() {
        let root = temp_dir("android-sdk-remove");
        write_file(
            &root.path().join("platforms/android-36/package.xml"),
            PLATFORM_XML,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/source.properties"),
            CMDLINE_PROPERTIES,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/bin/android"),
            b"",
        );
        let root_text = root.path().display().to_string();

        let runner = |program: &str, args: &[String], timeout: Duration| {
            assert!(program.ends_with("cmdline-tools/latest/bin/android"));
            assert_eq!(args[0], format!("--sdk={root_text}"));
            assert_eq!(&args[1..], ["sdk", "remove", "platforms/android-36"]);
            assert_eq!(timeout, Duration::from_secs(300));
            let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
            Ok(fake_run(program, &refs, timeout, ""))
        };

        let preview = run_android_sdk_uninstall_with_root(
            Some(root.path().to_path_buf()),
            "platforms;android-36".into(),
            &runner,
        );

        assert_eq!(preview.status, AsyncStatus::Ready);
    }

    #[test]
    fn removal_falls_back_to_sdkmanager_and_rejects_cmdline_tools() {
        let root = temp_dir("android-sdk-sdkmanager");
        write_file(
            &root.path().join("platforms/android-36/package.xml"),
            PLATFORM_XML,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/source.properties"),
            CMDLINE_PROPERTIES,
        );
        write_file(
            &root.path().join("cmdline-tools/latest/bin/sdkmanager"),
            b"",
        );
        let root_text = root.path().display().to_string();

        let runner = |program: &str, args: &[String], timeout: Duration| {
            assert!(program.ends_with("cmdline-tools/latest/bin/sdkmanager"));
            assert_eq!(args[0], format!("--sdk_root={root_text}"));
            assert_eq!(&args[1..], ["--uninstall", "platforms;android-36"]);
            let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
            Ok(fake_run(program, &refs, timeout, ""))
        };

        let preview = run_android_sdk_uninstall_with_root(
            Some(root.path().to_path_buf()),
            "platforms;android-36".into(),
            &runner,
        );
        assert_eq!(preview.status, AsyncStatus::Ready);

        let rejected = run_android_sdk_uninstall_with_root(
            Some(root.path().to_path_buf()),
            "cmdline-tools;22.0".into(),
            &|_program: &str, _args: &[String], _timeout: Duration| {
                panic!("cmdline-tools must not run the CLI")
            },
        );
        assert_eq!(rejected.status, AsyncStatus::Failed);
        assert!(rejected
            .message
            .as_deref()
            .is_some_and(|message| message.contains("cmdline-tools")));

        let missing_root = run_android_sdk_uninstall_with_root(
            Some(root.path().join("missing-sdk")),
            "platforms;android-36".into(),
            &|_program: &str, _args: &[String], _timeout: Duration| {
                panic!("a missing confirmed root must not run the CLI")
            },
        );
        assert_eq!(missing_root.status, AsyncStatus::Failed);
        assert!(missing_root
            .message
            .as_deref()
            .is_some_and(|message| message.contains("根目录")));
    }

    #[test]
    fn removal_rejects_unsafe_component_ids() {
        let preview = run_android_sdk_uninstall_with_root(
            Some(Path::new("/tmp").to_path_buf()),
            "../../etc/passwd".into(),
            &|_program: &str, _args: &[String], _timeout: Duration| {
                panic!("unsafe component IDs must not run the CLI")
            },
        );

        assert_eq!(preview.status, AsyncStatus::Failed);
        assert!(preview
            .message
            .as_deref()
            .is_some_and(|message| message.contains("无法识别")));
    }
}
