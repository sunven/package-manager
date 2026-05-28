import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { applyPipOutdatedPreview, shouldApplyHydrationResult } from "./state";

type ManagerId = "Npm" | "Pnpm" | "Yarn" | "Homebrew" | "Maven" | "Pip";
type ManagerStatus = "Ready" | "Missing" | "Unsupported" | "Partial" | "Failed";
type DiskUsageStatus = "Pending" | "Ready" | "Missing" | "PermissionDenied" | "Error";
type PathKind = "Cache" | "Store" | "GlobalModules" | "GlobalDir" | "Prefix" | "Cellar" | "Caskroom" | "LocalRepository" | "SitePackages" | "UserSite";
type PackageKind = "Generic" | "Formula" | "Cask" | "MavenArtifact" | "PythonDistribution";
type PackageSignal = "Outdated" | "Leaf" | "DuplicateVersions" | "Snapshot" | "Editable" | "UserSite" | "DirectUrl";
type AsyncStatus = "Pending" | "Ready" | "Failed";
type HomebrewFilter = "All" | "Formulae" | "Casks" | "Outdated" | "Leaves";
type MavenFilter = "All" | "Duplicates" | "Snapshots";
type PipFilter = "All" | "Outdated" | "Editable" | "UserSite" | "DirectUrl";
type FailureKind =
  | "MissingBinary"
  | "CommandFailed"
  | "ParseFailure"
  | "PermissionDenied"
  | "Timeout";

interface CommandEnvelope {
  program: string;
  args: string[];
  preview: string;
  timeoutMs: number;
}

interface CommandFailure {
  kind: FailureKind;
  message: string;
  command?: CommandEnvelope;
  stdout: string;
  stderr: string;
}

interface DiskUsage {
  status: DiskUsageStatus;
  bytes: number | null;
  human: string | null;
  files: number;
  directories: number;
  skipped: number;
  message: string | null;
}

interface PackageRow {
  name: string;
  version: string;
  path: string | null;
  source: string;
  kind: PackageKind;
  signals: PackageSignal[];
  actions: CommandEnvelope[];
}

interface PathInfo {
  label: string;
  kind: PathKind;
  path: string;
  size: DiskUsage;
}

interface ManagerSnapshot {
  id: ManagerId;
  label: string;
  status: ManagerStatus;
  version: string | null;
  packages: PackageRow[];
  paths: PathInfo[];
  commands: CommandEnvelope[];
  failures: CommandFailure[];
  unsupportedReason: string | null;
  homebrew: HomebrewMaintenance | null;
  maven: MavenRepositoryHealth | null;
  pip: PipEnvironmentHealth | null;
}

interface HomebrewMaintenance {
  formulaCount: number;
  caskCount: number;
  outdatedCount: number;
  leafCount: number;
  outdated: string[];
  leaves: string[];
  cleanup: HomebrewCleanupPreview;
}

interface HomebrewCleanupPreview {
  status: AsyncStatus;
  command: CommandEnvelope;
  rawOutput: string;
  reclaimedBytes: number | null;
  reclaimedHuman: string | null;
  message: string | null;
  failure: CommandFailure | null;
}

interface MavenRepositoryHealth {
  localRepository: string;
  artifactCount: number;
  versionCount: number;
  snapshotCount: number;
  duplicateArtifactCount: number;
  topDuplicateArtifacts: MavenDuplicateArtifact[];
  repositoryScanStatus: RepositoryScanStatus;
}

interface MavenDuplicateArtifact {
  coordinate: string;
  versionCount: number;
  versions: string[];
}

interface RepositoryScanStatus {
  partial: boolean;
  scannedVersionDirs: number;
  skipped: number;
  message: string | null;
}

interface PipEnvironmentHealth {
  pythonVersion: string;
  pythonExecutable: string;
  pipVersion: string;
  environmentKind: "System" | "User" | "VirtualEnv" | "Unknown";
  sitePackages: string | null;
  userSite: string | null;
  installedCount: number;
  outdatedCount: number;
  editableCount: number;
  directUrlCount: number;
  cache: PipCacheInfo;
  inspectStatus: AsyncStatus;
  outdatedStatus: AsyncStatus;
  outdatedMessage: string | null;
}

interface PipCacheInfo {
  dir: string | null;
  rawInfo: string;
}

interface PipOutdatedPreview {
  status: AsyncStatus;
  command: CommandEnvelope;
  outdated: string[];
  message: string | null;
  failure: CommandFailure | null;
}

interface ManagerScanSnapshot {
  scanDurationMs: number;
  manager: ManagerSnapshot;
}

type MessageTone = "bad" | "ok" | "warn";
type DisplayStatus = ManagerStatus | DiskUsageStatus | AsyncStatus | "Scanning" | "Not scanned" | "neutral";

interface UiMessage {
  tone: MessageTone;
  title: string;
  message: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App container missing");
}

const managerOrder: ManagerId[] = ["Npm", "Pnpm", "Yarn", "Homebrew", "Maven", "Pip"];
const managerLabels: Record<ManagerId, string> = {
  Npm: "npm",
  Pnpm: "pnpm",
  Yarn: "Yarn",
  Homebrew: "Homebrew",
  Maven: "Maven",
  Pip: "pip",
};
const statusLabels: Record<DisplayStatus, string> = {
  Ready: "就绪",
  Missing: "未安装",
  Unsupported: "不支持",
  Partial: "部分可用",
  Failed: "失败",
  Pending: "等待中",
  PermissionDenied: "无权限",
  Error: "错误",
  Scanning: "扫描中",
  "Not scanned": "未扫描",
  neutral: "未扫描",
};
const pathKindLabels: Record<PathKind, string> = {
  Cache: "缓存",
  Store: "存储",
  GlobalModules: "全局模块",
  GlobalDir: "全局目录",
  Prefix: "安装前缀",
  Cellar: "软件目录",
  Caskroom: "应用目录",
  LocalRepository: "本地仓库",
  SitePackages: "站点包目录",
  UserSite: "用户站点包目录",
};
const packageKindLabels: Record<PackageKind, string> = {
  Generic: "通用",
  Formula: "配方包",
  Cask: "应用包",
  MavenArtifact: "Maven 构件",
  PythonDistribution: "Python 包",
};
const signalLabels: Record<PackageSignal, string> = {
  Outdated: "可更新",
  Leaf: "叶子包",
  DuplicateVersions: "多版本",
  Snapshot: "快照版",
  Editable: "可编辑安装",
  UserSite: "用户目录",
  DirectUrl: "直接链接",
};
const homebrewFilterLabels: Record<HomebrewFilter, string> = {
  All: "全部",
  Formulae: "配方包",
  Casks: "应用包",
  Outdated: "可更新",
  Leaves: "叶子包",
};
const mavenFilterLabels: Record<MavenFilter, string> = {
  All: "全部",
  Duplicates: "多版本",
  Snapshots: "快照版",
};
const pipFilterLabels: Record<PipFilter, string> = {
  All: "全部",
  Outdated: "可更新",
  Editable: "可编辑安装",
  UserSite: "用户目录",
  DirectUrl: "直接链接",
};
const environmentKindLabels: Record<PipEnvironmentHealth["environmentKind"], string> = {
  System: "系统环境",
  User: "用户环境",
  VirtualEnv: "虚拟环境",
  Unknown: "未知环境",
};
const failureKindLabels: Record<FailureKind, string> = {
  MissingBinary: "命令缺失",
  CommandFailed: "命令失败",
  ParseFailure: "解析失败",
  PermissionDenied: "无权限",
  Timeout: "超时",
};

let managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>> = {};
let scanDurationMsByManager: Partial<Record<ManagerId, number>> = {};
let selectedManager: ManagerId = "Npm";
let selectedPackageIndex = 0;
let openPackageActionMenuIndex: number | null = null;
let selectedHomebrewFilter: HomebrewFilter = "All";
let selectedMavenFilter: MavenFilter = "All";
let selectedPipFilter: PipFilter = "All";
let lastCopied = "";
let scanningManagers = new Set<ManagerId>();
let sizeScanTokens: Record<ManagerId, number> = { Npm: 0, Pnpm: 0, Yarn: 0, Homebrew: 0, Maven: 0, Pip: 0 };
let pendingSizeScansByManager: Record<ManagerId, number> = { Npm: 0, Pnpm: 0, Yarn: 0, Homebrew: 0, Maven: 0, Pip: 0 };
let homebrewCleanupToken = 0;
let pendingHomebrewCleanup = false;
let pipOutdatedToken = 0;
let pendingPipOutdated = false;
let uiMessage: UiMessage | null = null;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div>
        <h1>包管理器控制中心</h1>
        <p class="lede">查看 npm、pnpm、Yarn Classic、Homebrew、Maven 和 pip 的本机包、缓存/仓库位置和维护信号。所有危险操作只复制命令，不直接执行。</p>
      </div>
      <div class="topbar-actions">
        <button id="refresh-button" data-action="refresh" class="primary" type="button">刷新扫描</button>
        <div class="meta" id="scan-meta"></div>
      </div>
    </header>

    <section class="message" id="app-message" hidden></section>
    <section class="overview" id="overview"></section>
    <section class="managers" id="manager-tabs"></section>

    <section class="workspace">
      <div class="panel list-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">软件包</p>
            <h2 id="manager-title">包管理器</h2>
          </div>
          <div class="pill" id="manager-status"></div>
        </div>
        <div class="table" id="package-table"></div>
      </div>

      <div class="sidecol">
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">路径</p>
              <h2>缓存 / 存储</h2>
            </div>
          </div>
          <div id="path-list"></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">诊断</p>
              <h2>失败记录</h2>
            </div>
          </div>
          <div id="failure-list"></div>
        </div>
      </div>
    </section>
  </div>
`;

const overviewEl = must("#overview");
const managerTabsEl = must("#manager-tabs");
const managerTitleEl = must("#manager-title");
const managerStatusEl = must("#manager-status");
const packageTableEl = must("#package-table");
const pathListEl = must("#path-list");
const failureListEl = must("#failure-list");
const scanMetaEl = must("#scan-meta");
const appMessageEl = must<HTMLElement>("#app-message");
const refreshButtonEl = must<HTMLButtonElement>("#refresh-button");

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
  if (!target) {
    closePackageActionMenu();
    return;
  }

  void handleAction(target);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePackageActionMenu();
  }
});

async function handleAction(target: HTMLElement) {
  const action = target.dataset.action;
  const manager = currentManager();

  try {
    if (action === "refresh") {
      await refresh(selectedManager);
      return;
    }

    if (action === "manager-tab" && target.dataset.manager) {
      const managerId = target.dataset.manager as ManagerId;
      selectedManager = managerId;
      selectedPackageIndex = 0;
      openPackageActionMenuIndex = null;
      render();
      if (!managerSnapshots[managerId] && !scanningManagers.has(managerId)) {
        void refresh(managerId);
      }
      return;
    }

    if (action === "homebrew-filter" && target.dataset.filter) {
      selectedHomebrewFilter = target.dataset.filter as HomebrewFilter;
      selectedPackageIndex = 0;
      openPackageActionMenuIndex = null;
      render();
      return;
    }

    if (action === "maven-filter" && target.dataset.filter) {
      selectedMavenFilter = target.dataset.filter as MavenFilter;
      selectedPackageIndex = 0;
      openPackageActionMenuIndex = null;
      render();
      return;
    }

    if (action === "pip-filter" && target.dataset.filter) {
      selectedPipFilter = target.dataset.filter as PipFilter;
      selectedPackageIndex = 0;
      openPackageActionMenuIndex = null;
      render();
      return;
    }

    if (action === "select-package" && target.dataset.index) {
      selectedPackageIndex = Number(target.dataset.index);
      openPackageActionMenuIndex = null;
      render();
      return;
    }

    if (action === "toggle-package-actions" && target.dataset.index) {
      const index = Number(target.dataset.index);
      openPackageActionMenuIndex = openPackageActionMenuIndex === index ? null : index;
      render();
      return;
    }

    if (action === "copy-path" && target.dataset.path) {
      await writeText(target.dataset.path);
      markCopied(target.dataset.path);
      return;
    }

    if (action === "open-path" && target.dataset.path) {
      await openPath(target.dataset.path);
      clearMessage();
      return;
    }

    if (action === "copy-command" && target.dataset.command) {
      await writeText(target.dataset.command);
      markCopied("命令详情");
      return;
    }

    if (action === "copy-cleanup-command") {
      const cleanup = manager?.homebrew?.cleanup;
      if (cleanup) {
        await writeText(cleanup.command.preview);
        markCopied(cleanup.command.preview);
      }
      return;
    }

    if (action === "copy-package-action" && manager) {
      const pkg = packageFromTarget(target);
      const actionIndex = Number(target.dataset.actionIndex);
      const packageAction = Number.isNaN(actionIndex) ? null : pkg?.actions[actionIndex];
      if (packageAction) {
        await writeText(packageAction.preview);
        openPackageActionMenuIndex = null;
        markCopied(packageAction.preview);
        renderWorkspace();
      }
      return;
    }

    if (action === "copy-package" && manager) {
      const pkg = packageFromTarget(target);
      if (pkg) {
        await writeText(`${pkg.name}@${pkg.version}`);
        openPackageActionMenuIndex = null;
        markCopied(`${pkg.name}@${pkg.version}`);
        renderWorkspace();
      }
      return;
    }

    if (action === "open-package") {
      const pkg = packageFromTarget(target);
      if (pkg?.path) {
        await openPath(pkg.path);
        openPackageActionMenuIndex = null;
        clearMessage();
        renderWorkspace();
      }
    }
  } catch (error) {
    showError(actionFailureTitle(action), error);
  }
}

async function refresh(managerId: ManagerId) {
  if (scanningManagers.has(managerId)) return;

  scanningManagers.add(managerId);
  sizeScanTokens[managerId] += 1;
  if (managerId === "Homebrew") {
    homebrewCleanupToken += 1;
    pendingHomebrewCleanup = false;
  }
  if (managerId === "Pip") {
    pipOutdatedToken += 1;
    pendingPipOutdated = false;
  }
  pendingSizeScansByManager[managerId] = 0;
  uiMessage = null;
  render();

  try {
    const result = await invoke<ManagerScanSnapshot>("scan_manager", { manager: managerId });
    managerSnapshots[result.manager.id] = result.manager;
    scanDurationMsByManager[result.manager.id] = result.scanDurationMs;
    if (result.manager.id === selectedManager && selectedPackageIndex >= result.manager.packages.length) {
      selectedPackageIndex = 0;
    }
    void hydratePathSizes(result.manager.id, sizeScanTokens[result.manager.id]);
    if (result.manager.id === "Homebrew" && result.manager.homebrew?.cleanup.status === "Pending") {
      void hydrateHomebrewCleanup(homebrewCleanupToken);
    }
    if (result.manager.id === "Pip" && result.manager.pip?.outdatedStatus === "Pending") {
      void hydratePipOutdated(pipOutdatedToken, result.manager.pip.pythonExecutable);
    }
  } catch (error) {
    if (managerId === selectedManager) showError(`${managerLabel(managerId)} 扫描失败`, error);
  } finally {
    scanningManagers.delete(managerId);
    render();
  }
}

async function hydratePipOutdated(token: number, pythonExecutable: string) {
  pendingPipOutdated = true;
  renderMeta();

  try {
    const preview = await invoke<PipOutdatedPreview>("hydrate_pip_outdated", { pythonExecutable });
    const manager = managerSnapshots.Pip;
    if (!shouldApplyHydrationResult(token, pipOutdatedToken) || !manager?.pip) return;
    applyPipOutdatedPreview(manager, preview);
  } catch (error) {
    const manager = managerSnapshots.Pip;
    if (!shouldApplyHydrationResult(token, pipOutdatedToken) || !manager?.pip) return;
    const failedPreview: PipOutdatedPreview = {
      status: "Failed",
      command: {
        program: pythonExecutable,
        args: ["-m", "pip", "list", "--outdated", "--format=json"],
        preview: `${pythonExecutable} -m pip list --outdated --format=json`,
        timeoutMs: 30000,
      },
      outdated: [],
      message: errorToString(error),
      failure: null,
    };
    applyPipOutdatedPreview(manager, failedPreview);
  } finally {
    if (shouldApplyHydrationResult(token, pipOutdatedToken)) {
      pendingPipOutdated = false;
      render();
    }
  }
}

async function hydrateHomebrewCleanup(token: number) {
  pendingHomebrewCleanup = true;
  renderMeta();

  try {
    const cleanup = await invoke<HomebrewCleanupPreview>("hydrate_homebrew_cleanup");
    const manager = managerSnapshots.Homebrew;
    if (token !== homebrewCleanupToken || !manager?.homebrew) return;
    manager.homebrew.cleanup = cleanup;
  } catch (error) {
    const manager = managerSnapshots.Homebrew;
    if (token !== homebrewCleanupToken || !manager?.homebrew) return;
    manager.homebrew.cleanup = {
      status: "Failed",
      command: manager.homebrew.cleanup.command,
      rawOutput: "",
      reclaimedBytes: null,
      reclaimedHuman: null,
      message: errorToString(error),
      failure: null,
    };
  } finally {
    if (token === homebrewCleanupToken) {
      pendingHomebrewCleanup = false;
      render();
    }
  }
}

async function hydratePathSizes(managerId: ManagerId, token: number) {
  const activeManager = managerSnapshots[managerId];
  if (!activeManager) return;

  const paths = activeManager.paths;
  pendingSizeScansByManager[managerId] = paths.filter((path) => path.size.status === "Pending").length;
  renderMeta();

  await Promise.all(
    paths.map(async (pathInfo) => {
      if (pathInfo.size.status !== "Pending") return;

      try {
        const size = await invoke<DiskUsage>("measure_path_size", { path: pathInfo.path });
        if (token !== sizeScanTokens[managerId] || managerSnapshots[managerId] !== activeManager) return;
        pathInfo.size = size;
      } catch (error) {
        if (token !== sizeScanTokens[managerId] || managerSnapshots[managerId] !== activeManager) return;
        pathInfo.size = sizeScanError(error);
      } finally {
        if (token === sizeScanTokens[managerId] && managerSnapshots[managerId] === activeManager) {
          pendingSizeScansByManager[managerId] = Math.max(0, pendingSizeScansByManager[managerId] - 1);
          render();
        }
      }
    }),
  );
}

function render() {
  renderOverview();
  renderManagers();
  renderWorkspace();
  renderMessage();
  renderMeta();
  renderControls();
}

function renderOverview() {
  const managers = scannedManagers();
  const totalBytes = managers.reduce((sum, manager) => {
    return (
      sum +
      manager.paths.reduce((pathSum, path) => {
        return countedSizePath(path.kind)
          ? pathSum + (path.size.bytes ?? 0)
          : pathSum;
      }, 0)
    );
  }, 0);

  const totalPackages = managers.reduce((sum, manager) => sum + manager.packages.length, 0);
  const readyManagers = managers.filter((manager) => manager.status === "Ready").length;
  const unsupported = managers.filter((manager) => manager.status === "Unsupported").length;

  overviewEl.innerHTML = `
    ${statCard("管理器", `${managers.length}/${managerOrder.length}`)}
    ${statCard("已就绪", String(readyManagers))}
    ${statCard("软件包", String(totalPackages))}
    ${statCard("总占用", formatBytes(totalBytes))}
    ${statCard("不支持", String(unsupported))}
  `;
}

function renderManagers() {
  managerTabsEl.innerHTML = managerOrder
    .map((managerId) => {
      const manager = managerSnapshots[managerId];
      const active = managerId === selectedManager ? "active" : "";
      const scanning = scanningManagers.has(managerId);
      const status = scanning ? "Scanning" : manager?.status ?? "Not scanned";
      const statusClassName = scanning ? "partial" : statusClass(manager?.status ?? "neutral");
      return `
        <button class="tab ${active}" data-action="manager-tab" data-manager="${managerId}">
          <span>${manager?.label ?? managerLabel(managerId)}</span>
          <span class="tab-status ${statusClassName}">${statusLabel(status)}</span>
        </button>
      `;
    })
    .join("");
}

function renderWorkspace() {
  const manager = currentManager();
  const scanning = scanningManagers.has(selectedManager);
  managerTitleEl.textContent = manager
    ? `${manager.label}${manager.version ? ` ${manager.version}` : ""}`
    : managerLabel(selectedManager);
  managerStatusEl.textContent = statusLabel(scanning ? "Scanning" : manager?.status ?? "Not scanned");
  managerStatusEl.className = `pill ${scanning ? "partial" : statusClass(manager?.status ?? "neutral")}`;
  packageTableEl.innerHTML = renderPackageTable(manager);
  pathListEl.innerHTML = renderPathList(manager);
  failureListEl.innerHTML = renderFailures(manager);
}

function renderPackageTable(manager: ManagerSnapshot | null) {
  if (!manager) {
    return emptyState(scanningManagers.has(selectedManager) ? "正在扫描软件包..." : "尚未扫描");
  }

  if (manager.id === "Homebrew") {
    return renderHomebrewPackageTable(manager);
  }

  if (manager.id === "Maven") {
    return renderMavenPackageTable(manager);
  }

  if (manager.id === "Pip") {
    return renderPipPackageTable(manager);
  }

  if (manager.status === "Unsupported") {
    return `
      <div class="empty">
        <p class="empty-title">Yarn 现代版本不提供全局软件包列表。</p>
        <p>${escapeHtml(displayMessage(manager.unsupportedReason ?? "当前状态不支持扫描"))}</p>
      </div>
    `;
  }

  if (!manager.packages.length) {
    return emptyState("未找到全局软件包");
  }

  return `
    <div class="table-head">
      <span>名称</span>
      <span>版本</span>
      <span>来源</span>
      <span>路径</span>
      <span>操作</span>
    </div>
    ${manager.packages
      .map((pkg, index) => {
        const active = index === selectedPackageIndex ? "selected" : "";
        return `
          <div class="row ${active}" data-action="select-package" data-index="${index}">
            <span class="cell strong">${escapeHtml(pkg.name)}</span>
            <span class="cell">${escapeHtml(pkg.version)}</span>
            <span class="cell muted">${escapeHtml(shorten(pkg.source))}</span>
            <span class="cell muted">${escapeHtml(pkg.path ?? "无")}</span>
            <span class="cell action-cell">
              ${renderPackageActions(pkg, index)}
            </span>
          </div>
        `;
      })
      .join("")}
  `;
}

function renderPathList(manager: ManagerSnapshot | null) {
  if (!manager) {
    return emptyState(scanningManagers.has(selectedManager) ? "正在扫描路径..." : "尚未扫描");
  }

  const paths = manager.paths.length
    ? manager.paths
    .map((path) => {
      const size = path.size;
      const openDisabled = size.status === "Missing" ? "disabled" : "";
      const detail =
        size.status === "Pending"
          ? `<span>等待占用扫描</span>`
          : `
            <span>${size.files} 个文件</span>
            <span>${size.directories} 个目录</span>
            <span>跳过 ${size.skipped} 项</span>
          `;
      return `
        <div class="path-card">
          <div class="path-main">
            <div>
              <p class="path-label">${escapeHtml(pathLabel(path.label))}</p>
              <p class="path-kind">${escapeHtml(pathKindLabel(path.kind))}</p>
            </div>
            <div class="size-badge ${statusClass(size.status)}">
              ${size.human ?? statusLabel(size.status)}
            </div>
          </div>
          <code class="path-value">${escapeHtml(path.path)}</code>
          <div class="path-detail">
            ${detail}
          </div>
          ${size.message ? `<p class="path-message">${escapeHtml(displayMessage(size.message))}</p>` : ""}
          <div class="path-actions">
            <button class="ghost" data-action="copy-path" data-path="${escapeHtmlAttr(path.path)}" type="button">复制路径</button>
            <button class="ghost" data-action="open-path" data-path="${escapeHtmlAttr(path.path)}" type="button" ${openDisabled}>打开</button>
          </div>
        </div>
      `;
    })
    .join("")
    : emptyState("未解析到缓存或存储路径");

  return `
    ${manager.id === "Homebrew" ? renderHomebrewCleanup(manager.homebrew) : ""}
    ${paths}
    ${renderCommandList(manager)}
  `;
}

function renderHomebrewCleanup(maintenance: HomebrewMaintenance | null) {
  if (!maintenance) return "";

  const cleanup = maintenance.cleanup;
  const status = pendingHomebrewCleanup && cleanup.status === "Pending" ? "Pending" : cleanup.status;
  const body =
    cleanup.status === "Ready"
      ? cleanup.rawOutput
        ? `<pre>${escapeHtml(trimTail(cleanup.rawOutput, 10))}</pre>`
        : `<p class="path-message">清理预演已完成，没有输出。</p>`
      : cleanup.status === "Failed"
        ? `<p class="path-message">${escapeHtml(displayMessage(cleanup.message ?? "清理预演失败"))}</p>${cleanup.rawOutput ? `<pre>${escapeHtml(trimTail(cleanup.rawOutput, 10))}</pre>` : ""}`
        : `<p class="path-message">清理预演正在后台加载，以便 Homebrew 页签先快速显示。</p>`;

  return `
    <div class="cleanup-card">
      <div class="path-main">
        <div>
          <p class="path-label">清理预演</p>
          <p class="path-kind">仅预览，不会删除文件</p>
        </div>
        <div class="size-badge ${statusClass(status)}">
          ${cleanup.reclaimedHuman ?? statusLabel(status)}
        </div>
      </div>
      <code class="path-value">${escapeHtml(cleanup.command.preview)}</code>
      ${body}
      <div class="path-actions">
        <button class="ghost" data-action="copy-cleanup-command" type="button">复制预演命令</button>
      </div>
    </div>
  `;
}

function renderCommandList(manager: ManagerSnapshot) {
  if (!manager.commands.length) return "";

  return `
    <div class="command-list">
      <p class="path-label">扫描命令</p>
      ${manager.commands
        .map((command) => {
          const payload = JSON.stringify({ preview: command.preview, envelope: command }, null, 2);
          return `
            <div class="command-row">
              <code>${escapeHtml(command.preview)}</code>
              <button class="ghost" data-action="copy-command" data-command="${escapeHtmlAttr(payload)}" type="button">复制</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderFailures(manager: ManagerSnapshot | null) {
  if (!manager) return emptyState("尚未扫描");
  if (!manager.failures.length) return emptyState("没有失败记录");

  return manager.failures
    .map(
      (failure) => `
        <div class="failure">
          <div class="failure-head">
            <span class="pill ${statusClass("Failed")}">${failureKindLabel(failure.kind)}</span>
            <span class="failure-message">${escapeHtml(displayMessage(failure.message))}</span>
          </div>
          ${failure.command ? `<code>${escapeHtml(failure.command.preview)}</code>` : ""}
          ${failure.stderr ? `<pre>${escapeHtml(trimTail(failure.stderr))}</pre>` : ""}
        </div>
      `,
    )
    .join("");
}

function renderMeta() {
  const parts: string[] = [];
  const pendingSizeScans = pendingSizeScansByManager[selectedManager];
  const scanDurationMs = scanDurationMsByManager[selectedManager];
  if (scanningManagers.has(selectedManager)) parts.push(`正在扫描 ${managerLabel(selectedManager)}...`);
  if (pendingSizeScans > 0) parts.push(`正在统计 ${pendingSizeScans} 个路径...`);
  if (selectedManager === "Homebrew" && pendingHomebrewCleanup) parts.push("正在加载清理预演...");
  if (selectedManager === "Pip" && pendingPipOutdated) parts.push("正在检查 pip 可更新包...");
  if (scanDurationMs !== undefined) parts.push(`扫描耗时 ${scanDurationMs} 毫秒`);
  if (lastCopied) parts.push(`已复制 ${lastCopied}`);
  scanMetaEl.textContent = parts.join(" · ");
}

function renderControls() {
  const scanning = scanningManagers.has(selectedManager);
  refreshButtonEl.disabled = scanning;
  refreshButtonEl.textContent = scanning ? `正在扫描 ${managerLabel(selectedManager)}...` : `刷新 ${managerLabel(selectedManager)}`;
}

function renderMessage() {
  if (!uiMessage) {
    appMessageEl.hidden = true;
    appMessageEl.innerHTML = "";
    return;
  }

  appMessageEl.hidden = false;
  appMessageEl.className = `message ${uiMessage.tone}`;
  appMessageEl.innerHTML = `
    <strong>${escapeHtml(uiMessage.title)}</strong>
    <span>${escapeHtml(displayMessage(uiMessage.message))}</span>
  `;
}

function markCopied(value: string) {
  lastCopied = value;
  clearMessage();
  renderMeta();
}

function clearMessage() {
  if (!uiMessage) return;
  uiMessage = null;
  renderMessage();
}

function showError(title: string, error: unknown) {
  uiMessage = {
    tone: "bad",
    title,
    message: errorToString(error),
  };
  renderMessage();
  renderMeta();
}

function currentManager(): ManagerSnapshot | null {
  return managerSnapshots[selectedManager] ?? null;
}

function packageFromTarget(target: HTMLElement): PackageRow | null {
  const index = Number(target.dataset.index);
  const manager = currentManager();
  if (!manager || Number.isNaN(index)) return null;
  return manager.packages[index] ?? null;
}

function statCard(label: string, value: string) {
  return `
    <div class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function scannedManagers() {
  return managerOrder.flatMap((managerId) => {
    const manager = managerSnapshots[managerId];
    return manager ? [manager] : [];
  });
}

function managerLabel(managerId: ManagerId) {
  return managerLabels[managerId];
}

function statusLabel(status: DisplayStatus) {
  return statusLabels[status];
}

function pathKindLabel(kind: PathKind) {
  return pathKindLabels[kind];
}

function packageKindLabel(kind: PackageKind) {
  return packageKindLabels[kind];
}

function signalLabel(signal: PackageSignal) {
  return signalLabels[signal];
}

function homebrewFilterLabel(filter: HomebrewFilter) {
  return homebrewFilterLabels[filter];
}

function mavenFilterLabel(filter: MavenFilter) {
  return mavenFilterLabels[filter];
}

function pipFilterLabel(filter: PipFilter) {
  return pipFilterLabels[filter];
}

function environmentKindLabel(kind: PipEnvironmentHealth["environmentKind"]) {
  return environmentKindLabels[kind];
}

function failureKindLabel(kind: FailureKind) {
  return failureKindLabels[kind];
}

function pathLabel(label: string) {
  const pathLabels: Record<string, string> = {
    Cache: "缓存",
    "Cache folder": "缓存文件夹",
    Store: "存储",
    "Global modules": "全局模块",
    "Global dir": "全局目录",
    Prefix: "安装前缀",
    Cellar: "软件目录",
    Caskroom: "应用目录",
    "Local repository": "本地仓库",
    "pip cache": "pip 缓存",
    "site-packages": "site-packages",
    "User site": "用户 site-packages",
  };
  return pathLabels[label] ?? label;
}

function displayMessage(message: string) {
  return message
    .replace("Yarn 2+ does not expose a global package list equivalent to npm, pnpm, or Yarn Classic.", "Yarn 2+ 没有提供等同于 npm、pnpm 或 Yarn Classic 的全局软件包列表。")
    .replace("Outdated scan pending", "可更新包扫描等待中")
    .replace("Cleanup dry-run pending", "清理预演等待中")
    .replace("Size scan pending", "占用扫描等待中")
    .replace("Path does not exist", "路径不存在")
    .replace("Repository scan reached time limit", "仓库扫描已达到时间限制")
    .replace("Repository scan reached version directory limit", "仓库扫描已达到版本目录数量限制")
    .replace("Repository scan reached row limit", "仓库扫描已达到结果数量限制")
    .replace("Package manager scan failed:", "包管理器扫描失败：")
    .replace("Size scan failed:", "占用扫描失败：")
    .replace("Homebrew cleanup dry-run failed:", "Homebrew 清理预演失败：")
    .replace("pip outdated hydration failed:", "pip 可更新包扫描失败：")
    .replace("npm version probe failed", "npm 版本检测失败")
    .replace("npm global package list failed", "npm 全局软件包列表获取失败")
    .replace("pnpm version probe failed", "pnpm 版本检测失败")
    .replace("pnpm global package list failed", "pnpm 全局软件包列表获取失败")
    .replace("Yarn version probe failed", "Yarn 版本检测失败")
    .replace("Yarn global package list failed", "Yarn 全局软件包列表获取失败")
    .replace("Maven version probe failed", "Maven 版本检测失败")
    .replace("Python version probe failed", "Python 版本检测失败")
    .replace("Python executable probe failed", "Python 可执行文件检测失败")
    .replace("pip version probe failed", "pip 版本检测失败")
    .replace("pip package list failed", "pip 软件包列表获取失败")
    .replace("pip cache dir failed", "pip 缓存目录获取失败")
    .replace("pip cache info failed", "pip 缓存信息获取失败")
    .replace("pip inspect failed", "pip 检查失败")
    .replace("pip outdated failed", "pip 可更新包扫描失败")
    .replace("Homebrew version probe failed", "Homebrew 版本检测失败")
    .replace("Homebrew formula list failed", "Homebrew 配方包列表获取失败")
    .replace("Homebrew cask list failed", "Homebrew 应用包列表获取失败")
    .replace("Homebrew outdated scan failed", "Homebrew 可更新包扫描失败")
    .replace("Homebrew leaves scan failed", "Homebrew 叶子包扫描失败")
    .replace("Homebrew prefix lookup failed", "Homebrew 安装前缀查询失败")
    .replace("Homebrew cache lookup failed", "Homebrew 缓存查询失败")
    .replace("Homebrew cellar lookup failed", "Homebrew 软件目录查询失败")
    .replace("Homebrew cleanup dry-run failed", "Homebrew 清理预演失败")
    .replace("Could not parse Yarn version:", "无法解析 Yarn 版本：")
    .replace("Could not read output from", "无法读取命令输出：")
    .replace("exceeded the configured timeout", "超过配置的超时时间")
    .replace("Could not wait for", "无法等待命令完成：")
    .replace("is not installed or is not on PATH", "未安装，或不在 PATH 中")
    .replace("python3 and python are not installed or are not on PATH", "python3 和 python 均未安装，或不在 PATH 中")
    .replace("Permission denied while running", "运行命令时权限被拒绝：")
    .replace("Could not run", "无法运行命令：");
}

function emptyState(message: string) {
  return `<div class="empty"><p class="empty-title">${message}</p></div>`;
}

function statusClass(status: string) {
  switch (status) {
    case "Ready":
      return "ok";
    case "Unsupported":
      return "warn";
    case "Missing":
    case "Failed":
    case "PermissionDenied":
    case "Error":
      return "bad";
    case "Pending":
    case "Partial":
      return "partial";
    default:
      return "neutral";
  }
}

function countedSizePath(kind: PathKind) {
  return kind === "Cache" || kind === "Store" || kind === "Cellar" || kind === "Caskroom" || kind === "LocalRepository";
}

function actionLabel(action: CommandEnvelope) {
  const [firstArg, secondArg] = action.args;
  const command = action.args.join(" ");
  if (command.includes("dependency:get")) return "复制获取依赖命令";
  if (command.includes("dependency:tree")) return "复制依赖树命令";
  if (command.includes("pip show")) return "复制查看命令";
  if (command.includes("pip install --upgrade")) return "复制升级命令";
  if (command.includes("pip uninstall")) return "复制卸载命令";
  if (firstArg === "upgrade" && secondArg === "--cask") return "复制应用包升级命令";
  if (firstArg === "upgrade") return "复制升级命令";
  if (firstArg === "uses") return "复制反向依赖命令";
  if (firstArg === "info") return "复制信息命令";
  return "复制命令";
}

function renderHomebrewPackageTable(manager: ManagerSnapshot) {
  const maintenance = manager.homebrew;
  const filteredPackages = filteredHomebrewPackages(manager);

  return `
    ${renderHomebrewSummary(maintenance)}
    ${renderHomebrewFilters()}
    ${
      filteredPackages.length
        ? `
          <div class="table-head homebrew-head">
            <span>名称</span>
            <span>版本</span>
            <span>信号</span>
            <span>路径</span>
            <span>操作</span>
          </div>
          ${filteredPackages
            .map(({ pkg, index }) => {
              const active = index === selectedPackageIndex ? "selected" : "";
              return `
                <div class="row homebrew-row ${active}" data-action="select-package" data-index="${index}">
                  <span class="cell strong">
                    ${escapeHtml(pkg.name)}
                    <span class="kind-tag">${escapeHtml(packageKindLabel(pkg.kind))}</span>
                  </span>
                  <span class="cell">${escapeHtml(pkg.version)}</span>
                  <span class="cell signal-cell">${renderPackageSignals(pkg)}</span>
                  <span class="cell muted">${escapeHtml(pkg.path ?? "无")}</span>
                  <span class="cell action-cell">
                    ${renderPackageActions(pkg, index)}
                  </span>
                </div>
              `;
            })
            .join("")}
        `
        : emptyState("没有匹配当前筛选条件的 Homebrew 软件包")
    }
  `;
}

function renderMavenPackageTable(manager: ManagerSnapshot) {
  const health = manager.maven;
  const filteredPackages = filteredMavenPackages(manager);

  return `
    ${renderMavenSummary(health)}
    ${renderMavenFilters()}
    ${
      filteredPackages.length
        ? `
          <div class="table-head homebrew-head">
            <span>坐标</span>
            <span>版本</span>
            <span>信号</span>
            <span>路径</span>
            <span>操作</span>
          </div>
          ${filteredPackages
            .map(({ pkg, index }) => {
              const active = index === selectedPackageIndex ? "selected" : "";
              return `
                <div class="row homebrew-row ${active}" data-action="select-package" data-index="${index}">
                  <span class="cell strong">
                    ${escapeHtml(pkg.name)}
                    <span class="kind-tag">${escapeHtml(packageKindLabel(pkg.kind))}</span>
                  </span>
                  <span class="cell">${escapeHtml(pkg.version)}</span>
                  <span class="cell signal-cell">${renderPackageSignals(pkg)}</span>
                  <span class="cell muted">${escapeHtml(pkg.path ?? "无")}</span>
                  <span class="cell action-cell">
                    ${renderPackageActions(pkg, index)}
                  </span>
                </div>
              `;
            })
            .join("")}
        `
        : emptyState("没有匹配当前筛选条件的 Maven 构件")
    }
  `;
}

function renderPipPackageTable(manager: ManagerSnapshot) {
  const health = manager.pip;
  const filteredPackages = filteredPipPackages(manager);

  return `
    ${renderPipSummary(health)}
    ${renderPipFilters()}
    ${
      filteredPackages.length
        ? `
          <div class="table-head homebrew-head">
            <span>名称</span>
            <span>版本</span>
            <span>信号</span>
            <span>位置</span>
            <span>操作</span>
          </div>
          ${filteredPackages
            .map(({ pkg, index }) => {
              const active = index === selectedPackageIndex ? "selected" : "";
              return `
                <div class="row homebrew-row ${active}" data-action="select-package" data-index="${index}">
                  <span class="cell strong">
                    ${escapeHtml(pkg.name)}
                    <span class="kind-tag">${escapeHtml(packageKindLabel(pkg.kind))}</span>
                  </span>
                  <span class="cell">${escapeHtml(pkg.version)}</span>
                  <span class="cell signal-cell">${renderPackageSignals(pkg)}</span>
                  <span class="cell muted">${escapeHtml(pkg.path ?? "无")}</span>
                  <span class="cell action-cell">
                    ${renderPackageActions(pkg, index)}
                  </span>
                </div>
              `;
            })
            .join("")}
        `
        : emptyState("没有匹配当前筛选条件的 pip 软件包")
    }
  `;
}

function renderHomebrewSummary(maintenance: HomebrewMaintenance | null) {
  if (!maintenance) return "";

  const cleanup = maintenance.cleanup;
  const cleanupValue =
    cleanup.status === "Ready"
      ? cleanup.reclaimedHuman ?? statusLabel("Ready")
      : cleanup.status === "Pending"
        ? statusLabel("Pending")
        : statusLabel("Failed");

  return `
    <div class="homebrew-summary">
      ${statCard("配方包", String(maintenance.formulaCount))}
      ${statCard("应用包", String(maintenance.caskCount))}
      ${statCard("可更新", String(maintenance.outdatedCount))}
      ${statCard("叶子包", String(maintenance.leafCount))}
      ${statCard("清理", cleanupValue)}
    </div>
  `;
}

function renderMavenSummary(health: MavenRepositoryHealth | null) {
  if (!health) return "";
  const scanStatus = health.repositoryScanStatus.partial ? "Partial" : "Ready";

  return `
    <div class="homebrew-summary">
      ${statCard("构件", String(health.artifactCount))}
      ${statCard("版本", String(health.versionCount))}
      ${statCard("快照版", String(health.snapshotCount))}
      ${statCard("多版本", String(health.duplicateArtifactCount))}
      ${statCard("扫描", statusLabel(scanStatus))}
    </div>
    ${
      health.repositoryScanStatus.message
        ? `<p class="table-note">${escapeHtml(displayMessage(health.repositoryScanStatus.message))} · 已扫描 ${health.repositoryScanStatus.scannedVersionDirs} 个版本目录 · 跳过 ${health.repositoryScanStatus.skipped} 项</p>`
        : ""
    }
  `;
}

function renderPipSummary(health: PipEnvironmentHealth | null) {
  if (!health) return "";
  const outdatedValue = health.outdatedStatus === "Ready" ? String(health.outdatedCount) : statusLabel(health.outdatedStatus);

  return `
    <div class="homebrew-summary">
      ${statCard("已安装", String(health.installedCount))}
      ${statCard("可更新", outdatedValue)}
      ${statCard("可编辑", String(health.editableCount))}
      ${statCard("直接 URL", String(health.directUrlCount))}
      ${statCard("环境", environmentKindLabel(health.environmentKind))}
    </div>
    <p class="table-note">${escapeHtml(health.pythonVersion)} · ${escapeHtml(health.pythonExecutable)}</p>
    ${
      health.outdatedMessage && health.outdatedStatus === "Failed"
        ? `<p class="table-note bad-note">${escapeHtml(displayMessage(health.outdatedMessage))}</p>`
        : ""
    }
  `;
}

function renderHomebrewFilters() {
  const filters: HomebrewFilter[] = ["All", "Formulae", "Casks", "Outdated", "Leaves"];
  return `
    <div class="homebrew-filters">
      ${filters
        .map((filter) => {
          const active = filter === selectedHomebrewFilter ? "active" : "";
          return `<button class="filter ${active}" data-action="homebrew-filter" data-filter="${filter}" type="button">${homebrewFilterLabel(filter)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function renderMavenFilters() {
  const filters: MavenFilter[] = ["All", "Duplicates", "Snapshots"];
  return `
    <div class="homebrew-filters">
      ${filters
        .map((filter) => {
          const active = filter === selectedMavenFilter ? "active" : "";
          return `<button class="filter ${active}" data-action="maven-filter" data-filter="${filter}" type="button">${mavenFilterLabel(filter)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function renderPipFilters() {
  const filters: PipFilter[] = ["All", "Outdated", "Editable", "UserSite", "DirectUrl"];
  return `
    <div class="homebrew-filters">
      ${filters
        .map((filter) => {
          const active = filter === selectedPipFilter ? "active" : "";
          return `<button class="filter ${active}" data-action="pip-filter" data-filter="${filter}" type="button">${pipFilterLabel(filter)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function filteredHomebrewPackages(manager: ManagerSnapshot) {
  return manager.packages
    .map((pkg, index) => ({ pkg, index }))
    .filter(({ pkg }) => {
      switch (selectedHomebrewFilter) {
        case "Formulae":
          return pkg.kind === "Formula";
        case "Casks":
          return pkg.kind === "Cask";
        case "Outdated":
          return pkg.signals.includes("Outdated");
        case "Leaves":
          return pkg.signals.includes("Leaf");
        case "All":
        default:
          return true;
      }
    });
}

function filteredMavenPackages(manager: ManagerSnapshot) {
  return manager.packages
    .map((pkg, index) => ({ pkg, index }))
    .filter(({ pkg }) => {
      switch (selectedMavenFilter) {
        case "Duplicates":
          return pkg.signals.includes("DuplicateVersions");
        case "Snapshots":
          return pkg.signals.includes("Snapshot");
        case "All":
        default:
          return true;
      }
    });
}

function filteredPipPackages(manager: ManagerSnapshot) {
  return manager.packages
    .map((pkg, index) => ({ pkg, index }))
    .filter(({ pkg }) => {
      switch (selectedPipFilter) {
        case "Outdated":
          return pkg.signals.includes("Outdated");
        case "Editable":
          return pkg.signals.includes("Editable");
        case "UserSite":
          return pkg.signals.includes("UserSite");
        case "DirectUrl":
          return pkg.signals.includes("DirectUrl");
        case "All":
        default:
          return true;
      }
    });
}

function renderPackageSignals(pkg: PackageRow) {
  if (!pkg.signals.length) return `<span class="signal neutral">当前版本</span>`;

  return pkg.signals
    .map((signal) => `<span class="signal ${signal === "Outdated" || signal === "DuplicateVersions" ? "warn" : "partial"}">${signalLabel(signal)}</span>`)
    .join("");
}

function renderPackageActions(pkg: PackageRow, index: number) {
  const menuOpen = openPackageActionMenuIndex === index;
  const menuItems = pkg.actions.map((action, actionIndex) => {
    return `<button class="action-menu-item" data-action="copy-package-action" data-index="${index}" data-action-index="${actionIndex}" type="button">${escapeHtml(actionLabel(action))}</button>`;
  });

  menuItems.unshift(`<button class="action-menu-item" data-action="copy-package" data-index="${index}" type="button">复制包名</button>`);
  if (pkg.path) {
    menuItems.push(`<button class="action-menu-item" data-action="open-package" data-index="${index}" type="button">打开路径</button>`);
  }

  return `
    <div class="action-menu-wrap">
      <button class="ghost action-trigger" data-action="toggle-package-actions" data-index="${index}" type="button" aria-haspopup="menu" aria-expanded="${menuOpen}">
        操作
        <span class="action-caret" aria-hidden="true"></span>
      </button>
      ${
        menuOpen
          ? `
            <div class="action-menu" role="menu">
              ${menuItems.join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function closePackageActionMenu() {
  if (openPackageActionMenuIndex === null) return;
  openPackageActionMenuIndex = null;
  renderWorkspace();
}

function shorten(value: string) {
  const parts = value.split("/");
  if (parts.length <= 4) return value;
  return `${parts.slice(0, 2).join("/")}/…/${parts.slice(-2).join("/")}`;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

function trimTail(value: string, lineCount = 5) {
  const lines = value.trim().split(/\r?\n/);
  return lines.slice(-lineCount).join("\n");
}

function actionFailureTitle(action: string | undefined) {
  switch (action) {
    case "copy-path":
    case "copy-command":
    case "copy-package":
    case "copy-package-action":
    case "copy-cleanup-command":
      return "复制失败";
    case "open-path":
    case "open-package":
      return "打开失败";
    case "refresh":
      return "扫描失败";
    default:
      return "操作失败";
  }
}

function errorToString(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

function sizeScanError(error: unknown): DiskUsage {
  return {
    status: "Error",
    bytes: null,
    human: null,
    files: 0,
    directories: 0,
    skipped: 0,
    message: errorToString(error),
  };
}

function must<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing element ${selector}`);
  }
  return node;
}

function escapeHtml(value: string) {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
}

function escapeHtmlAttr(value: string) {
  return escapeHtml(value).split("'").join("&#39;");
}

render();
requestAnimationFrame(() => {
  void refresh(selectedManager);
});
