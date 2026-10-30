import { managerOrder } from "./constants";
import type { EnvironmentInspection } from "./environmentInspection";
import type { ManagerScanState } from "./managerScanning";
import type { ObservationRecord } from "./observationLedger";
import { managerObservationId, type ObservationItemId } from "./observationItems";
import type {
  ManagerId,
  ManagerSnapshot,
  ManagerStatus,
  PackageKind,
  PathKind,
} from "./types";

export type CommandLocationKind = "source" | "package" | "interpreter";
export type CommandLocationState = "associated" | "notFound" | "indeterminate" | "notApplicable";
export type CommandLocationRelation = "equal" | "contained";

export interface CommandLocationDescriptor {
  id: string;
  managerId: ManagerId;
  kind: CommandLocationKind;
  path: string;
  label: string;
  package?: { name: string; version: string };
}

export interface CommandLocationTarget {
  id: string;
  target: string;
}

export interface CommandLocationInput {
  id: string;
  managerId: ManagerId;
  path: string;
}

export interface CommandLocationMatch {
  targetId: string;
  locationId: string;
  relation: CommandLocationRelation;
  canonicalLocation: string;
  suppressedBy: string | null;
}

export interface CommandLocationAssociationResult {
  matches: CommandLocationMatch[];
  unreadableLocationIds: string[];
}

export interface CommandLocationGroup {
  managerId: ManagerId;
  source: CommandLocationDescriptor | null;
  packages: CommandLocationDescriptor[];
  interpreters: CommandLocationDescriptor[];
}

export interface SuppressedCommandLocation {
  managerId: ManagerId;
  location: CommandLocationDescriptor;
}

export interface CandidateLocationAssociation {
  state: CommandLocationState;
  groups: CommandLocationGroup[];
  suppressed: SuppressedCommandLocation[];
}

export interface CommandLocationSummary {
  state: "associated" | "notFound" | "indeterminate" | null;
  managerCount: number;
}

export interface CommandLocationScopeManager {
  managerId: ManagerId;
  observed: boolean;
  scannedAt: number | null;
  status: ManagerStatus | null;
  invalidated: boolean;
  invalidationReason: string | null;
  notes: string[];
  locationCount: number;
  unreadableLocationCount: number;
}

export interface CommandLocationScope {
  enabled: CommandLocationScopeManager[];
  disabled: ManagerId[];
  observedCount: number;
}

const SOURCE_KINDS: Record<ManagerId, readonly PathKind[]> = {
  Npm: ["GlobalModules"],
  Pnpm: ["GlobalModules"],
  Yarn: ["GlobalDir"],
  Nvm: ["NvmNodeVersions"],
  Homebrew: ["Prefix", "Cellar", "Caskroom"],
  Maven: [],
  Pip: ["SitePackages", "UserSite"],
  Cargo: ["CargoBin"],
  Docker: [],
  Bun: ["BunInstall"],
  Uv: ["UvTools", "UvPythonInstallations"],
  Fvm: ["FvmVersions"],
  AndroidSdk: ["AndroidSdkRoot"],
};

const EXCLUDED_PACKAGE_KINDS = new Set<PackageKind>([
  "MavenArtifact",
  "DockerImage",
  "DockerContainer",
  "DockerVolume",
]);

export function commandLocationTargetId(program: string, pathIndex: number) {
  return `${program}:${pathIndex}`;
}

export function isAssociableCandidate(candidate: EnvironmentInspection["commands"][number]["candidates"][number]) {
  return candidate.status === "executable" && candidate.target !== null;
}

export function buildCommandLocationTargets(environment: EnvironmentInspection): CommandLocationTarget[] {
  const targets: CommandLocationTarget[] = [];
  for (const command of environment.commands) {
    for (const candidate of command.candidates) {
      if (!isAssociableCandidate(candidate)) continue;
      targets.push({
        id: commandLocationTargetId(command.program, candidate.pathIndex),
        target: candidate.target!,
      });
    }
  }
  return targets;
}

export function buildCommandLocationDescriptors(
  enabledManagers: ManagerId[],
  snapshots: Partial<Record<ManagerId, ManagerSnapshot>>,
): CommandLocationDescriptor[] {
  const enabled = new Set(enabledManagers);
  const descriptors: CommandLocationDescriptor[] = [];
  const seen = new Set<string>();

  const push = (descriptor: CommandLocationDescriptor) => {
    const key = [
      descriptor.managerId,
      descriptor.kind,
      descriptor.path,
      descriptor.label,
      descriptor.package?.name ?? "",
      descriptor.package?.version ?? "",
    ].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    descriptors.push(descriptor);
  };

  for (const managerId of managerOrder) {
    if (!enabled.has(managerId)) continue;
    const snapshot = snapshots[managerId];
    if (!snapshot) continue;

    const sourceKinds = new Set(SOURCE_KINDS[managerId]);
    snapshot.paths.forEach((path, index) => {
      if (!path.path || !sourceKinds.has(path.kind)) return;
      push({
        id: `${managerId}:source:${path.kind}:${index}`,
        managerId,
        kind: "source",
        path: path.path,
        label: path.label,
      });
    });

    snapshot.packages.forEach((pkg, index) => {
      if (!pkg.path || EXCLUDED_PACKAGE_KINDS.has(pkg.kind)) return;
      push({
        id: `${managerId}:package:${index}`,
        managerId,
        kind: "package",
        path: pkg.path,
        label: `${pkg.name}@${pkg.version}`,
        package: { name: pkg.name, version: pkg.version },
      });
    });

    if (managerId === "Pip" && snapshot.pip?.pythonExecutable) {
      push({
        id: `${managerId}:interpreter:0`,
        managerId,
        kind: "interpreter",
        path: snapshot.pip.pythonExecutable,
        label: "解释器",
      });
    }
  }

  return descriptors;
}

export function deriveCommandLocationAssociations(
  targetIds: string[],
  descriptors: CommandLocationDescriptor[],
  result: CommandLocationAssociationResult,
): {
  byTarget: Map<string, CandidateLocationAssociation>;
  hasUsableLocations: boolean;
  descriptorById: Map<string, CommandLocationDescriptor>;
} {
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const unreadable = new Set(result.unreadableLocationIds);
  const hasUsableLocations = descriptors.some((descriptor) => !unreadable.has(descriptor.id));
  const matchesByTarget = new Map<string, CommandLocationMatch[]>();
  for (const match of result.matches) {
    if (!descriptorById.has(match.locationId)) continue;
    const current = matchesByTarget.get(match.targetId);
    if (current) current.push(match);
    else matchesByTarget.set(match.targetId, [match]);
  }

  const byTarget = new Map<string, CandidateLocationAssociation>();
  for (const targetId of targetIds) {
    const matches = matchesByTarget.get(targetId) ?? [];
    byTarget.set(
      targetId,
      candidateAssociation(matches, descriptorById, hasUsableLocations),
    );
  }
  return { byTarget, hasUsableLocations, descriptorById };
}

function candidateAssociation(
  matches: CommandLocationMatch[],
  descriptorById: Map<string, CommandLocationDescriptor>,
  hasUsableLocations: boolean,
): CandidateLocationAssociation {
  const visible = matches.filter((match) => !match.suppressedBy);
  if (visible.length === 0) {
    return {
      state: hasUsableLocations ? "notFound" : "indeterminate",
      groups: [],
      suppressed: [],
    };
  }

  const grouped = new Map<
    ManagerId,
    { source: CommandLocationMatch | null; packages: CommandLocationMatch[]; interpreters: CommandLocationMatch[] }
  >();
  for (const match of visible) {
    const descriptor = descriptorById.get(match.locationId);
    if (!descriptor) continue;
    const group = grouped.get(descriptor.managerId) ?? {
      source: null,
      packages: [],
      interpreters: [],
    };
    if (descriptor.kind === "source") {
      if (
        !group.source ||
        compareSpecificity(
          { canonicalLocation: match.canonicalLocation, path: descriptor.path },
          { canonicalLocation: group.source.canonicalLocation, path: descriptorById.get(group.source.locationId)?.path ?? "" },
        ) > 0
      ) {
        group.source = match;
      }
    } else if (descriptor.kind === "package") {
      group.packages.push(match);
    } else {
      group.interpreters.push(match);
    }
    grouped.set(descriptor.managerId, group);
  }

  const groups: CommandLocationGroup[] = [];
  for (const managerId of managerOrder) {
    const group = grouped.get(managerId);
    if (!group) continue;
    groups.push({
      managerId,
      source: group.source ? descriptorById.get(group.source.locationId) ?? null : null,
      packages: sortSpecific(group.packages, descriptorById).map(
        (match) => descriptorById.get(match.locationId)!,
      ),
      interpreters: sortSpecific(group.interpreters, descriptorById).map(
        (match) => descriptorById.get(match.locationId)!,
      ),
    });
  }

  const suppressedGroups = new Map<ManagerId, CommandLocationMatch>();
  for (const match of matches) {
    if (!match.suppressedBy) continue;
    const descriptor = descriptorById.get(match.locationId);
    if (!descriptor) continue;
    if (grouped.has(descriptor.managerId)) continue;
    const current = suppressedGroups.get(descriptor.managerId);
    if (
      !current ||
      compareSpecificity(
        { canonicalLocation: match.canonicalLocation, path: descriptor.path },
        { canonicalLocation: current.canonicalLocation, path: descriptorById.get(current.locationId)?.path ?? "" },
      ) > 0
    ) {
      suppressedGroups.set(descriptor.managerId, match);
    }
  }
  const suppressed: SuppressedCommandLocation[] = [];
  for (const managerId of managerOrder) {
    const match = suppressedGroups.get(managerId);
    if (!match) continue;
    const location = descriptorById.get(match.locationId);
    if (location) suppressed.push({ managerId, location });
  }

  return {
    state: groups.length > 0 ? "associated" : hasUsableLocations ? "notFound" : "indeterminate",
    groups,
    suppressed,
  };
}

function compareSpecificity(
  left: { canonicalLocation: string; path: string },
  right: { canonicalLocation: string; path: string },
) {
  const depth = pathDepth(left.canonicalLocation) - pathDepth(right.canonicalLocation);
  if (depth !== 0) return depth;
  return left.canonicalLocation.length - right.canonicalLocation.length;
}

function sortSpecific(
  matches: CommandLocationMatch[],
  descriptorById: Map<string, CommandLocationDescriptor>,
) {
  return matches
    .map((match, index) => ({ match, index }))
    .sort((left, right) => {
      const difference =
        pathDepth(right.match.canonicalLocation) - pathDepth(left.match.canonicalLocation);
      if (difference !== 0) return difference;
      const rightDescriptor = descriptorById.get(right.match.locationId);
      const leftDescriptor = descriptorById.get(left.match.locationId);
      const pathDifference =
        (rightDescriptor?.path.length ?? 0) - (leftDescriptor?.path.length ?? 0);
      return pathDifference !== 0 ? pathDifference : left.index - right.index;
    })
    .map(({ match }) => match);
}

function pathDepth(path: string) {
  return path.split("/").filter(Boolean).length;
}

export function buildCommandLocationSummary(
  targetIds: string[],
  associations: Map<string, CandidateLocationAssociation>,
): CommandLocationSummary {
  if (targetIds.length === 0) return { state: null, managerCount: 0 };
  const states = targetIds.map(
    (targetId) => associations.get(targetId)?.state ?? "indeterminate",
  );
  if (states.every((state) => state === "indeterminate")) {
    return { state: "indeterminate", managerCount: 0 };
  }
  const managers = new Set<ManagerId>();
  for (const targetId of targetIds) {
    for (const group of associations.get(targetId)?.groups ?? []) {
      managers.add(group.managerId);
    }
  }
  if (managers.size > 0) {
    return { state: "associated", managerCount: managers.size };
  }
  return { state: "notFound", managerCount: 0 };
}

export function buildCommandLocationScope(
  enabledManagers: ManagerId[],
  snapshots: Partial<Record<ManagerId, ManagerSnapshot>>,
  scanStates: Partial<Record<ManagerId, ManagerScanState>>,
  records: Partial<Record<ObservationItemId, ObservationRecord>>,
  descriptors: CommandLocationDescriptor[],
  unreadableLocationIds: string[],
): CommandLocationScope {
  const enabled = new Set(enabledManagers);
  const unreadable = new Set(unreadableLocationIds);
  const enabledEntries: CommandLocationScopeManager[] = [];

  for (const managerId of managerOrder) {
    if (!enabled.has(managerId)) continue;
    const snapshot = snapshots[managerId];
    const scanState = scanStates[managerId];
    const locations = descriptors.filter((descriptor) => descriptor.managerId === managerId);
    const unreadableCount = locations.filter((descriptor) => unreadable.has(descriptor.id)).length;
    const record = records[managerObservationId(managerId)];
    const invalidated = record?.invalidated ?? null;
    const notes: string[] = [];

    const addNote = (note: string) => {
      if (!notes.includes(note)) notes.push(note);
    };

    if (!snapshot) {
      if (scanState && scanState.phase !== "idle") addNote("扫描中");
      else if (scanState?.lastReadFailed) addNote("最近扫描失败");
      else if (scanState?.error) addNote("最近扫描有异常");
      else addNote("未扫描");
    } else {
      if (snapshot.status === "Unsupported") addNote("不支持");
      else if (snapshot.status === "Missing") addNote("未安装");
      if (scanState?.lastReadFailed || snapshot.status === "Failed") addNote("最近扫描失败");
      else if (scanState?.error) addNote("最近扫描有异常");
      if (snapshot.status === "Partial") addNote("读取不完整");
      if (invalidated) addNote("观察已失效");
      if (snapshot.status !== "Unsupported" && locations.length === 0) {
        addNote("观察范围不含命令安装位置");
      }
    }
    if (unreadableCount > 0) addNote(`${unreadableCount} 个位置无法读取`);

    enabledEntries.push({
      managerId,
      observed: !!snapshot,
      scannedAt: scanState?.scannedAt ?? null,
      status: snapshot?.status ?? null,
      invalidated: !!invalidated,
      invalidationReason: invalidated?.reason ?? null,
      notes,
      locationCount: locations.length,
      unreadableLocationCount: unreadableCount,
    });
  }

  return {
    enabled: enabledEntries,
    disabled: managerOrder.filter((managerId) => !enabled.has(managerId)),
    observedCount: enabledEntries.filter((entry) => entry.observed).length,
  };
}

