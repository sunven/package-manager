// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useSkillInventory,
  type SkillInventoryAdapter,
  type SkillInventoryOptions,
} from "./useSkillInventory";

type TestScan = {
  snapshotId: string | null;
  directory: string;
  rows: string[];
  usable: boolean;
  error: string | null;
};

type TestIntent = { operation: "Enable" | "Disable" };
type TestPreview = { planId: string; operation: TestIntent["operation"] };
type TestOutcome = { status: "Saved" | "Partial"; message: string };

let scanImpl: () => Promise<TestScan>;
let prepareImpl: (intent: TestIntent, snapshotId: string) => Promise<TestPreview>;
let cancelImpl: (planId: string) => Promise<unknown>;
let commitImpl: (planId: string) => Promise<TestOutcome>;
let readDetailsImpl: (snapshotId: string, path: string) => Promise<string>;
let scanCalls: string[];
let prepareCalls: { intent: TestIntent; snapshotId: string }[];
let cancelCalls: string[];
let commitCalls: string[];
let readDetailsCalls: { snapshotId: string; path: string }[];

const adapter: SkillInventoryAdapter<TestScan, TestIntent, TestPreview, TestOutcome> = {
  scan: async () => {
    scanCalls.push("scan");
    return scanImpl();
  },
  prepare: async (intent, snapshotId) => {
    prepareCalls.push({ intent, snapshotId });
    return prepareImpl(intent, snapshotId);
  },
  cancel: async (planId) => {
    cancelCalls.push(planId);
    return cancelImpl(planId);
  },
  commit: async (planId) => {
    commitCalls.push(planId);
    return commitImpl(planId);
  },
  readDetails: async (snapshotId, path) => {
    readDetailsCalls.push({ snapshotId, path });
    return readDetailsImpl(snapshotId, path);
  },
  interpretScan: (previous, next) => next.usable
    ? { scan: next, usable: true, error: null }
    : {
        scan: previous?.directory === next.directory
          ? { ...next, rows: previous.rows, snapshotId: null }
          : next,
        usable: false,
        error: next.error ?? "清单读取失败。",
      },
  unconfirmed: (message) => ({ status: "Partial", message }),
};

function scan(rows: string[], overrides: Partial<TestScan> = {}): TestScan {
  return { snapshotId: "snap-1", directory: "/skills", rows, usable: true, error: null, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function renderInventory(initial: Partial<SkillInventoryOptions> = {}) {
  return renderHook(
    (options: SkillInventoryOptions) => useSkillInventory(adapter, options),
    { initialProps: { active: true, dependency: "initial", ...initial } },
  );
}

async function ready(result: ReturnType<typeof renderInventory>["result"]) {
  await waitFor(() => expect(result.current.scan?.rows).toEqual(["initial"]));
}

beforeEach(() => {
  scanCalls = [];
  prepareCalls = [];
  cancelCalls = [];
  commitCalls = [];
  readDetailsCalls = [];
  scanImpl = async () => scan(["initial"]);
  prepareImpl = async (intent) => ({ planId: "plan-1", operation: intent.operation });
  cancelImpl = async () => undefined;
  commitImpl = async () => ({ status: "Saved", message: "saved" });
  readDetailsImpl = async () => "details";
});

afterEach(cleanup);

describe("Skill inventory lifecycle", () => {
  it("reads once and exposes the interpreted inventory", async () => {
    const { result } = renderInventory();
    await ready(result);
    expect(scanCalls).toHaveLength(1);
    expect(result.current.current).toBe(true);
    expect(result.current.scanning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps the previous rows when a read returns an unusable inventory", async () => {
    const { result } = renderInventory();
    await ready(result);
    scanImpl = async () => scan([], { usable: false, error: "读取失败", snapshotId: null });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.scan?.rows).toEqual(["initial"]);
    expect(result.current.current).toBe(false);
    expect(result.current.error).toBe("读取失败");
  });

  it("ignores a read that started before the dependency changed", async () => {
    const first = deferred<TestScan>();
    const second = deferred<TestScan>();
    let calls = 0;
    scanImpl = () => (++calls === 1 ? first.promise : second.promise);
    const view = renderInventory();
    await waitFor(() => expect(calls).toBe(1));
    view.rerender({ active: true, dependency: "changed" });
    await act(async () => { first.resolve(scan(["stale"])); await Promise.resolve(); });
    await waitFor(() => expect(calls).toBe(2));
    expect(view.result.current.scan).toBeNull();
    await act(async () => { second.resolve(scan(["fresh"])); await Promise.resolve(); });
    await waitFor(() => expect(view.result.current.scan?.rows).toEqual(["fresh"]));
  });

  it("freezes a prepared preview and cancels it without committing", async () => {
    const { result } = renderInventory();
    await ready(result);
    await act(async () => {
      expect(await result.current.request({ operation: "Disable" })).toBeNull();
    });
    expect(result.current.phase).toBe("confirming");
    expect(result.current.preview).toEqual({ planId: "plan-1", operation: "Disable" });
    expect(prepareCalls).toEqual([{ intent: { operation: "Disable" }, snapshotId: "snap-1" }]);
    await act(async () => { result.current.cancel(); await Promise.resolve(); });
    await waitFor(() => expect(cancelCalls).toEqual(["plan-1"]));
    expect(result.current.preview).toBeNull();
    expect(commitCalls).toEqual([]);
  });

  it("cancels a pending preview when the dependency changes", async () => {
    const view = renderInventory();
    await ready(view.result);
    await act(async () => { await view.result.current.request({ operation: "Disable" }); });
    view.rerender({ active: true, dependency: "changed" });
    await waitFor(() => expect(cancelCalls).toEqual(["plan-1"]));
    expect(view.result.current.preview).toBeNull();
    expect(view.result.current.phase).toBeNull();
  });

  it("submits one frozen preview once and stores the outcome before rereading", async () => {
    const { result } = renderInventory();
    await ready(result);
    await act(async () => { await result.current.request({ operation: "Disable" }); });
    const commit = deferred<TestOutcome>();
    commitImpl = () => commit.promise;
    let first!: Promise<TestOutcome | null>;
    let second!: Promise<TestOutcome | null>;
    act(() => {
      first = result.current.confirm();
      second = result.current.confirm();
    });
    expect(commitCalls).toEqual(["plan-1"]);
    await act(async () => {
      commit.resolve({ status: "Saved", message: "saved" });
      await first;
      await second;
    });
    expect(result.current.result).toEqual({ status: "Saved", message: "saved" });
    expect(result.current.phase).toBeNull();
    expect(scanCalls).toHaveLength(2);
  });

  it("turns an unconfirmed commit into a partial outcome and rereads", async () => {
    const { result } = renderInventory();
    await ready(result);
    await act(async () => { await result.current.request({ operation: "Disable" }); });
    commitImpl = async () => { throw new Error("lost response"); };
    await act(async () => { await result.current.confirm(); });
    expect(result.current.result).toEqual({
      status: "Partial",
      message: "操作结果未完整确认：lost response。请核对清单，勿直接重复执行。",
    });
    expect(scanCalls).toHaveLength(2);
  });

  it("refuses stale details and delegates when the inventory is current", async () => {
    const { result } = renderInventory();
    await expect(result.current.details("SKILL.md")).rejects.toThrow("清单已过期，请刷新后查看说明。");
    await ready(result);
    await expect(result.current.details("SKILL.md")).resolves.toBe("details");
    expect(readDetailsCalls).toEqual([{ snapshotId: "snap-1", path: "SKILL.md" }]);
    scanImpl = async () => scan([], { usable: false, error: "fail", snapshotId: null });
    await act(async () => { await result.current.refresh(); });
    await expect(result.current.details("SKILL.md")).rejects.toThrow("清单已过期，请刷新后查看说明。");
  });

  it("does not auto-read or prepare while another operation is busy", async () => {
    const view = renderInventory({ externalBusy: true });
    await act(async () => { await Promise.resolve(); });
    expect(scanCalls).toHaveLength(0);
    expect(await view.result.current.request({ operation: "Disable" })).toBe("清单已过期或正在维护，请刷新后重试。");
    view.rerender({ active: true, dependency: "initial", externalBusy: false });
    await ready(view.result);
    expect(scanCalls).toHaveLength(1);
  });

  it("waits for activation before the first read", async () => {
    const view = renderInventory({ active: false });
    await act(async () => { await Promise.resolve(); });
    expect(scanCalls).toHaveLength(0);
    view.rerender({ active: true, dependency: "initial" });
    await ready(view.result);
    expect(scanCalls).toHaveLength(1);
  });

  it("runs the mutation hook after commit and before the post-commit read", async () => {
    const order: string[] = [];
    scanImpl = async () => { order.push("read"); return scan(["initial"]); };
    commitImpl = async () => { order.push("commit"); return { status: "Saved", message: "saved" }; };
    const view = renderInventory({ onMutation: () => order.push("mutation") });
    await ready(view.result);
    await act(async () => { await view.result.current.request({ operation: "Disable" }); });
    await act(async () => { await view.result.current.confirm(); });
    expect(order).toEqual(["read", "commit", "mutation", "read"]);
  });
});
