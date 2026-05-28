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
import { displayMessage } from "../utils/format";
import { filteredHomebrewPackages, filteredMavenPackages, filteredPipPackages, indexedPackages, type IndexedPackage } from "../utils/filters";
import { cx } from "../utils/classNames";
import { EmptyState, SignalBadge, StatCard } from "./ui";
import { PackageActions } from "./PackageActions";

interface PackageTableProps {
  manager: ManagerSnapshot | null;
  menuOpenIndex: number | null;
  onCopyPackage: (index: number) => void;
  onCopyPackageAction: (index: number, actionIndex: number) => void;
  onHomebrewFilter: (filter: HomebrewFilter) => void;
  onMavenFilter: (filter: MavenFilter) => void;
  onOpenPackage: (index: number) => void;
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
        <p className="font-bold text-slate-600">Yarn 现代版本不提供全局软件包列表。</p>
        <p className="mt-2 text-sm text-slate-500">{displayMessage(manager.unsupportedReason ?? "当前状态不支持扫描")}</p>
      </div>
    );
  }

  if (!manager.packages.length) {
    return <EmptyState message="未找到全局软件包" />;
  }

  return (
    <TableShell cols="grid-cols-[minmax(180px,1.1fr)_minmax(90px,0.55fr)_minmax(140px,0.8fr)_minmax(160px,1fr)_96px]" heading={["名称", "版本", "来源", "路径", "操作"]}>
      {indexedPackages(manager).map(({ pkg, index }) => (
        <div
          className={cx(
            "grid min-h-14 grid-cols-[minmax(180px,1.1fr)_minmax(90px,0.55fr)_minmax(140px,0.8fr)_minmax(160px,1fr)_96px] items-center gap-3 border-t border-slate-100 px-4 py-2 text-left text-sm transition hover:bg-slate-50",
            index === props.selectedPackageIndex && "bg-teal-50",
          )}
          key={`${pkg.name}-${pkg.version}-${index}`}
          onClick={() => props.onSelectPackage(index)}
          onKeyDown={(event) => selectRowWithKeyboard(event, () => props.onSelectPackage(index))}
          role="button"
          tabIndex={0}
        >
          <span className="min-w-0 truncate font-bold text-slate-800">{pkg.name}</span>
          <span className="min-w-0 truncate text-slate-600">{pkg.version}</span>
          <span className="min-w-0 truncate text-slate-500">{shortenPath(pkg.source)}</span>
          <span className="min-w-0 truncate text-slate-500">{pkg.path ?? "无"}</span>
          <span className="justify-self-end">
            <PackageActions
              index={index}
              menuOpen={props.menuOpenIndex === index}
              onCopyPackage={props.onCopyPackage}
              onCopyPackageAction={props.onCopyPackageAction}
              onOpenPackage={props.onOpenPackage}
              onToggle={props.onToggleActions}
              pkg={pkg}
            />
          </span>
        </div>
      ))}
    </TableShell>
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
    <TableShell cols="grid-cols-[minmax(180px,1.05fr)_minmax(90px,0.45fr)_minmax(120px,0.75fr)_minmax(160px,1fr)_96px]" heading={heading}>
      {packages.map(({ pkg, index }) => (
        <div
          className={cx(
            "grid min-h-14 grid-cols-[minmax(180px,1.05fr)_minmax(90px,0.45fr)_minmax(120px,0.75fr)_minmax(160px,1fr)_96px] items-center gap-3 border-t border-slate-100 px-4 py-2 text-left text-sm transition hover:bg-slate-50",
            index === selectedPackageIndex && "bg-teal-50",
          )}
          key={`${pkg.name}-${pkg.version}-${index}`}
          onClick={() => onSelectPackage(index)}
          onKeyDown={(event) => selectRowWithKeyboard(event, () => onSelectPackage(index))}
          role="button"
          tabIndex={0}
        >
          <PackageName pkg={pkg} />
          <span className="min-w-0 truncate text-slate-600">{pkg.version}</span>
          <span className="flex min-w-0 flex-wrap gap-1.5">{renderPackageSignals(pkg)}</span>
          <span className="min-w-0 truncate text-slate-500">{pkg.path ?? "无"}</span>
          <span className="justify-self-end">
            <PackageActions
              index={index}
              menuOpen={menuOpenIndex === index}
              onCopyPackage={onCopyPackage}
              onCopyPackageAction={onCopyPackageAction}
              onOpenPackage={onOpenPackage}
              onToggle={onToggleActions}
              pkg={pkg}
            />
          </span>
        </div>
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
  cols,
  heading,
}: {
  children: React.ReactNode;
  cols: string;
  heading: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className={cx("grid gap-3 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500", cols)}>
          {heading.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function PackageName({ pkg }: { pkg: PackageRow }) {
  return (
    <span className="min-w-0 truncate font-bold text-slate-800">
      {pkg.name}
      <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 align-middle text-[10px] font-bold text-slate-500">
        {packageKindLabels[pkg.kind]}
      </span>
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
    <div className="space-y-2 p-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <StatCard label="构件" value={String(health.artifactCount)} />
        <StatCard label="版本" value={String(health.versionCount)} />
        <StatCard label="快照版" value={String(health.snapshotCount)} />
        <StatCard label="多版本" value={String(health.duplicateArtifactCount)} />
        <StatCard label="扫描" value={scanStatus} />
      </div>
      {health.repositoryScanStatus.message ? (
        <p className="text-sm text-slate-500">
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
    <div className="space-y-2 p-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <StatCard label="已安装" value={String(health.installedCount)} />
        <StatCard label="可更新" value={outdatedValue} />
        <StatCard label="可编辑" value={String(health.editableCount)} />
        <StatCard label="直接 URL" value={String(health.directUrlCount)} />
        <StatCard label="环境" value={environmentKindLabels[health.environmentKind]} />
      </div>
      <p className="text-sm text-slate-500">
        {health.pythonVersion} · {health.pythonExecutable}
      </p>
      {health.outdatedMessage && health.outdatedStatus === "Failed" ? <p className="text-sm font-medium text-red-700">{displayMessage(health.outdatedMessage)}</p> : null}
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
    <div className="flex flex-wrap gap-2 border-y border-slate-100 px-4 py-3">
      {filters.map((filter) => (
        <button
          className={cx(
            "rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50",
            filter === active && "border-teal-700 bg-teal-50 text-teal-800",
          )}
          key={filter}
          onClick={() => onSelect(filter)}
          type="button"
        >
          {labels[filter]}
        </button>
      ))}
    </div>
  );
}

function shortenPath(value: string) {
  const parts = value.split("/");
  if (parts.length <= 4) return value;
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}
