import { countedSizePath } from "./utils/format";
import type { ManagerId, ManagerSnapshot, PackageSignal, PathInfo, PathKind } from "./types";

export type HealthTone = "safe" | "review" | "risk";

export interface DevelopmentHealthSummary {
  enabledManagerCount: number;
  scannedManagerCount: number;
  readyManagerCount: number;
  totalPackages: number;
  totalBytes: number;
  maintenanceBytes: number;
  scanIssueCount: number;
  riskSignalCount: number;
  reviewSignalCount: number;
  recommendations: HealthRecommendation[];
  signalGroups: HealthSignalGroup[];
  topStorage: HealthStorageItem[];
  managerStatuses: HealthManagerStatus[];
}

export interface HealthRecommendation {
  id: string;
  tone: HealthTone;
  managerId: ManagerId;
  title: string;
  detail: string;
  bytes?: number;
  count?: number;
}

export interface HealthSignalGroup {
  key: string;
  label: string;
  tone: HealthTone;
  count: number;
}

export interface HealthStorageItem {
  managerId: ManagerId;
  label: string;
  path: string;
  bytes: number;
  status: PathInfo["size"]["status"];
}

export interface HealthManagerStatus {
  managerId: ManagerId;
  status: ManagerSnapshot["status"] | "Not scanned";
  packageCount: number;
}

const maintenanceCandidatePathKinds = new Set<PathKind>([
  "Cache",
  "Store",
  "CargoRegistryCache",
  "CargoGitCache",
  "DockerBuildx",
  "BunCache",
  "UvCache",
]);

const riskSignals = new Set<PackageSignal>(["DirectUrl", "Editable", "Snapshot", "DuplicateVersions"]);
const reviewSignals = new Set<PackageSignal>(["Outdated", "Leaf", "Dangling", "Unused", "UserSite"]);

const signalGroupLabels: Partial<Record<PackageSignal, string>> = {
  DirectUrl: "直接来源",
  Editable: "可编辑安装",
  Snapshot: "快照版本",
  DuplicateVersions: "重复版本",
  Outdated: "可更新",
  Leaf: "叶子包",
  Dangling: "悬空资产",
  Unused: "未使用资产",
  UserSite: "用户目录",
};

export function buildDevelopmentHealthSummary(
  enabledManagers: ManagerId[],
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>,
): DevelopmentHealthSummary {
  const scannedManagers = enabledManagers.flatMap((managerId) => {
    const manager = managerSnapshots[managerId];
    return manager ? [{ managerId, manager }] : [];
  });

  const topStorage: HealthStorageItem[] = [];
  const signalCounts = new Map<PackageSignal, number>();
  const recommendations: HealthRecommendation[] = [];
  let totalBytes = 0;
  let maintenanceBytes = 0;
  let totalPackages = 0;
  let scanIssueCount = 0;

  for (const { managerId, manager } of scannedManagers) {
    totalPackages += manager.packages.length;
    if (manager.status !== "Ready") {
      scanIssueCount += 1;
      recommendations.push(scanIssueRecommendation(managerId, manager));
    }

    for (const path of manager.paths) {
      const bytes = path.size.bytes ?? 0;
      if (path.size.status === "Ready" && countedSizePath(path.kind)) {
        totalBytes += bytes;
        if (bytes > 0) {
          topStorage.push({
            managerId,
            label: path.label,
            path: path.path,
            bytes,
            status: path.size.status,
          });
        }
      }
      if (path.size.status === "Ready" && maintenanceCandidatePathKinds.has(path.kind)) {
        maintenanceBytes += bytes;
      }
    }

    for (const pkg of manager.packages) {
      for (const signal of pkg.signals) {
        signalCounts.set(signal, (signalCounts.get(signal) ?? 0) + 1);
      }
    }

    pushManagerRecommendations(recommendations, managerId, manager);
  }

  const dockerReclaimableBytes = scannedManagers.reduce((sum, { manager }) => sum + dockerReclaimable(manager), 0);
  const homebrewCleanupBytes = scannedManagers.reduce((sum, { manager }) => sum + (manager.homebrew?.cleanup.reclaimedBytes ?? 0), 0);
  maintenanceBytes += dockerReclaimableBytes + homebrewCleanupBytes;

  const signalGroups = Array.from(signalCounts.entries())
    .filter(([signal]) => riskSignals.has(signal) || reviewSignals.has(signal))
    .map(([signal, count]) => ({
      key: signal,
      label: signalGroupLabels[signal] ?? signal,
      tone: riskSignals.has(signal) ? "risk" as const : "review" as const,
      count,
    }))
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.count - a.count || a.label.localeCompare(b.label));

  const riskSignalCount = signalGroups.filter((group) => group.tone === "risk").reduce((sum, group) => sum + group.count, 0);
  const reviewSignalCount = signalGroups.filter((group) => group.tone === "review").reduce((sum, group) => sum + group.count, 0);

  if (maintenanceBytes > 0) {
    recommendations.push({
      id: "maintenance-space",
      tone: "safe",
      managerId: topMaintenanceManager(scannedManagers) ?? enabledManagers[0] ?? "Npm",
      title: "发现维护候选空间",
      detail: "缓存、清理预演或 Docker reclaimable 空间可进一步确认",
      bytes: maintenanceBytes,
    });
  }

  topStorage.sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label));
  const largestStorage = topStorage[0];
  if (largestStorage && largestStorage.bytes >= 1024 * 1024 * 1024) {
    recommendations.push({
      id: `largest-storage-${largestStorage.managerId}-${largestStorage.label}`,
      tone: "review",
      managerId: largestStorage.managerId,
      title: "最大占用需要复核",
      detail: largestStorage.label,
      bytes: largestStorage.bytes,
    });
  }

  return {
    enabledManagerCount: enabledManagers.length,
    scannedManagerCount: scannedManagers.length,
    readyManagerCount: scannedManagers.filter(({ manager }) => manager.status === "Ready").length,
    totalPackages,
    totalBytes,
    maintenanceBytes,
    scanIssueCount,
    riskSignalCount,
    reviewSignalCount,
    recommendations: uniqueRecommendations(recommendations).slice(0, 5),
    signalGroups: signalGroups.slice(0, 6),
    topStorage: topStorage.slice(0, 5),
    managerStatuses: enabledManagers.map((managerId) => ({
      managerId,
      status: managerSnapshots[managerId]?.status ?? "Not scanned",
      packageCount: managerSnapshots[managerId]?.packages.length ?? 0,
    })),
  };
}

function scanIssueRecommendation(managerId: ManagerId, manager: ManagerSnapshot): HealthRecommendation {
  const tone: HealthTone = manager.status === "Failed" ? "risk" : "review";
  return {
    id: `scan-${managerId}-${manager.status}`,
    tone,
    managerId,
    title: `${manager.label} 扫描${manager.status === "Failed" ? "失败" : "未完整"}`,
    detail: manager.failures[0]?.message ?? manager.unsupportedReason ?? "该工具的资产信息尚未完整进入体检",
  };
}

function pushManagerRecommendations(
  recommendations: HealthRecommendation[],
  managerId: ManagerId,
  manager: ManagerSnapshot,
) {
  if (manager.homebrew) {
    if (manager.homebrew.outdatedCount > 0) {
      recommendations.push({
        id: "homebrew-outdated",
        tone: "review",
        managerId,
        title: "Homebrew 有可更新项目",
        detail: "升级前建议先查看 formula/cask 明细",
        count: manager.homebrew.outdatedCount,
      });
    }
    if ((manager.homebrew.cleanup.reclaimedBytes ?? 0) > 0) {
      recommendations.push({
        id: "homebrew-cleanup",
        tone: "safe",
        managerId,
        title: "Homebrew 清理预演有回收空间",
        detail: "dry-run 已返回可回收估算",
        bytes: manager.homebrew.cleanup.reclaimedBytes ?? 0,
      });
    }
  }

  if (manager.maven) {
    if (manager.maven.snapshotCount > 0) {
      recommendations.push({
        id: "maven-snapshots",
        tone: "risk",
        managerId,
        title: "Maven 本地仓库含快照版",
        detail: "快照构件可能让构建结果随时间变化",
        count: manager.maven.snapshotCount,
      });
    }
    if (manager.maven.duplicateArtifactCount > 0) {
      recommendations.push({
        id: "maven-duplicates",
        tone: "review",
        managerId,
        title: "Maven 本地仓库有多版本构件",
        detail: "重复版本会放大仓库体积，清理前需要确认项目依赖",
        count: manager.maven.duplicateArtifactCount,
      });
    }
  }

  if (manager.pip) {
    const riskyPythonPackages = manager.pip.directUrlCount + manager.pip.editableCount;
    if (riskyPythonPackages > 0) {
      recommendations.push({
        id: "pip-local-sources",
        tone: "risk",
        managerId,
        title: "pip 环境含本地或直接来源包",
        detail: "direct-url / editable 包需要确认来源和可复现性",
        count: riskyPythonPackages,
      });
    }
    if (manager.pip.outdatedCount > 0) {
      recommendations.push({
        id: "pip-outdated",
        tone: "review",
        managerId,
        title: "pip 环境有可更新包",
        detail: "升级前建议结合当前 interpreter 和项目约束判断",
        count: manager.pip.outdatedCount,
      });
    }
  }

  if (manager.docker) {
    const cleanupSignals = manager.docker.danglingImageCount + manager.docker.unusedImageCount;
    if (cleanupSignals > 0) {
      recommendations.push({
        id: "docker-cleanup-signals",
        tone: "review",
        managerId,
        title: "Docker 有悬空或未使用镜像",
        detail: "镜像清理通常安全，但仍需确认近期项目是否会复用",
        count: cleanupSignals,
      });
    }
    const reclaimableBytes = dockerReclaimable(manager);
    if (reclaimableBytes > 0) {
      recommendations.push({
        id: "docker-reclaimable",
        tone: "safe",
        managerId,
        title: "Docker 报告可回收空间",
        detail: "来自 docker system df 的 reclaimable 估算",
        bytes: reclaimableBytes,
      });
    }
  }
}

function uniqueRecommendations(recommendations: HealthRecommendation[]) {
  const seen = new Set<string>();
  return recommendations
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || (b.bytes ?? 0) - (a.bytes ?? 0) || (b.count ?? 0) - (a.count ?? 0))
    .filter((recommendation) => {
      if (seen.has(recommendation.id)) return false;
      seen.add(recommendation.id);
      return true;
    });
}

function toneRank(tone: HealthTone) {
  if (tone === "risk") return 0;
  if (tone === "review") return 1;
  return 2;
}

function topMaintenanceManager(scannedManagers: Array<{ managerId: ManagerId; manager: ManagerSnapshot }>) {
  let best: { managerId: ManagerId; bytes: number } | null = null;
  for (const { managerId, manager } of scannedManagers) {
    const bytes =
      manager.paths.reduce((sum, path) => sum + (maintenanceCandidatePathKinds.has(path.kind) ? path.size.bytes ?? 0 : 0), 0) +
      dockerReclaimable(manager) +
      (manager.homebrew?.cleanup.reclaimedBytes ?? 0);
    if (bytes > 0 && (!best || bytes > best.bytes)) {
      best = { managerId, bytes };
    }
  }
  return best?.managerId ?? null;
}

function dockerReclaimable(manager: ManagerSnapshot) {
  return manager.docker?.diskUsage.reduce((sum, row) => sum + parseHumanBytes(row.reclaimable), 0) ?? 0;
}

function parseHumanBytes(value: string) {
  const match = value.trim().match(/^([\d.]+)\s*([KMGT]?i?B|[kmgt]?B)?/);
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;

  const unit = (match[2] ?? "B").toLowerCase();
  const power =
    unit === "kb" || unit === "kib" ? 1
      : unit === "mb" || unit === "mib" ? 2
        : unit === "gb" || unit === "gib" ? 3
          : unit === "tb" || unit === "tib" ? 4
            : 0;

  return Math.round(amount * 1024 ** power);
}
