// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  flushObservationLedgerWrites,
  getObservationLedgerSnapshot,
  loadObservationLedgerOnce,
  loadObservationScopes,
  recordObservation,
  resetObservationLedgerForTests,
} from "./observationLedger";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
  resetObservationLedgerForTests();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});

afterEach(() => {
  resetObservationLedgerForTests();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("observation ledger client", () => {
  it("loads records, keeps a newer local success and queues writes", async () => {
    recordObservation({
      kind: "success",
      itemId: "manager:npm",
      at: 20,
      scope: "new",
      scopeLabel: null,
      completeness: "complete",
      note: null,
    });
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "load_observation_ledger") {
        return {
          records: [{
            itemId: "manager:npm",
            lastSuccess: { at: 10, scope: "old", scopeLabel: null, completeness: "complete", note: null },
            lastAttempt: { at: 10, outcome: "succeeded", scope: "old", reason: null },
            invalidated: null,
          }],
          warnings: ["load warning"],
        };
      }
      if (command === "record_observation") return { warning: null };
      return {};
    });

    await loadObservationLedgerOnce();
    await flushObservationLedgerWrites();
    const snapshot = getObservationLedgerSnapshot();
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.warnings).toContain("load warning");
    expect(snapshot.records["manager:npm"]?.lastSuccess?.at).toBe(20);
    expect(mockedInvoke).toHaveBeenCalledWith("load_observation_ledger");
    expect(mockedInvoke).toHaveBeenCalledWith(
      "record_observation",
      { event: expect.objectContaining({ kind: "success", itemId: "manager:npm" }) },
    );
  });

  it("applies success, failed attempts and invalidation locally", () => {
    recordObservation({
      kind: "success",
      itemId: "environment",
      at: 10,
      scope: "scope",
      scopeLabel: "范围",
      completeness: "complete",
      note: null,
    });
    recordObservation({
      kind: "attempt",
      itemId: "environment",
      at: 20,
      outcome: "failed",
      scope: "new",
      reason: "offline",
    });
    let record = getObservationLedgerSnapshot().records.environment;
    expect(record?.lastSuccess?.at).toBe(10);
    expect(record?.lastAttempt).toMatchObject({ at: 20, outcome: "failed", scope: "new" });

    recordObservation({ kind: "invalidate", itemId: "environment", at: 30, reason: "changed" });
    record = getObservationLedgerSnapshot().records.environment;
    expect(record?.invalidated).toMatchObject({ at: 30, reason: "changed" });
    expect(record?.lastSuccess?.at).toBe(10);

    recordObservation({
      kind: "success",
      itemId: "environment",
      at: 40,
      scope: "scope",
      scopeLabel: "范围",
      completeness: "partial",
      note: "partial",
    });
    record = getObservationLedgerSnapshot().records.environment;
    expect(record?.invalidated).toBeNull();
    expect(record?.lastAttempt).toMatchObject({ at: 40, outcome: "succeeded" });
    expect(record?.lastSuccess?.completeness).toBe("partial");
  });

  it("surfaces write warnings and rejects unknown items", async () => {
    mockedInvoke.mockResolvedValue({ warning: "disk full" });
    recordObservation({
      kind: "success",
      itemId: "vscode-storage",
      at: 10,
      scope: "vscode:/x",
      scopeLabel: "VS Code 工作区存储",
      completeness: "complete",
      note: null,
    });
    await flushObservationLedgerWrites();
    expect(getObservationLedgerSnapshot().warnings).toContain("disk full");
    expect(() => recordObservation({
      kind: "success",
      // @ts-expect-error unknown item is rejected by the client
      itemId: "future:item",
      at: 10,
      scope: null,
      scopeLabel: null,
      completeness: "complete",
      note: null,
    })).toThrow();
  });

  it("loads scopes and filters unknown ids", async () => {
    mockedInvoke.mockResolvedValue({
      environment: { key: "env", label: "环境" },
      "manager:npm": null,
      "future:item": { key: "future", label: "future" },
    });
    const scopes = await loadObservationScopes(["Npm"]);
    expect(scopes.environment).toEqual({ key: "env", label: "环境" });
    expect(scopes["manager:npm"]).toBeNull();
    expect("future:item" in scopes).toBe(false);
    expect(mockedInvoke).toHaveBeenCalledWith("load_observation_scopes", { enabledManagers: ["Npm"] });
  });

  it("does not call Tauri outside the desktop runtime", async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    recordObservation({
      kind: "success",
      itemId: "environment",
      at: 10,
      scope: null,
      scopeLabel: null,
      completeness: "complete",
      note: null,
    });
    await flushObservationLedgerWrites();
    await loadObservationLedgerOnce();
    expect(await loadObservationScopes(["Npm"])).toEqual({});
    expect(getObservationLedgerSnapshot().records.environment?.lastSuccess?.at).toBe(10);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
