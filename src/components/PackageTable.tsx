import { packageObservationId } from "../managerHistory";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { ArrowSquareOut as ExternalLink, Copy, Trash as Trash2 } from "@phosphor-icons/react";
import { environmentKindLabels, homebrewFilterLabels, mavenFilterLabels, packageKindLabels, pipFilterLabels, signalLabels } from "../constants";
import type {
  HomebrewFilter,
  ManagerSnapshot,
  MavenFilter,
  MavenRepositoryHealth,
  PackageRow,
  DockerResourceHealth,
  PipEnvironmentHealth,
  PipFilter,
} from "../types";
import type { MaintenanceRequest } from "../state";
import { displayMessage, formatHomePath, formatHomePathsInText, pathLabel, shorten } from "../utils/format";
import { filteredHomebrewPackages, filteredMavenPackages, filteredPipPackages, indexedPackages, searchAndSortPackages, type PackageSort, type IndexedPackage } from "../utils/filters";
import { cleanupCopyFor } from "../cleanupCopy";
import { androidSdkUninstallBlockReason } from "../androidSdk";
import { cx } from "../utils/classNames";
import { EmptyState, IconButton, SignalBadge, SkeletonRows, StatCard, StatusBadge } from "./ui";
import { PackageActions } from "./PackageActions";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { TooltipProvider } from "../../components/ui/tooltip";

interface PackageTableProps {
  homeDirectory: string | null;
  manager: ManagerSnapshot | null;
  menuOpenIndex: number | null;
  onCopyPackage: (index: number) => void;
  onCopyPackageAction: (index: number, actionIndex: number) => void;
  onHomebrewFilter: (filter: HomebrewFilter) => void;
  onMavenFilter: (filter: MavenFilter) => void;
  onOpenPackage: (index: number) => void;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onPipFilter: (filter: PipFilter) => void;
  onRequestCacheCleanup: () => void;
  onRequestPackageUninstall: (index: number) => void;
  onSelectPackage: (index: number | null) => void;
  onToggleActions: (index: number) => void;
  pendingMaintenance: MaintenanceRequest | null;
  scanning: boolean;
  selectedHomebrewFilter: HomebrewFilter;
  selectedMavenFilter: MavenFilter;
  selectedPackageIndex: number | null;
  selectedPipFilter: PipFilter;
}

export const PackageTable = memo(function PackageTable(props: PackageTableProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PackageSort>("name");
  const [descending, setDescending] = useState(false);
  const manager = props.manager;
  const original = useMemo(
    () => !manager ? [] : manager.id === "Homebrew" ? filteredHomebrewPackages(manager, props.selectedHomebrewFilter)
      : manager.id === "Maven" ? filteredMavenPackages(manager, props.selectedMavenFilter)
        : manager.id === "Pip" ? filteredPipPackages(manager, props.selectedPipFilter) : indexedPackages(manager),
    [manager, props.selectedHomebrewFilter, props.selectedMavenFilter, props.selectedPipFilter],
  );
  const deferredQuery = useDeferredValue(query);
  const rows = useMemo(
    () => searchAndSortPackages(original, deferredQuery, sort, descending),
    [original, deferredQuery, sort, descending],
  );
  const changed = () => { props.onSelectPackage(null); };
  return <TooltipProvider>
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <Input aria-label="搜索当前管理器的软件包" placeholder="搜索名称、版本或路径" type="search" value={query} onChange={(event) => { setQuery(event.target.value); changed(); }} className="min-w-40 flex-1" />
      <ToggleGroup type="single" value={sort} onValueChange={(value) => { if (value) { setSort(value as PackageSort); changed(); } }} aria-label="软件包排序字段">
        <ToggleGroupItem value="name">名称</ToggleGroupItem><ToggleGroupItem value="version">版本</ToggleGroupItem>
      </ToggleGroup>
      <Button variant="outline" size="sm" type="button" onClick={() => { setDescending(!descending); changed(); }} aria-label="切换软件包排序方向">{descending ? "降序" : "升序"}</Button>
      <span className="text-xs text-muted-foreground" role="status">{manager ? `${rows.length} / ${manager.packages.length} 项` : "尚未扫描"}</span>
    </div>
    <PackageTableContent {...props} rows={rows} />
  </TooltipProvider>;
});

function PackageTableContent(props: PackageTableProps & { rows: IndexedPackage[] }) {
  const { homeDirectory, manager, scanning } = props;
  if (!manager) {
    if (scanning) return <SkeletonRows label="正在扫描软件包" />;
    return <EmptyState message="尚无清单，请刷新当前管理器" />;
  }

  const unreadMessage = !manager.packages.length && (manager.status === "Missing" || manager.status === "Failed" || manager.status === "Partial")
    ? manager.status === "Missing"
      ? `未找到 ${manager.label}，请查看扫描诊断，确认已安装且应用可以访问`
      : `${manager.label} 扫描不完整，暂未读到条目，请查看扫描诊断后重新扫描`
    : null;

  if (manager.status === "Unsupported") {
    return (
      <div className="px-4 py-4">
        <p className="font-medium text-foreground">{manager.label} 不提供等价的全局软件包清单。</p>
        {manager.unsupportedReason ? <p className="mt-2 text-sm text-muted-foreground">{formatHomePathsInText(displayMessage(manager.unsupportedReason), homeDirectory)}</p> : null}
        <p className="mt-2 text-sm text-muted-foreground">仍可在路径面板查看路径、占用和可用的清理操作。</p>
      </div>
    );
  }

  if (manager.id === "Homebrew") {
    const packages = props.rows;
    return (
      <>
        <FilterBar
          active={props.selectedHomebrewFilter}
          counts={homebrewFilterCounts(manager)}
          filters={["All", "Formulae", "Casks", "Outdated", "Leaves"]}
          labels={homebrewFilterLabels}
          onSelect={props.onHomebrewFilter}
        />
        <SpecializedTable emptyMessage={unreadMessage ?? "没有匹配当前筛选条件的 Homebrew 软件包"} heading={["名称", "版本", "信号", "路径", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Maven") {
    const packages = props.rows;
    return (
      <>
        <MavenSummary health={manager.maven} homeDirectory={homeDirectory} />
        <FilterBar active={props.selectedMavenFilter} filters={["All", "Duplicates", "Snapshots"]} labels={mavenFilterLabels} onSelect={props.onMavenFilter} />
        <SpecializedTable emptyMessage={unreadMessage ?? "没有匹配当前筛选条件的 Maven 构件"} heading={["坐标", "版本", "信号", "路径", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Pip") {
    const packages = props.rows;
    return (
      <>
        <PipSummary health={manager.pip} homeDirectory={homeDirectory} />
        <FilterBar
          active={props.selectedPipFilter}
          filters={["All", "Outdated", "Editable", "UserSite", "DirectUrl"]}
          labels={pipFilterLabels}
          onSelect={props.onPipFilter}
        />
        <SpecializedTable emptyMessage={unreadMessage ?? "没有匹配当前筛选条件的 pip 软件包"} heading={["名称", "版本", "信号", "位置", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Docker") {
    return (
      <>
        <DockerSummary
          cleanupAvailable={manager.status !== "Missing" && !scanning}
          health={manager.docker}
          onRequestCacheCleanup={props.onRequestCacheCleanup}
          pendingCleanup={props.pendingMaintenance?.kind === "cleanupCache" && props.pendingMaintenance.managerId === "Docker"}
        />
        <SpecializedTable emptyMessage={unreadMessage ?? "未找到 Docker 镜像、容器或卷"} heading={["名称", "状态 / 大小", "信号", "位置", "操作"]} packages={props.rows} {...props} />
      </>
    );
  }

  if (manager.id === "AndroidSdk") {
    return (
      <SpecializedTable
        emptyMessage={unreadMessage ?? "未找到可识别的 SDK 组件"}
        heading={["组件", "版本", "说明", "路径", "操作"]}
        middleColumn="description"
        showKindBadge={false}
        uninstallBlockedReason={(pkg) => androidSdkUninstallBlockReason(manager, pkg)}
        packages={props.rows}
        {...props}
      />
    );
  }

  const globalModulesPath = manager.paths.find((path) => path.kind === "GlobalModules" || path.kind === "GlobalDir") ?? null;

  if (!props.rows.length) {
    return (
      <>
        <GlobalModulesBar homeDirectory={homeDirectory} onCopyPath={props.onCopyPath} onOpenPath={props.onOpenPath} path={globalModulesPath} />
        <EmptyState message={unreadMessage ?? (manager.packages.length ? "没有匹配的条目，请调整搜索词" : manager.id === "Cargo" ? "未找到通过 cargo install 安装的二进制 crate" : manager.id === "Fvm" ? "未找到已安装的 Flutter 版本" : manager.id === "Nvm" ? "未找到已安装的 Node 版本" : "未找到全局软件包")} />
      </>
    );
  }

  const usesCompactTable = manager.id === "Npm" || manager.id === "Pnpm" || manager.id === "Nvm" || manager.id === "Fvm";
  const showSourceColumn = !usesCompactTable;
  const showPathColumn = !usesCompactTable;
  const heading = usesCompactTable ? ["名称", "版本", "操作"] : ["名称", "版本", "来源", "路径", "操作"];
  const packageNameClassName = usesCompactTable ? "min-w-24 max-w-35 truncate font-medium" : "min-w-45 max-w-70 truncate font-medium";

  return (
    <>
      <GlobalModulesBar homeDirectory={homeDirectory} onCopyPath={props.onCopyPath} onOpenPath={props.onOpenPath} path={globalModulesPath} />
      <TableShell compact={usesCompactTable} heading={heading}>
        {props.rows.map(({ pkg, index }) => (
          <TableRow
            className="cursor-pointer"
            data-package-observation={packageObservationId(manager!.id, pkg)}
            data-state={index === props.selectedPackageIndex ? "selected" : undefined}
            key={`${pkg.name}-${pkg.version}-${index}`}
            onClick={() => props.onSelectPackage(index)}
          >
            <TableCell className={packageNameClassName}>
              <PackageName pkg={pkg} selected={index === props.selectedPackageIndex} onSelect={() => props.onSelectPackage(index)}>
                {usesCompactTable ? renderPackageSignals(pkg) : null}
              </PackageName>
            </TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground">{pkg.version}</TableCell>
            {showSourceColumn ? <TableCell className="max-w-52 truncate text-muted-foreground">{shorten(formatHomePathsInText(pkg.source, homeDirectory))}</TableCell> : null}
            {showPathColumn ? <TableCell className="max-w-60 truncate text-muted-foreground">{pkg.path ? formatHomePath(pkg.path, homeDirectory) : "无"}</TableCell> : null}
            <TableCell className={usesCompactTable ? "w-32 text-right" : "w-24 text-right"}>
              <PackageActions
                index={index}
                managerId={manager.id}
                menuOpen={props.menuOpenIndex === index}
                onCopyPackage={props.onCopyPackage}
                onCopyPackageAction={props.onCopyPackageAction}
                onOpenPackage={props.onOpenPackage}
                onRequestUninstall={props.onRequestPackageUninstall}
                onToggle={props.onToggleActions}
                pendingUninstall={isPendingUninstall(props.pendingMaintenance, manager.id, index, pkg.name)}
                pkg={pkg}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableShell>
    </>
  );
}

function GlobalModulesBar({
  homeDirectory,
  onCopyPath,
  onOpenPath,
  path,
}: {
  homeDirectory: string | null;
  onCopyPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  path: ManagerSnapshot["paths"][number] | null;
}) {
  if (!path) return null;

  const sizeValue = path.size.status === "Ready" ? (path.size.human ?? "0 B") : null;
  const label = pathLabel(path.label);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-4 py-3">
      <span className="shrink-0 text-sm font-medium text-foreground">{label}</span>
      {sizeValue ? <span className="shrink-0 text-sm text-muted-foreground">{sizeValue}</span> : <StatusBadge status={path.size.status} />}
      <code className="terminal-code h-6 min-w-48 flex-1 truncate px-2 text-xs leading-6 text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code>
      <IconButton className="size-6" label={`复制${label}路径`} onClick={() => onCopyPath(path.path)}>
        <Copy />
      </IconButton>
      <IconButton className="size-6" disabled={path.size.status === "Missing"} label={`打开${label}路径`} onClick={() => onOpenPath(path.path)}>
        <ExternalLink />
      </IconButton>
    </div>
  );
}

function SpecializedTable({
  emptyMessage,
  heading,
  menuOpenIndex,
  onCopyPackage,
  onCopyPackageAction,
  onOpenPackage,
  onRequestPackageUninstall,
  onSelectPackage,
  onToggleActions,
  packages,
  pendingMaintenance,
  selectedPackageIndex,
  homeDirectory,
  manager,
  middleColumn = "signals",
  showKindBadge = true,
  uninstallBlockedReason,
}: PackageTableProps & {
  emptyMessage: string;
  heading: string[];
  packages: IndexedPackage[];
  middleColumn?: "signals" | "description";
  showKindBadge?: boolean;
  uninstallBlockedReason?: (pkg: PackageRow) => string | null;
}) {
  if (!packages.length) return <EmptyState message={emptyMessage} />;

  return (
    <TableShell heading={heading}>
      {packages.map(({ pkg, index }) => (
        <TableRow
          className="cursor-pointer"
          data-package-observation={packageObservationId(manager!.id, pkg)}
          data-state={index === selectedPackageIndex ? "selected" : undefined}
          key={`${pkg.name}-${pkg.version}-${index}`}
          onClick={() => onSelectPackage(index)}
        >
          <TableCell className="min-w-45 max-w-70 truncate">
            <PackageName pkg={pkg} selected={index === selectedPackageIndex} onSelect={() => onSelectPackage(index)}>
              {showKindBadge ? <Badge className="shrink-0" variant="secondary">{packageKindLabels[pkg.kind]}</Badge> : null}
            </PackageName>
          </TableCell>
          <TableCell className="max-w-32 truncate text-muted-foreground">{pkg.version}</TableCell>
          <TableCell>
            {middleColumn === "description" ? (
              <span className="block max-w-70 truncate text-muted-foreground" title={pkg.source}>{formatHomePathsInText(pkg.source, homeDirectory)}</span>
            ) : (
              <span className="flex min-w-0 flex-wrap gap-1.5">{renderPackageSignals(pkg)}</span>
            )}
          </TableCell>
          <TableCell className="max-w-60 truncate text-muted-foreground">{pkg.path ? formatHomePath(pkg.path, homeDirectory) : "无"}</TableCell>
          <TableCell className="w-24 text-right">
            <PackageActions
              index={index}
              managerId={manager?.id ?? ""}
              menuOpen={menuOpenIndex === index}
              onCopyPackage={onCopyPackage}
              onCopyPackageAction={onCopyPackageAction}
              onOpenPackage={onOpenPackage}
              onRequestUninstall={onRequestPackageUninstall}
              onToggle={onToggleActions}
              pendingUninstall={isPendingUninstall(pendingMaintenance, manager?.id, index, pkg.name)}
              pkg={pkg}
              uninstallBlockedReason={uninstallBlockedReason?.(pkg) ?? null}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableShell>
  );
}

function isPendingUninstall(pending: MaintenanceRequest | null, managerId: ManagerSnapshot["id"] | undefined, index: number, packageName: string) {
  return (pending?.kind === "uninstallGlobalPackage" || pending?.kind === "uninstallSdkComponent") && pending.managerId === managerId && pending.packageIndex === index && pending.packageName === packageName;
}

function TableShell({
  children,
  compact = false,
  heading,
}: {
  children: React.ReactNode;
  compact?: boolean;
  heading: string[];
}) {
  return (
    <Table className={compact ? "table-fixed" : "min-w-[760px]"}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {heading.map((item) => (
            <TableHead className={cx(compact && item === "版本" && "w-32", item === "操作" && (compact ? "w-32 text-right" : "w-24 text-right"))} key={item}>
              {item}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function PackageName({ children, onSelect, pkg, selected }: {
  children?: React.ReactNode;
  onSelect: () => void;
  pkg: PackageRow;
  selected: boolean;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <button
        aria-label={`选择 ${pkg.name} ${pkg.version}`}
        aria-pressed={selected}
        className="min-w-0 truncate rounded-sm text-left font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        title={pkg.name}
        type="button"
      >
        {pkg.name}
      </button>
      {children}
    </span>
  );
}

function renderPackageSignals(pkg: PackageRow) {
  if (!pkg.signals.length) return null;

  return pkg.signals.map((signal) => (
    <SignalBadge key={signal} tone="partial">
      {signalLabels[signal]}
    </SignalBadge>
  ));
}

function MavenSummary({ health, homeDirectory }: { health: MavenRepositoryHealth | null; homeDirectory: string | null }) {
  if (!health) return null;
  const scanStatus = health.repositoryScanStatus.partial ? "部分可用" : "就绪";

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="stat-grid grid-cols-2 md:grid-cols-5">
        <StatCard label="构件" value={String(health.artifactCount)} />
        <StatCard label="版本" value={String(health.versionCount)} />
        <StatCard label="快照版" value={String(health.snapshotCount)} />
        <StatCard label="多版本" value={String(health.duplicateArtifactCount)} />
        <StatCard label="扫描" value={scanStatus} />
      </div>
      <p className="text-sm text-muted-foreground">{formatHomePath(health.localRepository, homeDirectory)}</p>
      {health.repositoryScanStatus.message ? (
        <p className="text-sm text-muted-foreground">
          {formatHomePathsInText(displayMessage(health.repositoryScanStatus.message), homeDirectory)} · 已扫描 {health.repositoryScanStatus.scannedVersionDirs} 个版本目录 · 跳过 {health.repositoryScanStatus.skipped} 项
        </p>
      ) : null}
    </div>
  );
}

function PipSummary({ health, homeDirectory }: { health: PipEnvironmentHealth | null; homeDirectory: string | null }) {
  if (!health) return null;
  const outdatedValue = health.outdatedStatus === "Ready" ? String(health.outdatedCount) : health.outdatedStatus === "Pending" ? "等待中" : "失败";

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="stat-grid grid-cols-2 md:grid-cols-5">
        <StatCard label="已安装" value={String(health.installedCount)} />
        <StatCard label="可更新" value={outdatedValue} />
        <StatCard label="可编辑" value={String(health.editableCount)} />
        <StatCard label="直接 URL" value={String(health.directUrlCount)} />
        <StatCard label="环境" value={environmentKindLabels[health.environmentKind]} />
      </div>
      <p className="text-sm text-muted-foreground">
        {health.pythonVersion} · {formatHomePath(health.pythonExecutable, homeDirectory)}
      </p>
      {health.outdatedMessage && health.outdatedStatus === "Failed" ? <p className="text-sm font-medium text-destructive">{formatHomePathsInText(displayMessage(health.outdatedMessage), homeDirectory)}</p> : null}
    </div>
  );
}

function DockerSummary({
  cleanupAvailable,
  health,
  onRequestCacheCleanup,
  pendingCleanup,
}: {
  cleanupAvailable: boolean;
  health: DockerResourceHealth | null;
  onRequestCacheCleanup: () => void;
  pendingCleanup: boolean;
}) {
  if (!health) return null;
  const diskRows = health.diskUsage.slice(0, 4);
  const cleanupCopy = cleanupAvailable ? cleanupCopyFor("Docker") : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="stat-grid grid-cols-2 md:grid-cols-3">
        <StatCard label="镜像" value={String(health.imageCount)} />
        <StatCard label="容器" value={String(health.containerCount)} />
        <StatCard label="运行中" value={String(health.runningContainerCount)} />
        <StatCard label="卷" value={String(health.volumeCount)} />
        <StatCard label="悬空镜像（dangling）" value={String(health.danglingImageCount)} />
        <StatCard label="未使用镜像（含悬空）" value={String(health.unusedImageCount)} />
      </div>
      {diskRows.length ? (
        <div className="stat-grid grid-cols-2 md:grid-cols-4">
          {diskRows.map((row) => (
            <div className="min-w-0" key={row.resourceType}>
              <StatCard label={`${row.resourceType} · Docker 报告可回收`} value={row.reclaimable || "—"} />
              <p className="border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground">Docker 报告占用 {row.size || "—"}</p>
            </div>
          ))}
        </div>
      ) : health.diskUsageStatus === "Failed" ? (
        <p className="text-sm font-medium text-destructive">{displayMessage(health.diskUsageMessage ?? "Docker disk usage failed")}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">以上为 docker system df 的报告值。本工具仅清理构建缓存和悬空镜像，报告值不代表本次实际释放空间；容器和卷不在清理范围内。</p>
      {/* Anchored here rather than on a path card: the plan prunes build cache
          and dangling images, and these are the figures that justify running it. */}
      {cleanupCopy ? (
        <div className="mt-1 flex">
          <Button disabled={pendingCleanup} onClick={onRequestCacheCleanup} size="sm" type="button" variant="outline">
            <Trash2 data-icon="inline-start" />
            {pendingCleanup ? "清理中" : cleanupCopy.action}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterBar<T extends string>({
  active,
  counts,
  filters,
  labels,
  onSelect,
}: {
  active: T;
  counts?: Partial<Record<T, number | string>>;
  filters: T[];
  labels: Record<T, string>;
  onSelect: (filter: T) => void;
}) {
  return (
    <ToggleGroup
      className="flex flex-wrap justify-start border-t px-4 py-3"
      onValueChange={(value) => {
        if (value) onSelect(value as T);
      }}
      type="single"
      value={active}
      variant="outline"
    >
      {filters.map((filter) => {
        const count = counts?.[filter];

        return (
          <ToggleGroupItem
            key={filter}
            size="sm"
            value={filter}
          >
            {labels[filter]}
            {count !== undefined ? <Badge variant="secondary">{count}</Badge> : null}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function homebrewFilterCounts(manager: ManagerSnapshot): Partial<Record<HomebrewFilter, number>> {
  const maintenance = manager.homebrew;
  if (!maintenance) return { All: manager.packages.length };

  return {
    All: manager.packages.length,
    Formulae: maintenance.formulaCount,
    Casks: maintenance.caskCount,
    Outdated: maintenance.outdatedCount,
    Leaves: maintenance.leafCount,
  };
}
