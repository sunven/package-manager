import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

type ManagerId = "Npm" | "Pnpm" | "Yarn";
type ManagerStatus = "Ready" | "Missing" | "Unsupported" | "Partial" | "Failed";
type DiskUsageStatus = "Ready" | "Missing" | "PermissionDenied" | "Error";
type PathKind = "Cache" | "Store" | "GlobalModules" | "GlobalDir";
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
}

interface ScanSnapshot {
  scanDurationMs: number;
  managers: ManagerSnapshot[];
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

let snapshot: ScanSnapshot | null = null;
let selectedManager: ManagerId = "Npm";
let selectedPackageIndex = 0;
let lastCopied = "";
let isScanning = false;
let uiMessage: UiMessage | null = null;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Local Tauri tool</p>
        <h1>Package Manager Control Center</h1>
        <p class="lede">查看 npm、pnpm 和 Yarn Classic 的全局包、缓存位置和总空间。Yarn modern 只展示缓存信息，不伪装成全局列表。</p>
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
      await refresh();
      return;
    }

    if (action === "manager-tab" && target.dataset.manager) {
      selectedManager = target.dataset.manager as ManagerId;
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

async function refresh() {
  if (isScanning) return;

  isScanning = true;
  uiMessage = null;
  render();

  try {
    snapshot = await invoke<ScanSnapshot>("scan_managers");
    if (!snapshot.managers.some((manager) => manager.id === selectedManager)) {
      selectedManager = snapshot.managers[0]?.id ?? "Npm";
    }
    const current = currentManager();
    if (current && selectedPackageIndex >= current.packages.length) {
      selectedPackageIndex = 0;
    }
  } catch (error) {
    showError("Scan failed", error);
  } finally {
    isScanning = false;
    render();
  }
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
  const managers = snapshot?.managers ?? [];
  const totalBytes = managers.reduce((sum, manager) => {
    return (
      sum +
      manager.paths.reduce((pathSum, path) => {
        return path.kind === "Cache" || path.kind === "Store"
          ? pathSum + (path.size.bytes ?? 0)
          : pathSum;
      }, 0)
    );
  }, 0);

  const totalPackages = managers.reduce((sum, manager) => sum + manager.packages.length, 0);
  const readyManagers = managers.filter((manager) => manager.status === "Ready").length;
  const unsupported = managers.filter((manager) => manager.status === "Unsupported").length;

  overviewEl.innerHTML = `
    ${statCard("Managers", String(managers.length))}
    ${statCard("Ready", String(readyManagers))}
    ${statCard("Packages", String(totalPackages))}
    ${statCard("Total size", formatBytes(totalBytes))}
    ${statCard("Unsupported", String(unsupported))}
  `;
}

function renderManagers() {
  const managers = snapshot?.managers ?? [];
  managerTabsEl.innerHTML = managers
    .map((manager) => {
      const active = manager.id === selectedManager ? "active" : "";
      return `
        <button class="tab ${active}" data-action="manager-tab" data-manager="${manager.id}">
          <span>${manager.label}</span>
          <span class="tab-status ${statusClass(manager.status)}">${manager.status}</span>
        </button>
      `;
    })
    .join("");
}

function renderWorkspace() {
  const manager = currentManager();
  managerTitleEl.textContent = manager ? `${manager.label}${manager.version ? ` ${manager.version}` : ""}` : "Manager";
  managerStatusEl.textContent = manager?.status ?? "Unknown";
  managerStatusEl.className = `pill ${statusClass(manager?.status ?? "Failed")}`;
  packageTableEl.innerHTML = renderPackageTable(manager);
  pathListEl.innerHTML = renderPathList(manager);
  failureListEl.innerHTML = renderFailures(manager);
}

function renderPackageTable(manager: ManagerSnapshot | null) {
  if (!manager) {
    return emptyState("No manager selected");
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
  if (!manager) return emptyState("No path data");

  const paths = manager.paths.length
    ? manager.paths
    .map((path) => {
      const size = path.size;
      const openDisabled = size.status === "Missing" ? "disabled" : "";
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
            <span>${size.files} files</span>
            <span>${size.directories} dirs</span>
            <span>${size.skipped} skipped</span>
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
    ${paths}
    ${renderCommandList(manager)}
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
  if (!manager) return emptyState("No diagnostics");
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
  if (isScanning) parts.push("Scanning...");
  if (snapshot) parts.push(`Scan ${snapshot.scanDurationMs} ms`);
  if (lastCopied) parts.push(`Copied ${lastCopied}`);
  scanMetaEl.textContent = parts.join(" · ");
}

function renderControls() {
  refreshButtonEl.disabled = isScanning;
  refreshButtonEl.textContent = isScanning ? "Scanning..." : "Refresh scan";
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
  return snapshot?.managers.find((manager) => manager.id === selectedManager) ?? null;
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
    case "Partial":
      return "partial";
    default:
      return "neutral";
  }
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

function trimTail(value: string) {
  const lines = value.trim().split(/\r?\n/);
  return lines.slice(-5).join("\n");
}

function actionFailureTitle(action: string | undefined) {
  switch (action) {
    case "copy-path":
    case "copy-command":
    case "copy-package":
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

void refresh();
