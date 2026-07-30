import { Copy, ExternalLink, Trash2 } from "lucide-react";
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
import { displayMessage, formatHomePath, formatHomePathsInText, pathLabel } from "../utils/format";
import { filteredHomebrewPackages, filteredMavenPackages, filteredPipPackages, indexedPackages, type IndexedPackage } from "../utils/filters";
import { cleanupCopyFor } from "../cleanupCopy";
import { cx } from "../utils/classNames";
import { EmptyState, IconButton, SignalBadge, StatCard, StatusBadge } from "./ui";
import { PackageActions } from "./PackageActions";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";

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
  onSelectPackage: (index: number) => void;
  onToggleActions: (index: number) => void;
  pendingMaintenance: MaintenanceRequest | null;
  scanning: boolean;
  selectedHomebrewFilter: HomebrewFilter;
  selectedMavenFilter: MavenFilter;
  selectedPackageIndex: number | null;
  selectedPipFilter: PipFilter;
}

export function PackageTable(props: PackageTableProps) {
  const { homeDirectory, manager, scanning } = props;
  if (!manager) {
    return <EmptyState message={scanning ? "正在扫描软件包..." : "尚未扫描"} />;
  }

  if (manager.id === "Homebrew") {
    const packages = filteredHomebrewPackages(manager, props.selectedHomebrewFilter);
    return (
      <>
        <FilterBar
          active={props.selectedHomebrewFilter}
          counts={homebrewFilterCounts(manager)}
          filters={["All", "Formulae", "Casks", "Outdated", "Leaves"]}
          labels={homebrewFilterLabels}
          onSelect={props.onHomebrewFilter}
        />
        <SpecializedTable emptyMessage="没有匹配当前筛选条件的 Homebrew 软件包" heading={["名称", "版本", "信号", "路径", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Maven") {
    const packages = filteredMavenPackages(manager, props.selectedMavenFilter);
    return (
      <>
        <MavenSummary health={manager.maven} homeDirectory={homeDirectory} />
        <FilterBar active={props.selectedMavenFilter} filters={["All", "Duplicates", "Snapshots"]} labels={mavenFilterLabels} onSelect={props.onMavenFilter} />
        <SpecializedTable emptyMessage="没有匹配当前筛选条件的 Maven 构件" heading={["坐标", "版本", "信号", "路径", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Pip") {
    const packages = filteredPipPackages(manager, props.selectedPipFilter);
    return (
      <>
        <PipSummary health={manager.pip} homeDirectory={homeDirectory} />
        <FilterBar
          active={props.selectedPipFilter}
          filters={["All", "Outdated", "Editable", "UserSite", "DirectUrl"]}
          labels={pipFilterLabels}
          onSelect={props.onPipFilter}
        />
        <SpecializedTable emptyMessage="没有匹配当前筛选条件的 pip 软件包" heading={["名称", "版本", "信号", "位置", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Docker") {
    return (
      <>
        <DockerSummary
          cleanupAvailable={manager.status !== "Missing"}
          health={manager.docker}
          onRequestCacheCleanup={props.onRequestCacheCleanup}
          pendingCleanup={props.pendingMaintenance?.kind === "cleanupCache" && props.pendingMaintenance.managerId === "Docker"}
        />
        <SpecializedTable emptyMessage="未找到 Docker 镜像、容器或卷" heading={["名称", "状态 / 大小", "信号", "位置", "操作"]} packages={indexedPackages(manager)} {...props} />
      </>
    );
  }

  if (manager.status === "Unsupported") {
    return (
      <div className="px-5 py-8">
        <p className="font-medium text-foreground">Yarn 现代版本不提供全局软件包列表。</p>
        <p className="mt-2 text-sm text-muted-foreground">{formatHomePathsInText(displayMessage(manager.unsupportedReason ?? "当前状态不支持扫描"), homeDirectory)}</p>
      </div>
    );
  }

  const globalModulesPath = manager.paths.find((path) => path.kind === "GlobalModules" || path.kind === "GlobalDir") ?? null;

  if (!manager.packages.length) {
    return (
      <>
        <GlobalModulesBar homeDirectory={homeDirectory} onCopyPath={props.onCopyPath} onOpenPath={props.onOpenPath} path={globalModulesPath} />
        <EmptyState message={manager.id === "Cargo" ? "未找到通过 cargo install 安装的二进制 crate" : "未找到全局软件包"} />
      </>
    );
  }

  const usesCompactTable = manager.id === "Npm" || manager.id === "Pnpm" || manager.id === "Nvm";
  const showSourceColumn = !usesCompactTable;
  const showPathColumn = !usesCompactTable;
  const heading = usesCompactTable ? ["名称", "版本", "操作"] : ["名称", "版本", "来源", "路径", "操作"];
  const packageNameClassName = usesCompactTable ? "min-w-24 max-w-35 truncate font-medium" : "min-w-45 max-w-70 truncate font-medium";

  return (
    <>
      <GlobalModulesBar homeDirectory={homeDirectory} onCopyPath={props.onCopyPath} onOpenPath={props.onOpenPath} path={globalModulesPath} />
      <TableShell heading={heading}>
        {indexedPackages(manager).map(({ pkg, index }) => (
          <TableRow
            className={cx(
              "cursor-pointer",
              index === props.selectedPackageIndex && "bg-muted",
            )}
            key={`${pkg.name}-${pkg.version}-${index}`}
            onClick={() => props.onSelectPackage(index)}
            onKeyDown={(event) => selectRowWithKeyboard(event, () => props.onSelectPackage(index))}
            role="button"
            tabIndex={0}
          >
            <TableCell className={packageNameClassName}>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate">{pkg.name}</span>
                {usesCompactTable ? renderPackageSignals(pkg) : null}
              </span>
            </TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground">{pkg.version}</TableCell>
            {showSourceColumn ? <TableCell className="max-w-52 truncate text-muted-foreground">{shortenPath(formatHomePathsInText(pkg.source, homeDirectory))}</TableCell> : null}
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
      <code className="h-6 min-w-48 flex-1 truncate rounded-md bg-muted px-2 text-xs leading-6 text-muted-foreground">{formatHomePath(path.path, homeDirectory)}</code>
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
}: PackageTableProps & {
  emptyMessage: string;
  heading: string[];
  packages: IndexedPackage[];
}) {
  if (!packages.length) return <EmptyState message={emptyMessage} />;

  return (
    <TableShell heading={heading}>
      {packages.map(({ pkg, index }) => (
        <TableRow
          className={cx(
            "cursor-pointer",
            index === selectedPackageIndex && "bg-muted",
          )}
          key={`${pkg.name}-${pkg.version}-${index}`}
          onClick={() => onSelectPackage(index)}
          onKeyDown={(event) => selectRowWithKeyboard(event, () => onSelectPackage(index))}
          role="button"
          tabIndex={0}
        >
          <TableCell className="min-w-45 max-w-70 truncate">
            <PackageName pkg={pkg} />
          </TableCell>
          <TableCell className="max-w-32 truncate text-muted-foreground">{pkg.version}</TableCell>
          <TableCell>
            <span className="flex min-w-0 flex-wrap gap-1.5">{renderPackageSignals(pkg)}</span>
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
            />
          </TableCell>
        </TableRow>
      ))}
    </TableShell>
  );
}

function isPendingUninstall(pending: MaintenanceRequest | null, managerId: ManagerSnapshot["id"] | undefined, index: number, packageName: string) {
  return pending?.kind === "uninstallGlobalPackage" && pending.managerId === managerId && pending.packageIndex === index && pending.packageName === packageName;
}

function selectRowWithKeyboard(event: React.KeyboardEvent, select: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  select();
}

function TableShell({
  children,
  heading,
}: {
  children: React.ReactNode;
  heading: string[];
}) {
  return (
    <div className="min-w-[760px]">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {heading.map((item) => (
              <TableHead className={cx("font-semibold", item === "操作" && "w-24 text-right")} key={item}>
                {item}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function PackageName({ pkg }: { pkg: PackageRow }) {
  return (
    <span className="min-w-0 truncate font-medium">
      {pkg.name}
      <Badge className="ml-2 align-middle" variant="secondary">
        {packageKindLabels[pkg.kind]}
      </Badge>
    </span>
  );
}

function renderPackageSignals(pkg: PackageRow) {
  if (!pkg.signals.length) return null;

  return pkg.signals.map((signal) => (
    <SignalBadge key={signal} tone={signal === "Outdated" || signal === "DuplicateVersions" ? "warn" : "partial"}>
      {signalLabels[signal]}
    </SignalBadge>
  ));
}

function MavenSummary({ health, homeDirectory }: { health: MavenRepositoryHealth | null; homeDirectory: string | null }) {
  if (!health) return null;
  const scanStatus = health.repositoryScanStatus.partial ? "部分可用" : "就绪";

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="grid grid-cols-5 gap-2.5">
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
    <div className="flex flex-col gap-2 p-4">
      <div className="grid grid-cols-5 gap-2.5">
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
    <div className="flex flex-col gap-2 p-4">
      <div className="grid grid-cols-5 gap-2.5">
        <StatCard label="镜像" value={String(health.imageCount)} />
        <StatCard label="容器" value={String(health.containerCount)} />
        <StatCard label="运行中" value={String(health.runningContainerCount)} />
        <StatCard label="卷" value={String(health.volumeCount)} />
        <StatCard label="清理信号" value={String(health.danglingImageCount + health.unusedImageCount)} />
      </div>
      {diskRows.length ? (
        <div className="grid grid-cols-4 gap-2.5">
          {diskRows.map((row) => (
            <StatCard key={row.resourceType} label={row.resourceType} value={row.reclaimable || row.size} />
          ))}
        </div>
      ) : health.diskUsageStatus === "Failed" ? (
        <p className="text-sm font-medium text-destructive">{displayMessage(health.diskUsageMessage ?? "Docker disk usage failed")}</p>
      ) : null}
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
      className="flex flex-wrap justify-start border-y px-4 py-3"
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

function shortenPath(value: string) {
  const parts = value.split("/");
  if (parts.length <= 4) return value;
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}
