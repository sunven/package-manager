use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandEnvelope {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) preview: String,
    pub(crate) timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandRun {
    pub(crate) envelope: CommandEnvelope,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandFailure {
    pub(crate) kind: FailureKind,
    pub(crate) message: String,
    pub(crate) command: Option<CommandEnvelope>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) enum FailureKind {
    MissingBinary,
    MissingPath,
    CommandFailed,
    ParseFailure,
    PermissionDenied,
    Timeout,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackageRow {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) path: Option<String>,
    pub(crate) source: String,
    pub(crate) kind: PackageKind,
    pub(crate) signals: Vec<PackageSignal>,
    pub(crate) actions: Vec<CommandEnvelope>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum PackageKind {
    Generic,
    Formula,
    Cask,
    MavenArtifact,
    PythonDistribution,
    DockerImage,
    DockerContainer,
    DockerVolume,
    BunPackage,
    UvTool,
    UvPython,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum PackageSignal {
    Outdated,
    Leaf,
    DuplicateVersions,
    Snapshot,
    Editable,
    UserSite,
    DirectUrl,
    Dangling,
    Unused,
    Running,
    Stopped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathInfo {
    pub(crate) label: String,
    pub(crate) kind: PathKind,
    pub(crate) path: String,
    pub(crate) size: DiskUsage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum PathKind {
    Cache,
    NpxCache,
    Store,
    GlobalModules,
    GlobalDir,
    NvmDir,
    NvmNodeVersions,
    CargoBin,
    CargoRegistryCache,
    CargoRegistrySource,
    CargoGitCache,
    CargoGitCheckouts,
    DockerConfig,
    DockerBuildx,
    DockerDesktopData,
    BunInstall,
    BunCache,
    UvTools,
    UvPythonInstallations,
    UvCache,
    Prefix,
    Cellar,
    Caskroom,
    LocalRepository,
    SitePackages,
    UserSite,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiskUsage {
    pub(crate) status: DiskUsageStatus,
    pub(crate) bytes: Option<u64>,
    pub(crate) human: Option<String>,
    pub(crate) files: u64,
    pub(crate) directories: u64,
    pub(crate) skipped: u64,
    pub(crate) message: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) enum DiskUsageStatus {
    Pending,
    Ready,
    Missing,
    PermissionDenied,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagerSnapshot {
    pub(crate) id: ManagerId,
    pub(crate) label: String,
    pub(crate) status: ManagerStatus,
    pub(crate) version: Option<String>,
    pub(crate) packages: Vec<PackageRow>,
    pub(crate) paths: Vec<PathInfo>,
    pub(crate) commands: Vec<CommandEnvelope>,
    pub(crate) failures: Vec<CommandFailure>,
    pub(crate) unsupported_reason: Option<String>,
    pub(crate) homebrew: Option<HomebrewMaintenance>,
    pub(crate) maven: Option<MavenRepositoryHealth>,
    pub(crate) pip: Option<PipEnvironmentHealth>,
    pub(crate) docker: Option<DockerResourceHealth>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomebrewMaintenance {
    pub(crate) formula_count: usize,
    pub(crate) cask_count: usize,
    pub(crate) outdated_count: usize,
    pub(crate) leaf_count: usize,
    pub(crate) outdated: Vec<String>,
    pub(crate) leaves: Vec<String>,
    pub(crate) cleanup: HomebrewCleanupPreview,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomebrewCleanupPreview {
    pub(crate) status: AsyncStatus,
    pub(crate) command: CommandEnvelope,
    pub(crate) raw_output: String,
    pub(crate) reclaimed_bytes: Option<u64>,
    pub(crate) reclaimed_human: Option<String>,
    pub(crate) message: Option<String>,
    pub(crate) failure: Option<CommandFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MavenRepositoryHealth {
    pub(crate) local_repository: String,
    pub(crate) artifact_count: usize,
    pub(crate) version_count: usize,
    pub(crate) snapshot_count: usize,
    pub(crate) duplicate_artifact_count: usize,
    pub(crate) top_duplicate_artifacts: Vec<MavenDuplicateArtifact>,
    pub(crate) repository_scan_status: RepositoryScanStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MavenDuplicateArtifact {
    pub(crate) coordinate: String,
    pub(crate) version_count: usize,
    pub(crate) versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryScanStatus {
    pub(crate) partial: bool,
    pub(crate) scanned_version_dirs: usize,
    pub(crate) skipped: usize,
    pub(crate) message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipEnvironmentHealth {
    pub(crate) python_version: String,
    pub(crate) python_executable: String,
    pub(crate) pip_version: String,
    pub(crate) environment_kind: PipEnvironmentKind,
    pub(crate) site_packages: Option<String>,
    pub(crate) user_site: Option<String>,
    pub(crate) installed_count: usize,
    pub(crate) outdated_count: usize,
    pub(crate) editable_count: usize,
    pub(crate) direct_url_count: usize,
    pub(crate) cache: PipCacheInfo,
    pub(crate) inspect_status: AsyncStatus,
    pub(crate) outdated_status: AsyncStatus,
    pub(crate) outdated_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum PipEnvironmentKind {
    System,
    User,
    VirtualEnv,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipCacheInfo {
    pub(crate) dir: Option<String>,
    pub(crate) raw_info: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipOutdatedPreview {
    pub(crate) status: AsyncStatus,
    pub(crate) command: CommandEnvelope,
    pub(crate) outdated: Vec<String>,
    pub(crate) message: Option<String>,
    pub(crate) failure: Option<CommandFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockerResourceHealth {
    pub(crate) image_count: usize,
    pub(crate) container_count: usize,
    pub(crate) running_container_count: usize,
    pub(crate) volume_count: usize,
    pub(crate) dangling_image_count: usize,
    pub(crate) unused_image_count: usize,
    pub(crate) disk_usage: Vec<DockerDiskUsageRow>,
    pub(crate) disk_usage_status: AsyncStatus,
    pub(crate) disk_usage_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockerDiskUsageRow {
    pub(crate) resource_type: String,
    pub(crate) total_count: String,
    pub(crate) active_count: String,
    pub(crate) size: String,
    pub(crate) reclaimable: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum AsyncStatus {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub(crate) enum ManagerId {
    Npm,
    Pnpm,
    Yarn,
    Nvm,
    Homebrew,
    Maven,
    Pip,
    Cargo,
    Docker,
    Bun,
    Uv,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) enum ManagerStatus {
    Ready,
    Missing,
    Unsupported,
    Partial,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagerScanSnapshot {
    pub(crate) scan_duration_ms: u128,
    pub(crate) manager: ManagerSnapshot,
}
