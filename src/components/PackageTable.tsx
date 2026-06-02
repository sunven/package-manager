import { Copy, ExternalLink } from "lucide-react";
import { environmentKindLabels, homebrewFilterLabels, mavenFilterLabels, packageKindLabels, pipFilterLabels, signalLabels } from "../constants";
import type {
  HomebrewFilter,
  HomebrewMaintenance,
  ManagerSnapshot,
  MavenFilter,
  MavenRepositoryHealth,
  PackageRow,
  PipEnvironmentHealth,
  PipFilter,
} from "../types";
import { displayMessage, pathLabel } from "../utils/format";
import { filteredHomebrewPackages, filteredMavenPackages, filteredPipPackages, indexedPackages, type IndexedPackage } from "../utils/filters";
import { cx } from "../utils/classNames";
import { EmptyState, IconButton, SignalBadge, StatCard, StatusBadge } from "./ui";
import { PackageActions } from "./PackageActions";
import { Badge } from "../../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";

interface PackageTableProps {
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
  onSelectPackage: (index: number) => void;
  onToggleActions: (index: number) => void;
  scanning: boolean;
  selectedHomebrewFilter: HomebrewFilter;
  selectedMavenFilter: MavenFilter;
  selectedPackageIndex: number;
  selectedPipFilter: PipFilter;
}

export function PackageTable(props: PackageTableProps) {
  const { manager, scanning } = props;
  if (!manager) {
    return <EmptyState message={scanning ? "正在扫描软件包..." : "尚未扫描"} />;
  }

  if (manager.id === "Homebrew") {
    const packages = filteredHomebrewPackages(manager, props.selectedHomebrewFilter);
    return (
      <>
        <HomebrewSummary maintenance={manager.homebrew} />
        <FilterBar
          active={props.selectedHomebrewFilter}
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
        <MavenSummary health={manager.maven} />
        <FilterBar active={props.selectedMavenFilter} filters={["All", "Duplicates", "Snapshots"]} labels={mavenFilterLabels} onSelect={props.onMavenFilter} />
        <SpecializedTable emptyMessage="没有匹配当前筛选条件的 Maven 构件" heading={["坐标", "版本", "信号", "路径", "操作"]} packages={packages} {...props} />
      </>
    );
  }

  if (manager.id === "Pip") {
    const packages = filteredPipPackages(manager, props.selectedPipFilter);
    return (
      <>
        <PipSummary health={manager.pip} />
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

  if (manager.status === "Unsupported") {
    return (
      <div className="px-5 py-8">
        <p className="font-medium text-foreground">Yarn 现代版本不提供全局软件包列表。</p>
        <p className="mt-2 text-sm text-muted-foreground">{displayMessage(manager.unsupportedReason ?? "当前状态不支持扫描")}</p>
      </div>
    );
  }

  const globalModulesPath = manager.paths.find((path) => path.kind === "GlobalModules" || path.kind === "GlobalDir") ?? null;

  if (!manager.packages.length) {
    return (
      <>
        <GlobalModulesBar onCopyPath={props.onCopyPath} onOpenPath={props.onOpenPath} path={globalModulesPath} />
        <EmptyState message="未找到全局软件包" />
      </>
    );
  }

  return (
    <>
      <GlobalModulesBar onCopyPath={props.onCopyPath} onOpenPath={props.onOpenPath} path={globalModulesPath} />
      <TableShell heading={["名称", "版本", "来源", "路径", "操作"]}>
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
            <TableCell className="min-w-45 max-w-70 truncate font-medium">{pkg.name}</TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground">{pkg.version}</TableCell>
            <TableCell className="max-w-52 truncate text-muted-foreground">{shortenPath(pkg.source)}</TableCell>
            <TableCell className="max-w-60 truncate text-muted-foreground">{pkg.path ?? "无"}</TableCell>
            <TableCell className="w-24 text-right">
              <PackageActions
                index={index}
                menuOpen={props.menuOpenIndex === index}
                onCopyPackage={props.onCopyPackage}
                onCopyPackageAction={props.onCopyPackageAction}
                onOpenPackage={props.onOpenPackage}
                onToggle={props.onToggleActions}
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
  onCopyPath,
  onOpenPath,
  path,
}: {
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
      <code className="min-w-48 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{path.path}</code>
      <IconButton label={`复制${label}路径`} onClick={() => onCopyPath(path.path)}>
        <Copy />
      </IconButton>
      <IconButton disabled={path.size.status === "Missing"} label={`打开${label}路径`} onClick={() => onOpenPath(path.path)}>
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
  onSelectPackage,
  onToggleActions,
  packages,
  selectedPackageIndex,
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
          <TableCell className="max-w-60 truncate text-muted-foreground">{pkg.path ?? "无"}</TableCell>
          <TableCell className="w-24 text-right">
            <PackageActions
              index={index}
              menuOpen={menuOpenIndex === index}
              onCopyPackage={onCopyPackage}
              onCopyPackageAction={onCopyPackageAction}
              onOpenPackage={onOpenPackage}
              onToggle={onToggleActions}
              pkg={pkg}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableShell>
  );
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
          <TableRow>
          {heading.map((item) => (
              <TableHead className={item === "操作" ? "w-24 text-right" : undefined} key={item}>{item}</TableHead>
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
  if (!pkg.signals.length) return <SignalBadge tone="neutral">当前版本</SignalBadge>;

  return pkg.signals.map((signal) => (
    <SignalBadge key={signal} tone={signal === "Outdated" || signal === "DuplicateVersions" ? "warn" : "partial"}>
      {signalLabels[signal]}
    </SignalBadge>
  ));
}

function HomebrewSummary({ maintenance }: { maintenance: HomebrewMaintenance | null }) {
  if (!maintenance) return null;
  const cleanup = maintenance.cleanup;
  const cleanupValue = cleanup.status === "Ready" ? cleanup.reclaimedHuman ?? "就绪" : cleanup.status === "Pending" ? "等待中" : "失败";

  return (
    <div className="grid grid-cols-2 gap-2.5 p-4 md:grid-cols-5">
      <StatCard label="配方包" value={String(maintenance.formulaCount)} />
      <StatCard label="应用包" value={String(maintenance.caskCount)} />
      <StatCard label="可更新" value={String(maintenance.outdatedCount)} />
      <StatCard label="叶子包" value={String(maintenance.leafCount)} />
      <StatCard label="清理" value={cleanupValue} />
    </div>
  );
}

function MavenSummary({ health }: { health: MavenRepositoryHealth | null }) {
  if (!health) return null;
  const scanStatus = health.repositoryScanStatus.partial ? "部分可用" : "就绪";

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <StatCard label="构件" value={String(health.artifactCount)} />
        <StatCard label="版本" value={String(health.versionCount)} />
        <StatCard label="快照版" value={String(health.snapshotCount)} />
        <StatCard label="多版本" value={String(health.duplicateArtifactCount)} />
        <StatCard label="扫描" value={scanStatus} />
      </div>
      {health.repositoryScanStatus.message ? (
        <p className="text-sm text-muted-foreground">
          {displayMessage(health.repositoryScanStatus.message)} · 已扫描 {health.repositoryScanStatus.scannedVersionDirs} 个版本目录 · 跳过 {health.repositoryScanStatus.skipped} 项
        </p>
      ) : null}
    </div>
  );
}

function PipSummary({ health }: { health: PipEnvironmentHealth | null }) {
  if (!health) return null;
  const outdatedValue = health.outdatedStatus === "Ready" ? String(health.outdatedCount) : health.outdatedStatus === "Pending" ? "等待中" : "失败";

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <StatCard label="已安装" value={String(health.installedCount)} />
        <StatCard label="可更新" value={outdatedValue} />
        <StatCard label="可编辑" value={String(health.editableCount)} />
        <StatCard label="直接 URL" value={String(health.directUrlCount)} />
        <StatCard label="环境" value={environmentKindLabels[health.environmentKind]} />
      </div>
      <p className="text-sm text-muted-foreground">
        {health.pythonVersion} · {health.pythonExecutable}
      </p>
      {health.outdatedMessage && health.outdatedStatus === "Failed" ? <p className="text-sm font-medium text-destructive">{displayMessage(health.outdatedMessage)}</p> : null}
    </div>
  );
}

function FilterBar<T extends string>({
  active,
  filters,
  labels,
  onSelect,
}: {
  active: T;
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
      {filters.map((filter) => (
        <ToggleGroupItem
          key={filter}
          size="sm"
          value={filter}
        >
          {labels[filter]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function shortenPath(value: string) {
  const parts = value.split("/");
  if (parts.length <= 4) return value;
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}
