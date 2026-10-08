import { cleanupReclaimable, hasCleanupPlan, type CleanupSpaceInfo } from "./cleanupCopy";
import { countedSizePath } from "./utils/format";
import type { ManagerId, ManagerSnapshot, PackageSignal, PathInfo } from "./types";

export type HealthTone = "safe" | "review" | "risk";

export interface DevelopmentHealthSummary {
  enabledManagerCount: number;
  scannedManagerCount: number;
  readyManagerCount: number;
  totalPackages: number;
  totalBytes: number;
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
  space?: CleanupSpaceInfo;
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
  incomplete: boolean;
}

export interface HealthManagerStatus {
  managerId: ManagerId;
  status: ManagerSnapshot["status"] | "Not scanned";
  packageCount: number;
}

const reviewSignals = new Set<PackageSignal>(["DirectUrl", "Editable", "Snapshot", "DuplicateVersions", "Outdated", "Leaf", "Dangling", "Unused", "UserSite"]);

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
  let totalPackages = 0;
  let scanIssueCount = 0;

  for (const { managerId, manager } of scannedManagers) {
    totalPackages += manager.packages.length;
    if (manager.status === "Failed" || manager.status === "Partial") {
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
            incomplete: path.size.skipped > 0,
          });
        }
      }
    }

    for (const pkg of manager.packages) {
      for (const signal of pkg.signals) {
        signalCounts.set(signal, (signalCounts.get(signal) ?? 0) + 1);
      }
    }

    pushManagerRecommendations(recommendations, managerId, manager);
  }

  const signalGroups = Array.from(signalCounts.entries())
    .filter(([signal]) => reviewSignals.has(signal))
    .map(([signal, count]) => ({
      key: signal,
      label: signalGroupLabels[signal] ?? signal,
      tone: "review" as HealthTone,
      count,
    }))
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.count - a.count || a.label.localeCompare(b.label));

  const riskSignalCount = signalGroups.filter((group) => group.tone === "risk").reduce((sum, group) => sum + group.count, 0);
  const reviewSignalCount = signalGroups.filter((group) => group.tone === "review").reduce((sum, group) => sum + group.count, 0);

  topStorage.sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label));
  const largestStorage = topStorage[0];
  if (largestStorage && largestStorage.bytes >= 1024 * 1024 * 1024) {
    recommendations.push({
      id: `largest-storage-${largestStorage.managerId}-${largestStorage.label}`,
      tone: "review",
      managerId: largestStorage.managerId,
      title: "查看较大的目录占用",
      detail: `${largestStorage.label}${largestStorage.incomplete ? "（已测下限）" : ""}；目录占用不代表可回收空间`,
      bytes: largestStorage.bytes,
    });
  }

  return {
    enabledManagerCount: enabledManagers.length,
    scannedManagerCount: scannedManagers.length,
    readyManagerCount: scannedManagers.filter(({ manager }) => manager.status === "Ready").length,
    totalPackages,
    totalBytes,
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
  if (hasCleanupPlan(managerId) && manager.status !== "Missing") {
    const space = cleanupReclaimable(manager);
    recommendations.push({
      id: `maintenance-${managerId}`, tone: "safe", managerId,
      title: `查看 ${manager.label} 维护范围`,
      detail: space?.note ?? "仅处理本工具支持的资源类型；回收量需在执行后核对。",
      ...(space ? { space } : {}),
    });
  }
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

  }

  if (manager.maven) {
    if (manager.maven.snapshotCount > 0) {
      recommendations.push({
        id: "maven-snapshots",
        tone: "review",
        managerId,
        title: "Maven 本地仓库含快照版",
        detail: "这是仓库中的构件类型，不代表项目正在使用；本工具不清理 Maven 本地仓库。",
        count: manager.maven.snapshotCount,
      });
    }
    if (manager.maven.duplicateArtifactCount > 0) {
      recommendations.push({
        id: "maven-duplicates",
        tone: "review",
        managerId,
        title: "Maven 本地仓库有多版本构件",
        detail: "不同项目可能依赖不同版本；本工具仅展示，不提供仓库清理。",
        count: manager.maven.duplicateArtifactCount,
      });
    }
  }

  if (manager.pip) {
    const riskyPythonPackages = manager.packages.filter((pkg) => pkg.signals.includes("DirectUrl") || pkg.signals.includes("Editable")).length;
    if (riskyPythonPackages > 0) {
      recommendations.push({
        id: "pip-local-sources",
        tone: "review",
        managerId,
        title: "pip 环境含本地或直接来源包",
        detail: "直接来源和可编辑安装是环境事实，不代表故障；可按项目需要查看来源。",
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
    const cleanupSignals = manager.packages.filter((pkg) => pkg.signals.includes("Dangling") || pkg.signals.includes("Unused")).length;
    if (cleanupSignals > 0) {
      recommendations.push({
        id: "docker-cleanup-signals",
        tone: "review",
        managerId,
        title: "Docker 有悬空或未使用镜像",
        detail: "未使用不等于本工具会删除；只清构建缓存和 dangling 镜像，不删容器、卷或已打 tag 的镜像。",
        count: cleanupSignals,
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
