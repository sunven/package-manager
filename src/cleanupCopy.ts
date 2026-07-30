import type { ManagerId, ManagerSnapshot, PathKind } from "./types";

/**
 * Where a manager's "you will reclaim this much" figure comes from.
 *
 * The provenance genuinely differs per manager, and flattening that would mean
 * publishing a number we cannot stand behind. `pathUsage` is honest only for
 * cleanups that empty the directory outright; prune-type cleanups omit the
 * figure entirely rather than over-promise.
 */
export type ReclaimSource =
  /** The measured size of the directory the cleanup empties. */
  | "pathUsage"
  /** `brew cleanup --dry-run`, the only native dry-run across all 8 managers. */
  | "homebrewDryRun";

/**
 * User-facing copy for each manager's cleanup, keyed the same way the backend
 * plan table is.
 *
 * A manager absent from this table has no cleanup plan and must not offer a
 * cleanup affordance. That absence is architectural, not a disabled button —
 * see `docs/adr/0001-delegated-cache-cleanup.md`.
 */
export interface CleanupCopy {
  /**
   * Which path card carries the cleanup button. Omitted when a manager's
   * cleanup is not anchored to a single path (Docker prunes build cache and
   * dangling images, neither of which is one directory on this list).
   */
  pathKind?: PathKind;
  /** Dialog title, e.g. 确认清理 npm 缓存. */
  title: string;
  /** What will happen, including anything the user would be surprised by. */
  description: string;
  /** Confirm button label. */
  confirm: string;
  /** Label for the icon button on the path card. */
  action: string;
  /** Toast/dialog title once the plan fully succeeded. */
  succeeded: string;
  /** Toast/dialog title once the plan failed outright. */
  failed: string;
  /**
   * How to source the reclaimable figure. Absent means show no figure — the
   * honest choice when any available number would mislead.
   */
  reclaimSource?: ReclaimSource;
  /**
   * Prune-type cleanups remove only unreferenced content, so the measured path
   * usage would badly over-estimate what gets reclaimed. Showing that number
   * teaches users the feature is broken when little space comes back.
   */
  reclaimNote?: string;
}

export const cleanupCopy: Partial<Record<ManagerId, CleanupCopy>> = {
  Npm: {
    pathKind: "Cache",
    title: "确认清理 npm 缓存",
    description: "将执行 npm cache clean --force，然后删除 npx 缓存目录 _npx（npm 没有清理它的命令）。",
    confirm: "清理缓存",
    action: "清理 npm 缓存",
    succeeded: "npm 缓存已清理",
    failed: "npm 缓存清理失败",
    // The measured npm cache already contains `_npx`, and the plan removes both,
    // so the path usage is exactly what comes back.
    reclaimSource: "pathUsage",
  },
  Pnpm: {
    pathKind: "Store",
    title: "确认清理 pnpm store",
    description: "将执行 pnpm store prune。",
    confirm: "清理 store",
    action: "清理 pnpm store",
    succeeded: "pnpm store 已清理",
    failed: "pnpm store 清理失败",
    reclaimNote: "只清理不再被任何项目引用的内容，实际回收量取决于当前引用情况。",
  },
  Yarn: {
    pathKind: "Cache",
    title: "确认清理 Yarn 缓存",
    description: "将执行 yarn cache clean，清空 Yarn 缓存目录。",
    confirm: "清理缓存",
    action: "清理 Yarn 缓存",
    succeeded: "Yarn 缓存已清理",
    failed: "Yarn 缓存清理失败",
    reclaimSource: "pathUsage",
  },
  Pip: {
    pathKind: "Cache",
    title: "确认清理 pip 缓存",
    description: "将执行 <python> -m pip cache purge，清空 pip 的 wheel 缓存。解释器在执行时重新解析，作用于当前生效的 Python 环境。",
    confirm: "清理缓存",
    action: "清理 pip 缓存",
    succeeded: "pip 缓存已清理",
    failed: "pip 缓存清理失败",
    reclaimSource: "pathUsage",
  },
  Bun: {
    pathKind: "BunCache",
    title: "确认清理 Bun 缓存",
    description: "将执行 bun pm cache rm，清空 Bun 缓存目录。",
    confirm: "清理缓存",
    action: "清理 Bun 缓存",
    succeeded: "Bun 缓存已清理",
    failed: "Bun 缓存清理失败",
    reclaimSource: "pathUsage",
  },
  Docker: {
    // No `pathKind`: the plan prunes build cache *and* dangling images, so it is
    // not anchored to one directory. The button lives on the Docker summary,
    // beside the reclaimable figures that justify it.
    title: "确认执行 Docker 清理",
    description:
      "将依次执行 docker builder prune -f 和 docker image prune -f，删除构建缓存和 dangling 镜像（无 tag 且无容器引用）。已打 tag 的镜像、容器和卷不会被删除。",
    confirm: "执行清理",
    action: "执行 Docker 清理",
    succeeded: "Docker 清理已完成",
    failed: "Docker 清理失败",
    reclaimNote: "下方是 Docker 自己报告的可回收空间，覆盖的资源类型比本次清理更广，不代表全部会被回收。",
  },
  Homebrew: {
    // No `pathKind`: the affordance lives on the dry-run card, not a path card,
    // so the itemised list of what will be removed sits next to the button.
    title: "确认执行 Homebrew 清理",
    description:
      "将执行 brew cleanup。除了过期下载缓存，它还会删除已安装 formula 的旧版本（当前版本不受影响）。下方是预演列出的将被删除内容。",
    confirm: "执行清理",
    action: "执行 Homebrew 清理",
    succeeded: "Homebrew 清理已完成",
    failed: "Homebrew 清理失败",
    reclaimSource: "homebrewDryRun",
  },
  Uv: {
    pathKind: "UvCache",
    title: "确认清理 uv 缓存",
    description: "将执行 uv cache prune。不传 --force，保留 uv 自己的 in-use 检查。",
    confirm: "清理缓存",
    action: "清理 uv 缓存",
    succeeded: "uv 缓存已清理",
    failed: "uv 缓存清理失败",
    reclaimNote: "只清理不再被任何环境引用的内容，实际回收量取决于当前引用情况。",
  },
};

/**
 * The figure to show before confirming, or `null` when none can be shown
 * honestly — either the manager prunes rather than empties, or its size scan
 * has not produced a usable number yet.
 */
export function cleanupReclaimable(manager: ManagerSnapshot | undefined): string | null {
  const copy = manager ? cleanupCopyFor(manager.id) : null;
  if (!manager || !copy?.reclaimSource) return null;

  if (copy.reclaimSource === "homebrewDryRun") {
    const cleanup = manager.homebrew?.cleanup;
    return cleanup?.status === "Ready" ? cleanup.reclaimedHuman : null;
  }

  if (!copy.pathKind) return null;
  const path = manager.paths.find((candidate) => candidate.kind === copy.pathKind);
  if (!path || path.size.status !== "Ready") return null;
  return path.size.human;
}

/**
 * The itemised list of what a cleanup will remove, when the manager can produce
 * one before running. Only Homebrew can: `brew cleanup --dry-run` is the sole
 * native dry-run, and it is the reason Homebrew is allowed to exceed the
 * cache-only scope at all (ADR-0002).
 */
export function cleanupPreviewDetails(manager: ManagerSnapshot | undefined): string | null {
  if (manager?.id === "Docker") return dockerReclaimableRows(manager);
  if (manager?.id !== "Homebrew") return null;
  const cleanup = manager.homebrew?.cleanup;
  return cleanup?.status === "Ready" && cleanup.rawOutput ? cleanup.rawOutput : null;
}

/**
 * Docker's own per-type reclaimable report, for the resource types this plan
 * actually touches.
 *
 * Deliberately not aggregated into one number: the rows are pre-formatted
 * strings from `docker system df`, and summing them would mean parsing display
 * text — and a single total would read as a promise the two-step plan cannot
 * make, since `system df` also counts volumes and containers we never remove.
 */
export function dockerReclaimableRows(manager: ManagerSnapshot | undefined): string | null {
  if (manager?.id !== "Docker") return null;
  const docker = manager.docker;
  if (!docker || docker.diskUsageStatus !== "Ready") return null;

  const rows = docker.diskUsage
    .filter((row) => /build\s*cache|image/i.test(row.resourceType))
    .filter((row) => row.reclaimable)
    .map((row) => `${row.resourceType}: 可回收 ${row.reclaimable}（共 ${row.size}）`);

  return rows.length ? rows.join("\n") : null;
}

/** Whether the cleanup can run yet. Homebrew waits for its dry-run to land. */
export function cleanupReady(manager: ManagerSnapshot | undefined): boolean {
  if (!manager || !hasCleanupPlan(manager.id)) return false;
  if (manager.status === "Missing") return false;
  if (manager.id === "Homebrew") return manager.homebrew?.cleanup.status === "Ready";

  return true;
}

export function cleanupCopyFor(managerId: ManagerId): CleanupCopy | null {
  return cleanupCopy[managerId] ?? null;
}

/** The cleanup copy for a manager, but only on the path card that owns it. */
export function cleanupCopyForPath(managerId: ManagerId, pathKind: PathKind): CleanupCopy | null {
  const copy = cleanupCopyFor(managerId);
  return copy && copy.pathKind === pathKind ? copy : null;
}

export function hasCleanupPlan(managerId: ManagerId): boolean {
  return cleanupCopyFor(managerId) !== null;
}
