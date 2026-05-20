import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

type ManagerId = "Npm" | "Pnpm" | "Yarn" | "Homebrew";
type ManagerStatus = "Ready" | "Missing" | "Unsupported" | "Partial" | "Failed";
type DiskUsageStatus = "Pending" | "Ready" | "Missing" | "PermissionDenied" | "Error";
type PathKind = "Cache" | "Store" | "GlobalModules" | "GlobalDir" | "Prefix" | "Cellar" | "Caskroom";
type PackageKind = "Generic" | "Formula" | "Cask";
type PackageSignal = "Outdated" | "Leaf";
type AsyncStatus = "Pending" | "Ready" | "Failed";
type HomebrewFilter = "All" | "Formulae" | "Casks" | "Outdated" | "Leaves";
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

interface ManagerScanSnapshot {
  scanDurationMs: number;
  manager: ManagerSnapshot;
}

type MessageTone = "bad" | "ok" | "warn";

interface UiMessage {
  tone: MessageTone;
  title: string;
  message: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App container missing");
}

const managerOrder: ManagerId[] = ["Npm", "Pnpm", "Yarn", "Homebrew"];
const managerLabels: Record<ManagerId, string> = {
  Npm: "npm",
  Pnpm: "pnpm",
  Yarn: "Yarn",
  Homebrew: "Homebrew",
};

let managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>> = {};
let scanDurationMsByManager: Partial<Record<ManagerId, number>> = {};
let selectedManager: ManagerId = "Npm";
let selectedPackageIndex = 0;
let selectedHomebrewFilter: HomebrewFilter = "All";
let lastCopied = "";
let scanningManagers = new Set<ManagerId>();
let sizeScanTokens: Record<ManagerId, number> = { Npm: 0, Pnpm: 0, Yarn: 0, Homebrew: 0 };
let pendingSizeScansByManager: Record<ManagerId, number> = { Npm: 0, Pnpm: 0, Yarn: 0, Homebrew: 0 };
let homebrewCleanupToken = 0;
let pendingHomebrewCleanup = false;
let uiMessage: UiMessage | null = null;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div>
        <h1>Package Manager Control Center</h1>
        <p class="lede">查看 npm、pnpm、Yarn Classic 和 Homebrew 的全局包、缓存位置和维护信号。Homebrew 只复制安全命令，不直接执行清理或升级。</p>
      </div>
      <div class="topbar-actions">
        <button id="refresh-button" data-action="refresh" class="primary" type="button">Refresh scan</button>
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
            <p class="eyebrow">Packages</p>
            <h2 id="manager-title">Manager</h2>
          </div>
          <div class="pill" id="manager-status"></div>
        </div>
        <div class="table" id="package-table"></div>
      </div>

      <div class="sidecol">
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Paths</p>
              <h2>Cache / store</h2>
            </div>
          </div>
          <div id="path-list"></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Diagnostics</p>
              <h2>Failures</h2>
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
  if (!target) return;

  void handleAction(target);
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
      render();
      if (!managerSnapshots[managerId] && !scanningManagers.has(managerId)) {
        void refresh(managerId);
      }
      return;
    }

    if (action === "homebrew-filter" && target.dataset.filter) {
      selectedHomebrewFilter = target.dataset.filter as HomebrewFilter;
      selectedPackageIndex = 0;
      render();
      return;
    }

    if (action === "select-package" && target.dataset.index) {
      selectedPackageIndex = Number(target.dataset.index);
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
      markCopied("command envelope");
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
        markCopied(packageAction.preview);
      }
      return;
    }

    if (action === "copy-package" && manager) {
      const pkg = packageFromTarget(target);
      if (pkg) {
        await writeText(`${pkg.name}@${pkg.version}`);
        markCopied(`${pkg.name}@${pkg.version}`);
      }
      return;
    }

    if (action === "open-package") {
      const pkg = packageFromTarget(target);
      if (pkg?.path) {
        await openPath(pkg.path);
        clearMessage();
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
  } catch (error) {
    if (managerId === selectedManager) {
      showError(`${managerLabel(managerId)} scan failed`, error);
    }
  } finally {
    scanningManagers.delete(managerId);
    render();
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
    ${statCard("Managers", `${managers.length}/${managerOrder.length}`)}
    ${statCard("Ready", String(readyManagers))}
    ${statCard("Packages", String(totalPackages))}
    ${statCard("Total size", formatBytes(totalBytes))}
    ${statCard("Unsupported", String(unsupported))}
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
          <span class="tab-status ${statusClassName}">${status}</span>
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
  managerStatusEl.textContent = scanning ? "Scanning" : manager?.status ?? "Not scanned";
  managerStatusEl.className = `pill ${scanning ? "partial" : statusClass(manager?.status ?? "neutral")}`;
  packageTableEl.innerHTML = renderPackageTable(manager);
  pathListEl.innerHTML = renderPathList(manager);
  failureListEl.innerHTML = renderFailures(manager);
}

function renderPackageTable(manager: ManagerSnapshot | null) {
  if (!manager) {
    return emptyState(scanningManagers.has(selectedManager) ? "Scanning packages..." : "Not scanned yet");
  }

  if (manager.id === "Homebrew") {
    return renderHomebrewPackageTable(manager);
  }

  if (manager.status === "Unsupported") {
    return `
      <div class="empty">
        <p class="empty-title">Yarn modern does not expose a global package list.</p>
        <p>${manager.unsupportedReason ?? "Unsupported state"}</p>
      </div>
    `;
  }

  if (!manager.packages.length) {
    return emptyState("No global packages found");
  }

  return `
    <div class="table-head">
      <span>Name</span>
      <span>Version</span>
      <span>Source</span>
      <span>Path</span>
      <span>Action</span>
    </div>
    ${manager.packages
      .map((pkg, index) => {
        const active = index === selectedPackageIndex ? "selected" : "";
        return `
          <div class="row ${active}" data-action="select-package" data-index="${index}">
            <span class="cell strong">${escapeHtml(pkg.name)}</span>
            <span class="cell">${escapeHtml(pkg.version)}</span>
            <span class="cell muted">${escapeHtml(shorten(pkg.source))}</span>
            <span class="cell muted">${escapeHtml(pkg.path ?? "n/a")}</span>
            <span class="cell action-cell">
              <button class="ghost" data-action="copy-package" data-index="${index}" type="button">Copy</button>
              ${pkg.path ? `<button class="ghost" data-action="open-package" data-index="${index}" type="button">Open</button>` : ""}
            </span>
          </div>
        `;
      })
      .join("")}
  `;
}

function renderPathList(manager: ManagerSnapshot | null) {
  if (!manager) {
    return emptyState(scanningManagers.has(selectedManager) ? "Scanning paths..." : "Not scanned yet");
  }

  const paths = manager.paths.length
    ? manager.paths
    .map((path) => {
      const size = path.size;
      const openDisabled = size.status === "Missing" ? "disabled" : "";
      const detail =
        size.status === "Pending"
          ? `<span>Waiting for size scan</span>`
          : `
            <span>${size.files} files</span>
            <span>${size.directories} dirs</span>
            <span>${size.skipped} skipped</span>
          `;
      return `
        <div class="path-card">
          <div class="path-main">
            <div>
              <p class="path-label">${escapeHtml(path.label)}</p>
              <p class="path-kind">${escapeHtml(path.kind)}</p>
            </div>
            <div class="size-badge ${statusClass(size.status)}">
              ${size.human ?? size.status}
            </div>
          </div>
          <code class="path-value">${escapeHtml(path.path)}</code>
          <div class="path-detail">
            ${detail}
          </div>
          ${size.message ? `<p class="path-message">${escapeHtml(size.message)}</p>` : ""}
          <div class="path-actions">
            <button class="ghost" data-action="copy-path" data-path="${escapeHtmlAttr(path.path)}" type="button">Copy path</button>
            <button class="ghost" data-action="open-path" data-path="${escapeHtmlAttr(path.path)}" type="button" ${openDisabled}>Open</button>
          </div>
        </div>
      `;
    })
    .join("")
    : emptyState("No cache or store path resolved");

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
        : `<p class="path-message">Cleanup dry-run completed with no output.</p>`
      : cleanup.status === "Failed"
        ? `<p class="path-message">${escapeHtml(cleanup.message ?? "Cleanup dry-run failed")}</p>${cleanup.rawOutput ? `<pre>${escapeHtml(trimTail(cleanup.rawOutput, 10))}</pre>` : ""}`
        : `<p class="path-message">Cleanup dry-run is loading separately so the Homebrew tab can render quickly.</p>`;

  return `
    <div class="cleanup-card">
      <div class="path-main">
        <div>
          <p class="path-label">Cleanup dry-run</p>
          <p class="path-kind">Preview only, no files are deleted</p>
        </div>
        <div class="size-badge ${statusClass(status)}">
          ${cleanup.reclaimedHuman ?? status}
        </div>
      </div>
      <code class="path-value">${escapeHtml(cleanup.command.preview)}</code>
      ${body}
      <div class="path-actions">
        <button class="ghost" data-action="copy-cleanup-command" type="button">Copy dry-run</button>
      </div>
    </div>
  `;
}

function renderCommandList(manager: ManagerSnapshot) {
  if (!manager.commands.length) return "";

  return `
    <div class="command-list">
      <p class="path-label">Scan commands</p>
      ${manager.commands
        .map((command) => {
          const payload = JSON.stringify({ preview: command.preview, envelope: command }, null, 2);
          return `
            <div class="command-row">
              <code>${escapeHtml(command.preview)}</code>
              <button class="ghost" data-action="copy-command" data-command="${escapeHtmlAttr(payload)}" type="button">Copy</button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderFailures(manager: ManagerSnapshot | null) {
  if (!manager) return emptyState("Not scanned yet");
  if (!manager.failures.length) return emptyState("No failures recorded");

  return manager.failures
    .map(
      (failure) => `
        <div class="failure">
          <div class="failure-head">
            <span class="pill ${statusClass("Failed")}">${failure.kind}</span>
            <span class="failure-message">${escapeHtml(failure.message)}</span>
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
  if (scanningManagers.has(selectedManager)) parts.push(`Scanning ${managerLabel(selectedManager)}...`);
  if (pendingSizeScans > 0) parts.push(`Sizing ${pendingSizeScans} paths...`);
  if (selectedManager === "Homebrew" && pendingHomebrewCleanup) parts.push("Cleanup dry-run...");
  if (scanDurationMs !== undefined) parts.push(`Scan ${scanDurationMs} ms`);
  if (lastCopied) parts.push(`Copied ${lastCopied}`);
  scanMetaEl.textContent = parts.join(" · ");
}

function renderControls() {
  const scanning = scanningManagers.has(selectedManager);
  refreshButtonEl.disabled = scanning;
  refreshButtonEl.textContent = scanning ? `Scanning ${managerLabel(selectedManager)}...` : `Refresh ${managerLabel(selectedManager)}`;
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
    <span>${escapeHtml(uiMessage.message)}</span>
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
  return kind === "Cache" || kind === "Store" || kind === "Cellar" || kind === "Caskroom";
}

function actionLabel(action: CommandEnvelope) {
  const [firstArg, secondArg] = action.args;
  if (firstArg === "upgrade" && secondArg === "--cask") return "Copy cask upgrade";
  if (firstArg === "upgrade") return "Copy upgrade";
  if (firstArg === "uses") return "Copy uses";
  if (firstArg === "info") return "Copy info";
  return "Copy command";
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
            <span>Name</span>
            <span>Version</span>
            <span>Signals</span>
            <span>Path</span>
            <span>Actions</span>
          </div>
          ${filteredPackages
            .map(({ pkg, index }) => {
              const active = index === selectedPackageIndex ? "selected" : "";
              return `
                <div class="row homebrew-row ${active}" data-action="select-package" data-index="${index}">
                  <span class="cell strong">
                    ${escapeHtml(pkg.name)}
                    <span class="kind-tag">${escapeHtml(pkg.kind)}</span>
                  </span>
                  <span class="cell">${escapeHtml(pkg.version)}</span>
                  <span class="cell signal-cell">${renderPackageSignals(pkg)}</span>
                  <span class="cell muted">${escapeHtml(pkg.path ?? "n/a")}</span>
                  <span class="cell action-cell">
                    ${renderPackageActions(pkg, index)}
                  </span>
                </div>
              `;
            })
            .join("")}
        `
        : emptyState("No Homebrew packages match this filter")
    }
  `;
}

function renderHomebrewSummary(maintenance: HomebrewMaintenance | null) {
  if (!maintenance) return "";

  const cleanup = maintenance.cleanup;
  const cleanupValue =
    cleanup.status === "Ready"
      ? cleanup.reclaimedHuman ?? "Ready"
      : cleanup.status === "Pending"
        ? "Pending"
        : "Failed";

  return `
    <div class="homebrew-summary">
      ${statCard("Formulae", String(maintenance.formulaCount))}
      ${statCard("Casks", String(maintenance.caskCount))}
      ${statCard("Outdated", String(maintenance.outdatedCount))}
      ${statCard("Leaves", String(maintenance.leafCount))}
      ${statCard("Cleanup", cleanupValue)}
    </div>
  `;
}

function renderHomebrewFilters() {
  const filters: HomebrewFilter[] = ["All", "Formulae", "Casks", "Outdated", "Leaves"];
  return `
    <div class="homebrew-filters">
      ${filters
        .map((filter) => {
          const active = filter === selectedHomebrewFilter ? "active" : "";
          return `<button class="filter ${active}" data-action="homebrew-filter" data-filter="${filter}" type="button">${filter}</button>`;
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

function renderPackageSignals(pkg: PackageRow) {
  if (!pkg.signals.length) return `<span class="signal neutral">Current</span>`;

  return pkg.signals
    .map((signal) => `<span class="signal ${signal === "Outdated" ? "warn" : "partial"}">${signal}</span>`)
    .join("");
}

function renderPackageActions(pkg: PackageRow, index: number) {
  const actionButtons = pkg.actions.map((action, actionIndex) => {
    return `<button class="ghost" data-action="copy-package-action" data-index="${index}" data-action-index="${actionIndex}" type="button">${escapeHtml(actionLabel(action))}</button>`;
  });

  actionButtons.unshift(`<button class="ghost" data-action="copy-package" data-index="${index}" type="button">Copy pkg</button>`);
  if (pkg.path) {
    actionButtons.push(`<button class="ghost" data-action="open-package" data-index="${index}" type="button">Open</button>`);
  }

  return actionButtons.join("");
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
      return "Copy failed";
    case "open-path":
    case "open-package":
      return "Open failed";
    case "refresh":
      return "Scan failed";
    default:
      return "Action failed";
  }
}

function errorToString(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
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
