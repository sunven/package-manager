import { useRef, type CSSProperties } from "react";
import { ArrowClockwise, ArrowSquareOut, CaretRight, Copy, Cube, HardDrives, MagnifyingGlass } from "@phosphor-icons/react";
import { packageKindLabels, statusLabels } from "../constants";
import type { DevelopmentHealthSummary } from "../developmentHealth";
import type { MaintenanceRequest } from "../state";
import type { ManagerId, ManagerSnapshot, PackageRow, PathInfo } from "../types";
import { indexedPackages } from "../utils/filters";
import { formatBytes, formatHomePath, managerLabel } from "../utils/format";
import { DevelopmentHealthPage } from "./DevelopmentHealthPage";
import { PackageActions } from "./PackageActions";
import { EmptyState } from "./ui";

const visiblePackageLimit = 5;

const preferredPathKinds = ["Store", "Cache", "GlobalModules", "GlobalDir", "Cellar", "LocalRepository"] as const;

export function OverviewDashboard({
  enabledManagers,
  health,
  homeDirectory,
  managerSnapshots,
  menuOpenIndex,
  onCopyCommand,
  onCopyPackage,
  onCopyPackageAction,
  onCopyPath,
  onOpenManager,
  onOpenPackage,
  onOpenPath,
  onQueryChange,
  onRefresh,
  onRequestPackageUninstall,
  onSelectManager,
  onSelectPackage,
  onShowManagers,
  onToggleActions,
  pendingMaintenance,
  query,
  scanningManagers,
  selectedManager,
  selectedPackageIndex,
}: {
  enabledManagers: ManagerId[];
  health: DevelopmentHealthSummary;
  homeDirectory: string | null;
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  menuOpenIndex: number | null;
  onCopyCommand: (payload: string) => void;
  onCopyPackage: (index: number) => void;
  onCopyPackageAction: (index: number, actionIndex: number) => void;
  onCopyPath: (path: string) => void;
  onOpenManager: (managerId: ManagerId) => void;
  onOpenPackage: (index: number) => void;
  onOpenPath: (path: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onRequestPackageUninstall: (index: number) => void;
  onSelectManager: (managerId: ManagerId) => void;
  onSelectPackage: (index: number) => void;
  onShowManagers: () => void;
  onToggleActions: (index: number) => void;
  pendingMaintenance: MaintenanceRequest | null;
  query: string;
  scanningManagers: Set<ManagerId>;
  selectedManager: ManagerId;
  selectedPackageIndex: number | null;
}) {
  const chipRow = useRef<HTMLDivElement>(null);
  const selected = managerSnapshots[selectedManager] ?? null;
  const scanning = scanningManagers.has(selectedManager);
  const packages = selected ? matchingPackages(selected, query) : [];
  const visiblePackages = packages.slice(0, visiblePackageLimit);
  const hiddenCount = Math.max(packages.length - visiblePackages.length, 0);
  const footprint = primaryPath(selected);
  const commands = quickCommands(enabledManagers, managerSnapshots);
  const selectedCommands = (selected?.commands ?? []).slice(0, 4);
  const outdated = outdatedPackages(enabledManagers, managerSnapshots);
  const showRecommendations = health.recommendations.length > 0 || health.scannedManagerCount === 0;

  return (
    <div className="studio-overview">
      <div className="studio-overview-main">
        <section aria-label="包管理器" className="studio-hero">
          <div className="studio-hero-copy">
            <span aria-hidden="true" className="studio-logo">
              <Cube weight="fill" />
            </span>
            <div>
              <h2>包管理器</h2>
              <p>在一个界面里查看版本、清单和占用。</p>
            </div>
          </div>
          <div className="studio-chip-row">
            <div className="studio-chips" ref={chipRow}>
              {enabledManagers.map((managerId) => {
                const manager = managerSnapshots[managerId];
                const version = manager?.version?.trim() || (scanningManagers.has(managerId) ? "扫描中" : "未扫描");
                return (
                  <button
                    aria-pressed={managerId === selectedManager}
                    className="studio-chip"
                    key={managerId}
                    onClick={() => onSelectManager(managerId)}
                    type="button"
                  >
                    <ManagerMark id={managerId} />
                    <strong>{managerLabel(managerId)}</strong>
                    <span>{version}</span>
                  </button>
                );
              })}
            </div>
            <button
              aria-label="向后查看管理器"
              className="studio-chip-next"
              onClick={() => chipRow.current?.scrollBy({ left: 220, behavior: "smooth" })}
              type="button"
            >
              <CaretRight aria-hidden="true" />
            </button>
          </div>
        </section>

        <section aria-label="全局模块" className="studio-card">
          <header className="studio-card-head">
            <div className="studio-card-title">
              <span aria-hidden="true" className="studio-logo studio-logo--sm">
                <Cube weight="fill" />
              </span>
              <div>
                <h2>
                  全局模块
                  <span>{selected ? packages.length : 0}</span>
                </h2>
                <p>{managerLabel(selectedManager)} 这次扫描到的包</p>
              </div>
            </div>
            <div className="studio-card-tools">
              <label className="studio-mini-search">
                <MagnifyingGlass aria-hidden="true" />
                <input
                  aria-label="在当前管理器里搜索包"
                  id="package-search"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="搜索包名..."
                  type="search"
                  value={query}
                />
              </label>
              <button aria-label={scanning ? "正在扫描" : `刷新 ${managerLabel(selectedManager)}`} disabled={scanning} onClick={onRefresh} type="button">
                <ArrowClockwise className={scanning ? "animate-spin" : undefined} />
              </button>
              <strong>{footprintLabel(footprint)}</strong>
            </div>
          </header>
          {!selected ? (
            <EmptyState message={scanning ? "正在扫描软件包..." : "尚未扫描"} />
          ) : packages.length === 0 ? (
            <EmptyState message={query.trim() ? "没有匹配的包" : emptyPackageMessage(selected)} />
          ) : (
            <div className="studio-table-wrap">
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>版本</th>
                    <th>管理器</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePackages.map(({ pkg, index }) => (
                    <tr
                      aria-selected={index === selectedPackageIndex}
                      key={`${pkg.name}-${pkg.version}-${index}`}
                      onClick={() => onSelectPackage(index)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onSelectPackage(index);
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <span className="studio-pkg">
                          <ManagerMark id={selectedManager} />
                          <span>
                            <strong>{pkg.name}</strong>
                            <small>{packageDetail(pkg)}</small>
                          </span>
                        </span>
                      </td>
                      <td className="studio-version">{pkg.version}</td>
                      <td>
                        <span className="studio-pill" data-manager={selectedManager}>
                          <ManagerMark id={selectedManager} />
                          {managerLabel(selectedManager)}
                        </span>
                      </td>
                      <td className="studio-row-actions">
                        <PackageActions
                          index={index}
                          managerId={selected.id}
                          menuOpen={menuOpenIndex === index}
                          onCopyPackage={onCopyPackage}
                          onCopyPackageAction={onCopyPackageAction}
                          onOpenPackage={onOpenPackage}
                          onRequestUninstall={onRequestPackageUninstall}
                          onToggle={onToggleActions}
                          pendingUninstall={isPendingUninstall(pendingMaintenance, selected.id, index, pkg.name)}
                          pkg={pkg}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenCount > 0 ? (
                <button className="studio-more" onClick={onShowManagers} type="button">
                  还有 {hiddenCount} 个，在包管理器里看
                </button>
              ) : null}
            </div>
          )}
        </section>

        <section aria-label="各包管理器概览" className="studio-card">
          <header className="studio-card-head studio-card-head--plain">
            <div className="studio-card-title">
              <span aria-hidden="true" className="studio-logo studio-logo--sm">
                <Cube weight="fill" />
              </span>
              <h2>各包管理器概览</h2>
            </div>
          </header>
          <div className="studio-mgr-grid">
            {enabledManagers.map((managerId) => {
              const manager = managerSnapshots[managerId];
              const version = manager?.version?.trim() || statusLabels[scanningManagers.has(managerId) ? "Scanning" : manager?.status ?? "Not scanned"];
              return (
                <button
                  aria-pressed={managerId === selectedManager}
                  className="studio-mgr-card"
                  key={managerId}
                  onClick={() => onSelectManager(managerId)}
                  type="button"
                >
                  <span className="studio-mgr-card-id">
                    <ManagerMark id={managerId} />
                    <span>
                      <strong>{managerLabel(managerId)}</strong>
                      <small>{version}</small>
                    </span>
                  </span>
                  <span className="studio-mgr-stats">
                    <span>全局包 <b>{manager?.packages.length ?? 0}</b></span>
                    <span>目录 <b>{manager?.paths.length ?? 0}</b></span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="快速命令" className="studio-commandbar">
          <span>
            <CaretRight aria-hidden="true" />
            快速命令
          </span>
          {commands.length ? (
            <div>
              {commands.map((preview) => (
                <button key={preview} onClick={() => onCopyCommand(preview)} type="button">
                  {preview}
                </button>
              ))}
            </div>
          ) : (
            <p>扫描完成后，这里会放可复制的命令。</p>
          )}
          <button className="studio-command-focus" onClick={() => document.getElementById("package-search")?.focus()} type="button">
            搜索当前清单
          </button>
        </section>
      </div>

      <aside aria-label="存储与操作" className="studio-rail">
        <StorageCard
          footprint={footprint}
          homeDirectory={homeDirectory}
          onCopyPath={onCopyPath}
          onOpenPath={onOpenPath}
          selected={selected}
          totalBytes={health.totalBytes}
        />
        <section className="studio-card studio-side-card">
          <header className="studio-card-head studio-card-head--plain">
            <h2>快捷操作</h2>
          </header>
          {selectedCommands.length ? (
            <ul className="studio-actions">
              {selectedCommands.map((command) => (
                <li key={command.preview}>
                  <button onClick={() => onCopyCommand(command.preview)} type="button">
                    <ArrowClockwise aria-hidden="true" />
                    <span>
                      <strong>{command.preview}</strong>
                      <small>{commandHint(command.preview)}</small>
                    </span>
                    <CaretRight aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message={selected ? "这个管理器没有可复制的命令" : "尚未扫描"} />
          )}
        </section>
        {showRecommendations ? (
          <DevelopmentHealthPage health={health} homeDirectory={homeDirectory} onOpenManager={onOpenManager} />
        ) : null}
        <section className="studio-card studio-side-card">
          <header className="studio-card-head studio-card-head--plain">
            <h2>可更新</h2>
            <button onClick={onShowManagers} type="button">查看管理器</button>
          </header>
          {outdated.length ? (
            <ul className="studio-updates">
              {outdated.map((item) => (
                <li key={`${item.managerId}-${item.pkg.name}-${item.pkg.version}`}>
                  <button onClick={() => onOpenManager(item.managerId)} type="button">
                    <ManagerMark id={item.managerId} />
                    <span>
                      <strong>{item.pkg.name}</strong>
                      <small>{managerLabel(item.managerId)}</small>
                    </span>
                    <em>{item.pkg.version}</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message={health.scannedManagerCount ? "没有标成可更新的包" : "尚未扫描"} />
          )}
        </section>
      </aside>
    </div>
  );
}

function StorageCard({
  footprint,
  homeDirectory,
  onCopyPath,
  onOpenPath,
  selected,
  totalBytes,
}: {
  footprint: PathInfo | null;
  homeDirectory: string | null;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  selected: ManagerSnapshot | null;
  totalBytes: number;
}) {
  const bytes = footprint?.size.bytes ?? null;
  const measured = footprint?.size.status === "Ready" && bytes !== null;
  const percent = measured && totalBytes > 0 ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : null;
  const status = selected ? statusLabels[selected.status] : "未扫描";

  return (
    <section className="studio-card studio-storage">
      <header className="studio-card-head studio-card-head--plain">
        <h2>
          <HardDrives aria-hidden="true" />
          存储
        </h2>
        <span className={selected?.status === "Ready" ? "studio-ok" : "studio-wait"}>{status}</span>
      </header>
      <p className="studio-storage-bytes">{measured ? footprint?.size.human ?? formatBytes(bytes) : "尚未统计"}</p>
      <p className="studio-storage-meta">
        {measured ? `${footprint?.size.files ?? 0} 个文件` : "文件数会在路径统计完成后出现"}
        {percent !== null ? <span>{percent}%</span> : null}
      </p>
      <div aria-hidden="true" className="studio-bar" style={{ "--fill": `${percent ?? 0}%` } as CSSProperties}>
        <span />
      </div>
      <div className="studio-path-row">
        <code>{footprint ? formatHomePath(footprint.path, homeDirectory) : "还没有路径"}</code>
        <button aria-label="复制路径" disabled={!footprint} onClick={() => footprint && onCopyPath(footprint.path)} type="button">
          <Copy aria-hidden="true" />
        </button>
        <button aria-label="打开路径" disabled={!footprint} onClick={() => footprint && onOpenPath(footprint.path)} type="button">
          <ArrowSquareOut aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function ManagerMark({ id }: { id: ManagerId }) {
  return (
    <span aria-hidden="true" className="studio-mark" data-manager={id}>
      {markGlyph[id]}
    </span>
  );
}

const markGlyph: Record<ManagerId, string> = {
  Npm: "n",
  Pnpm: "pn",
  Yarn: "y",
  Nvm: "nv",
  Homebrew: "b",
  Maven: "m",
  Pip: "py",
  Cargo: "c",
  Docker: "d",
  Bun: "bu",
  Uv: "uv",
};

function matchingPackages(manager: ManagerSnapshot, query: string) {
  const needle = query.trim().toLowerCase();
  return indexedPackages(manager).filter(({ pkg }) => {
    if (!needle) return true;
    return [pkg.name, pkg.version, pkg.source, packageDetail(pkg)].some((value) => value.toLowerCase().includes(needle));
  });
}

function packageDetail(pkg: PackageRow) {
  if (pkg.source && !pkg.source.startsWith("/") && !pkg.source.startsWith("~")) return pkg.source;
  const kind = packageKindLabels[pkg.kind];
  return kind === "通用" ? "全局包" : kind;
}

function emptyPackageMessage(manager: ManagerSnapshot) {
  if (manager.status === "Unsupported") return manager.unsupportedReason ?? "这个管理器不提供全局包清单";
  if (manager.id === "Cargo") return "未找到通过 cargo install 安装的二进制 crate";
  return "未找到全局软件包";
}

function primaryPath(manager: ManagerSnapshot | null) {
  if (!manager) return null;
  for (const kind of preferredPathKinds) {
    const found = manager.paths.find((path) => path.kind === kind);
    if (found) return found;
  }
  return manager.paths.find((path) => (path.size.bytes ?? 0) > 0) ?? manager.paths[0] ?? null;
}

function footprintLabel(path: PathInfo | null) {
  if (!path || path.size.status !== "Ready" || path.size.bytes === null) return "占用未统计";
  return path.size.human ?? formatBytes(path.size.bytes);
}

function quickCommands(managerIds: ManagerId[], snapshots: Partial<Record<ManagerId, ManagerSnapshot>>) {
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const managerId of managerIds) {
    for (const command of snapshots[managerId]?.commands ?? []) {
      if (!command.preview || seen.has(command.preview)) continue;
      seen.add(command.preview);
      commands.push(command.preview);
      if (commands.length >= 7) return commands;
    }
  }
  return commands;
}

function outdatedPackages(managerIds: ManagerId[], snapshots: Partial<Record<ManagerId, ManagerSnapshot>>) {
  const items: { managerId: ManagerId; pkg: PackageRow }[] = [];
  for (const managerId of managerIds) {
    for (const pkg of snapshots[managerId]?.packages ?? []) {
      if (!pkg.signals.includes("Outdated")) continue;
      items.push({ managerId, pkg });
      if (items.length >= 4) return items;
    }
  }
  return items;
}

function commandHint(preview: string) {
  const text = preview.toLowerCase();
  if (text.includes("list") || text.includes("ls")) return "复制后查看清单";
  if (text.includes("outdated") || text.includes("update")) return "复制后查看可更新项";
  if (text.includes("prune") || text.includes("clean")) return "复制命令，不会在这里执行";
  if (text.includes("install") || text.includes(" add")) return "复制安装命令";
  return "复制到剪贴板";
}

function isPendingUninstall(pending: MaintenanceRequest | null, managerId: ManagerId, index: number, packageName: string) {
  return pending?.kind === "uninstallGlobalPackage" && pending.managerId === managerId && pending.packageIndex === index && pending.packageName === packageName;
}
