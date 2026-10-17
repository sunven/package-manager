// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useObservationTools } from "./useObservationTools";
import type { EnvironmentInspection } from "../environmentInspection";
import type { ManagerId } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const inspection: EnvironmentInspection = { capturedAt: 1, commands: [], pathEntries: [] };

it("only reads on first entry and refreshes history when a new archive arrives", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === "inspect_environment" ? inspection : { snapshots: [], operations: [], warnings: [] });
  const { result, rerender } = renderHook(({ tab, revision }: { tab: "environment" | "history" | null; revision: number }) => useObservationTools(tab, ["Npm"], revision), { initialProps: { tab: null as "environment" | "history" | null, revision: 0 } });
  expect(invoke).not.toHaveBeenCalled();
  rerender({ tab: "environment", revision: 0 });
  await waitFor(() => expect(result.current.environment).toEqual(inspection));
  rerender({ tab: null, revision: 0 }); rerender({ tab: "environment", revision: 0 });
  expect(invoke).toHaveBeenCalledTimes(1);
  rerender({ tab: "history", revision: 0 });
  await waitFor(() => expect(result.current.history).not.toBeNull());
  rerender({ tab: "history", revision: 1 });
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
});

it("discards an older environment response after enabled managers change", async () => {
  let finish!: (value: EnvironmentInspection) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ ...inspection, capturedAt: 2 });
  const { result, rerender } = renderHook(({ managers }) => useObservationTools("environment", managers, 0), { initialProps: { managers: ["Npm"] as ManagerId[] } });
  rerender({ managers: ["Pip"] });
  await waitFor(() => expect(result.current.environment?.capturedAt).toBe(2));
  await act(async () => finish(inspection));
  expect(result.current.environment?.capturedAt).toBe(2);
});

it("settles correctly when mounted under StrictMode", async () => {
  vi.mocked(invoke).mockResolvedValue(inspection);
  const { result } = renderHook(() => useObservationTools("environment", ["Npm"], 0), { wrapper: StrictMode });
  await waitFor(() => expect(result.current.environment).toEqual(inspection));
  expect(result.current.environmentBusy).toBe(false);
});
