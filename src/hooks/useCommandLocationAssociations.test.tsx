// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { managerFixture } from "../test/fixtures";
import type { EnvironmentInspection } from "../environmentInspection";
import type { ManagerScanState } from "../managerScanning";
import type { ObservationItemId } from "../observationItems";
import type { ObservationRecord } from "../observationLedger";
import type { ManagerId, ManagerSnapshot, PackageKind, PackageRow, PathKind } from "../types";
import { useCommandLocationAssociations } from "./useCommandLocationAssociations";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const usage = {
  status: "Ready" as const,
  bytes: 0,
  human: "0 B",
  files: 0,
  directories: 0,
  skipped: 0,
  message: null,
};

function pathInfo(kind: PathKind, path: string) {
  return { label: kind, kind, path, size: usage };
}

function packageRow(name: string, version: string, path: string, kind: PackageKind = "Generic"): PackageRow {
  return { name, version, path, source: "test", kind, signals: [], actions: [] };
}

function environment(target: string, capturedAt = 1): EnvironmentInspection {
  return {
    capturedAt,
    pathEntries: [],
    commands: [{
      program: "node",
      managers: ["Nvm"],
      selectedPath: target,
      status: "single",
      candidates: [{
        pathIndex: 0,
        path: target,
        target,
        status: "executable",
        message: null,
      }],
    }],
  };
}

function nvmSnapshot(paths: { kind: PathKind; path: string }[]): ManagerSnapshot {
  return managerFixture("Nvm", {
    paths: paths.map((path) => ({ ...pathInfo(path.kind, path.path) })),
    packages: [packageRow("node", "24", "/nvm/versions/node/v24")],
  });
}

function emptyLedger(): Partial<Record<ObservationItemId, ObservationRecord>> {
  return {};
}

it("builds a request and derives visible groups", async () => {
  const result = {
    matches: [
      {
        targetId: "node:0",
        locationId: "Nvm:source:NvmNodeVersions:0",
        relation: "contained" as const,
        canonicalLocation: "/nvm/versions/node/v24",
        suppressedBy: null,
      },
      {
        targetId: "node:0",
        locationId: "Nvm:package:0",
        relation: "contained" as const,
        canonicalLocation: "/nvm/versions/node/v24",
        suppressedBy: null,
      },
    ],
    unreadableLocationIds: [],
  };
  vi.mocked(invoke).mockResolvedValueOnce(result);
  const scanStates: Partial<Record<ManagerId, ManagerScanState>> = {
    Nvm: { phase: "idle", scannedAt: 10, error: null },
  };

  const { result: hook } = renderHook(() => useCommandLocationAssociations(
    environment("/nvm/versions/node/v24/bin/node"),
    ["Nvm"],
    {
      Nvm: nvmSnapshot([{ kind: "NvmNodeVersions", path: "/nvm/versions/node/v24" }]),
    },
    scanStates,
    emptyLedger(),
  ));

  await waitFor(() => expect(hook.current.byTarget.get("node:0")?.state).toBe("associated"));
  expect(invoke).toHaveBeenCalledWith("associate_command_locations", {
    request: {
      targets: [{ id: "node:0", target: "/nvm/versions/node/v24/bin/node" }],
      locations: [
        { id: "Nvm:source:NvmNodeVersions:0", managerId: "Nvm", path: "/nvm/versions/node/v24" },
        { id: "Nvm:package:0", managerId: "Nvm", path: "/nvm/versions/node/v24" },
      ],
    },
  });
  expect(hook.current.busy).toBe(false);
  expect(hook.current.scope.enabled[0].scannedAt).toBe(10);
});

it("reports indeterminate without locations and does not invoke", async () => {
  const { result } = renderHook(() => useCommandLocationAssociations(
    environment("/usr/bin/mvn"),
    ["Maven"],
    { Maven: managerFixture("Maven", { paths: [pathInfo("LocalRepository", "/m2")] }) },
    {},
    emptyLedger(),
  ));

  expect(result.current.resultAvailable).toBe(true);
  expect(result.current.hasUsableLocations).toBe(false);
  expect(result.current.byTarget.get("node:0")?.state).toBe("indeterminate");
  expect(invoke).not.toHaveBeenCalled();
});

it("discards a stale response after the observed paths change", async () => {
  let finishFirst!: (value: Awaited<ReturnType<typeof invoke>>) => void;
  vi.mocked(invoke)
    .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }) as ReturnType<typeof invoke>)
    .mockResolvedValueOnce({
      matches: [{
        targetId: "node:0",
        locationId: "Nvm:source:NvmNodeVersions:0",
        relation: "contained",
        canonicalLocation: "/b",
        suppressedBy: null,
      }],
      unreadableLocationIds: [],
    });

  const firstSnapshot = {
    Nvm: nvmSnapshot([
      { kind: "Cache", path: "/cache" },
      { kind: "NvmNodeVersions", path: "/a" },
    ]),
  };
  const secondSnapshot = {
    Nvm: nvmSnapshot([{ kind: "NvmNodeVersions", path: "/b" }]),
  };

  const { result, rerender } = renderHook(
    ({ target, capturedAt }: { target: string; capturedAt: number }) => useCommandLocationAssociations(
      environment(target, capturedAt),
      ["Nvm"],
      capturedAt === 1 ? firstSnapshot : secondSnapshot,
      {},
      emptyLedger(),
    ),
    { initialProps: { target: "/a/node", capturedAt: 1 } },
  );

  rerender({ target: "/b/node", capturedAt: 2 });
  await waitFor(() => expect(
    result.current.byTarget.get("node:0")?.groups[0]?.source?.path,
  ).toBe("/b"));

  await act(async () => {
    finishFirst({
      matches: [{
        targetId: "node:0",
        locationId: "Nvm:source:NvmNodeVersions:1",
        relation: "contained",
        canonicalLocation: "/a",
        suppressedBy: null,
      }],
      unreadableLocationIds: [],
    });
  });
  expect(result.current.byTarget.get("node:0")?.groups[0]?.source?.path).toBe("/b");
});

it("surfaces association failures", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("association failed"));
  const { result } = renderHook(() => useCommandLocationAssociations(
    environment("/nvm/versions/node/v24/bin/node"),
    ["Nvm"],
    { Nvm: nvmSnapshot([{ kind: "NvmNodeVersions", path: "/nvm/versions/node/v24" }]) },
    {},
    emptyLedger(),
  ));

  await waitFor(() => expect(result.current.error).toContain("association failed"));
  expect(result.current.resultAvailable).toBe(true);
});

it("recomputes on scan time changes but not on unrelated ledger changes", async () => {
  vi.mocked(invoke).mockResolvedValue({
    matches: [],
    unreadableLocationIds: [],
  });
  const environmentValue = environment("/nvm/versions/node/v24/bin/node");
  const snapshots = {
    Nvm: nvmSnapshot([{ kind: "NvmNodeVersions", path: "/nvm/versions/node/v24" }]),
  };
  const scanStates: Partial<Record<ManagerId, ManagerScanState>> = {
    Nvm: { phase: "idle", scannedAt: 10, error: null },
  };
  const { result, rerender } = renderHook(
    (props: {
      ledger: Partial<Record<ObservationItemId, ObservationRecord>>;
      scans: Partial<Record<ManagerId, ManagerScanState>>;
    }) => useCommandLocationAssociations(environmentValue, ["Nvm"], snapshots, props.scans, props.ledger),
    { initialProps: { ledger: emptyLedger(), scans: scanStates } },
  );

  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  rerender({ ledger: { environment: { itemId: "environment", lastSuccess: null, lastAttempt: null, invalidated: null } }, scans: scanStates });
  await act(async () => { await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledTimes(1);

  rerender({
    ledger: emptyLedger(),
    scans: { Nvm: { phase: "idle", scannedAt: 11, error: null } },
  });
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(result.current.error).toBeNull();
});
