import type { EnvironmentInspection } from "./environmentInspection";
import type { ManagerScanState } from "./managerScanning";
import type { ProjectCleanupView } from "./projectCleanupWorkflow";
import type { ManagerSnapshot } from "./types";
import type { OpenCodeSessionScan, SessionSourceId, SessionSourceScan } from "./sessionRecords";
import type { VscodeStorageScan } from "./vscodeStorage";
import { recordObservation, type ObservationCompleteness, type ObservationScope } from "./observationLedger";
import type { ObservationItemId } from "./observationItems";

export interface ObservationFacts {
  phase: "idle" | "reading";
  success: {
    at: number | null;
    scope: string | null;
    scopeLabel: string | null;
    completeness: ObservationCompleteness;
    note: string | null;
  } | null;
  failure: {
    outcome: "failed" | "unavailable";
    reason: string;
  } | null;
  invalidated: { at: number; reason: string } | null;
  currentScope: ObservationScope | null;
}

export type ObservationFactsMap = Partial<Record<ObservationItemId, ObservationFacts>>;

export function recordObservationFacts(itemId: ObservationItemId, facts: ObservationFacts, at = Date.now()) {
  if (facts.failure) {
    recordObservation({
      kind: "attempt",
      itemId,
      at,
      outcome: facts.failure.outcome,
      scope: null,
      reason: facts.failure.reason,
    });
  } else if (facts.success) {
    recordObservation({
      kind: "success",
      itemId,
      at: facts.success.at ?? at,
      scope: facts.success.scope,
      scopeLabel: facts.success.scopeLabel,
      completeness: facts.success.completeness,
      note: facts.success.note,
    });
  }
}

function notes(...values: (string | null | undefined)[]) {
  const unique = [...new Set(values.flatMap((value) => value?.trim() ? [value.trim()] : []))];
  return unique.length ? unique.join("；").slice(0, 500) : null;
}

export function projectScopeKey(rootPath: string, maxDepth: number) {
  return `${rootPath}\n${maxDepth}`;
}

export function managerObservationFacts(
  snapshot: ManagerSnapshot | undefined,
  state: ManagerScanState | undefined,
): ObservationFacts {
  const currentScope = snapshot?.scopeKey
    ? { key: snapshot.scopeKey, label: "观察来源" }
    : null;
  const failure = state?.lastReadFailed
    ? { outcome: "failed" as const, reason: state.error ?? "扫描失败" }
    : snapshot?.status === "Missing"
      ? { outcome: "unavailable" as const, reason: state?.error ?? "CLI 缺失" }
      : snapshot?.status === "Failed"
        ? { outcome: "failed" as const, reason: state?.error ?? "扫描失败" }
        : null;
  let success: ObservationFacts["success"] = null;
  if (!failure && snapshot && ["Ready", "Partial", "Unsupported"].includes(snapshot.status)) {
    const problem = state?.error ?? null;
    const completeness: ObservationCompleteness = snapshot.status === "Partial" || problem ? "partial" : "complete";
    success = {
      at: state?.scannedAt ?? null,
      scope: snapshot.scopeKey ?? null,
      scopeLabel: null,
      completeness,
      note: notes(snapshot.status === "Unsupported" ? "清单不可用" : null, problem),
    };
  }
  return {
    phase: state?.phase && state.phase !== "idle" ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope,
  };
}

export function environmentObservationFacts(
  inspection: EnvironmentInspection | null,
  busy: boolean,
  error: string | null,
): ObservationFacts {
  const failure = error ? { outcome: "failed" as const, reason: error } : null;
  let success: ObservationFacts["success"] = null;
  if (inspection) {
    const partial = inspection.pathEntries.some((entry) => entry.issue)
      || inspection.commands.some((command) => command.status === "unknown");
    success = {
      at: inspection.capturedAt,
      scope: inspection.scopeKey ?? null,
      scopeLabel: "应用 PATH 与已启用管理器",
      completeness: partial ? "partial" : "complete",
      note: partial ? "部分命令无法完整读取" : null,
    };
  }
  return {
    phase: busy ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope: inspection?.scopeKey
      ? { key: inspection.scopeKey, label: "应用 PATH 与已启用管理器" }
      : null,
  };
}

export function projectObservationFacts(view: ProjectCleanupView): ObservationFacts {
  const { settings, scan } = view;
  const reading = settings.phase === "loading"
    || scan.phase === "discovering"
    || scan.phase === "measuring";
  const failure = scan.phase === "failed"
    ? { outcome: "failed" as const, reason: scan.failure?.message ?? "项目扫描失败" }
    : null;
  let success: ObservationFacts["success"] = null;
  if ((scan.phase === "ready" || scan.phase === "stopped") && scan.session) {
    const session = scan.session;
    const partial = scan.phase === "stopped" || session.status === "Partial";
    success = {
      at: null,
      scope: projectScopeKey(session.rootPath, session.maxDepth),
      scopeLabel: `${session.rootPath} · 深度 ${session.maxDepth}`,
      completeness: partial ? "partial" : "complete",
      note: notes(
        scan.phase === "stopped" ? "扫描未完成" : null,
        session.errors.length ? `${session.errors.length} 个目录读取有问题` : null,
      ),
    };
  }
  return {
    phase: reading ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope: settings.rootPath
      ? {
          key: projectScopeKey(settings.rootPath, settings.maxDepth),
          label: `${settings.rootPath} · 深度 ${settings.maxDepth}`,
        }
      : null,
  };
}

export function vscodeObservationFacts(
  scan: VscodeStorageScan | null,
  scanning: boolean,
  error: string | null,
): ObservationFacts {
  const failure = error ? { outcome: "failed" as const, reason: error } : null;
  let success: ObservationFacts["success"] = null;
  if (scan) {
    const incomplete = scan.status === "Partial"
      || scan.workspaces.some((workspace) => !workspace.usage.complete);
    const missing = scan.status === "Missing";
    success = {
      at: null,
      scope: `vscode:${scan.storagePath}`,
      scopeLabel: "VS Code 工作区存储",
      completeness: missing ? "complete" : incomplete ? "partial" : "complete",
      note: missing ? "未找到目录" : incomplete ? scan.message ?? "部分工作区无法完整读取" : null,
    };
  }
  return {
    phase: scanning ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope: scan?.storagePath
      ? { key: `vscode:${scan.storagePath}`, label: "VS Code 工作区存储" }
      : null,
  };
}

const sessionScopeLabels: Record<SessionSourceId, string> = {
  codex: "Codex 会话目录",
  claude: "Claude 会话目录",
  grok: "Grok Build 会话目录",
  qoder: "Qoder 会话目录",
  "qoder-cn": "Qoder CN 会话目录",
};

export function sessionObservationFacts(
  source: SessionSourceId,
  scan: SessionSourceScan | null,
  scanning: boolean,
  error: string | null,
): ObservationFacts {
  const failure = error
    ? { outcome: "failed" as const, reason: error }
    : scan?.status === "Failed"
      ? { outcome: "failed" as const, reason: scan.message ?? "会话记录读取失败" }
      : null;
  const label = sessionScopeLabels[source];
  let success: ObservationFacts["success"] = null;
  if (scan && scan.status !== "Failed") {
    success = {
      at: null,
      scope: `session:${source}:${scan.directory}`,
      scopeLabel: label,
      completeness: scan.status === "Partial" ? "partial" : "complete",
      note: scan.status === "Missing" ? "未找到目录" : scan.status === "Partial" ? scan.message : null,
    };
  }
  return {
    phase: scanning ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope: scan?.directory
      ? {
          key: `session:${source}:${scan.directory}`,
          label,
        }
      : null,
  };
}

export function openCodeObservationFacts(
  scan: OpenCodeSessionScan | null,
  scanning: boolean,
  error: string | null,
): ObservationFacts {
  const failure = error
    ? { outcome: "failed" as const, reason: error }
    : scan?.status === "unavailable"
      ? { outcome: "unavailable" as const, reason: scan.message ?? "OpenCode 服务未连接" }
      : scan?.status === "failed"
        ? { outcome: "failed" as const, reason: scan.message ?? "OpenCode 会话读取失败" }
        : null;
  const success = scan?.status === "ready"
    ? {
        at: null,
        scope: null,
        scopeLabel: "已登记的 OpenCode 服务",
        completeness: "complete" as const,
        note: null,
      }
    : null;
  return {
    phase: scanning ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope: null,
  };
}

export interface NativeObservationView {
  scan: {
    directory?: string;
    configPath?: string;
    status?: string;
    message?: string | null;
    warnings?: string[];
    messages?: string[];
    featureEnabled?: boolean | null;
    configError?: string | null;
  } | null;
  current: boolean;
  scanning: boolean;
  error: string | null;
}

type CodexKind = "marketplaces" | "plugins" | "hooks" | "skills";
type ClaudeKind = "extensions" | "hooks" | "skills";
type NativeKind = `codex:${CodexKind}` | `claude:${ClaudeKind}`;

function nativeScope(kind: NativeKind, scan: NativeObservationView["scan"]) {
  if (!scan?.directory) return { key: null, label: null };
  if (kind === "codex:skills") {
    return { key: `codex:${scan.directory}`, label: "Codex home" };
  }
  if (kind.startsWith("codex:")) {
    return {
      key: scan.configPath ? `codex:${scan.directory}\n${scan.configPath}` : `codex:${scan.directory}`,
      label: "Codex home + 配置",
    };
  }
  if (kind === "claude:hooks") {
    return {
      key: scan.configPath ? `claude:${scan.directory}\n${scan.configPath}` : `claude:${scan.directory}`,
      label: "Claude 配置目录 + settings.json",
    };
  }
  return { key: `claude:${scan.directory}`, label: "Claude 配置目录" };
}

function nativeObservationFacts(kind: NativeKind, view: NativeObservationView): ObservationFacts {
  const scan = view.scan;
  const scope = nativeScope(kind, scan);
  const unavailable = scan?.status === "MissingCli" || scan?.status === "Incompatible";
  const badStatus = scan?.status && scan.status !== "Ready" && !unavailable;
  const failure = unavailable
    ? {
        outcome: "unavailable" as const,
        reason: scan?.message ?? view.error ?? "CLI 缺失或不兼容",
      }
    : view.error || (!view.current && badStatus)
      ? {
          outcome: "failed" as const,
          reason: view.error ?? scan?.message ?? "清单读取失败",
        }
      : scan?.configError
        ? { outcome: "failed" as const, reason: scan.configError }
        : null;
  let success: ObservationFacts["success"] = null;
  if (view.current && scan && !failure) {
    const featureOff = kind === "codex:hooks" && scan.featureEnabled === false;
    const warnings = notes(
      ...(scan.warnings ?? []),
      ...(scan.messages ?? []),
      scan.message,
      scan.configError,
    );
    success = {
      at: null,
      scope: scope.key,
      scopeLabel: scope.label,
      completeness: featureOff || !warnings ? "complete" : "partial",
      note: featureOff ? "总开关关闭，无法枚举" : warnings,
    };
  }
  return {
    phase: view.scanning ? "reading" : "idle",
    success,
    failure,
    invalidated: null,
    currentScope: scope.key ? { key: scope.key, label: scope.label ?? "观察范围" } : null,
  };
}

export function codexObservationFacts(kind: CodexKind, view: NativeObservationView): ObservationFacts {
  return nativeObservationFacts(`codex:${kind}`, view);
}

export function claudeObservationFacts(kind: ClaudeKind, view: NativeObservationView): ObservationFacts {
  return nativeObservationFacts(`claude:${kind}`, view);
}
