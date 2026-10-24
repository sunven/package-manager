// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerScanState } from "../managerScanning";
import { NOW, OBSERVED_AT, observationCoverageItem } from "../test/observationFixtures";
import { ManagerObservationHeader } from "./ManagerObservationHeader";

afterEach(cleanup);

function scanState(overrides: Partial<ManagerScanState> = {}): ManagerScanState {
  return { phase: "idle", scannedAt: OBSERVED_AT, error: null, ...overrides };
}

function renderHeader(
  item = observationCoverageItem("manager:npm"),
  {
    state = scanState(),
    scanMeta = "",
    scanning = false,
    busy = false,
    onRefresh = vi.fn(),
  }: {
    state?: ManagerScanState;
    scanMeta?: string;
    scanning?: boolean;
    busy?: boolean;
    onRefresh?: () => void;
  } = {},
) {
  render(
    <ManagerObservationHeader
      busy={busy}
      item={item}
      now={NOW}
      onRefresh={onRefresh}
      scanMeta={scanMeta}
      scanState={state}
      scanning={scanning}
    />,
  );
  return onRefresh;
}

describe("ManagerObservationHeader", () => {
  it("renders one live strip with queued, reading and enriching phase detail", () => {
    const { rerender } = render(<ManagerObservationHeader item={observationCoverageItem("manager:npm")} now={NOW} onRefresh={vi.fn()} scanMeta="" scanState={scanState({ phase: "queued" })} scanning busy={false} />);
    expect(screen.getByRole("status").textContent).toContain("等待扫描");

    rerender(<ManagerObservationHeader item={observationCoverageItem("manager:npm")} now={NOW} onRefresh={vi.fn()} scanMeta="" scanState={scanState({ phase: "reading" })} scanning busy={false} />);
    expect(screen.getByRole("status").textContent).toContain("读取清单");

    rerender(<ManagerObservationHeader item={observationCoverageItem("manager:npm")} now={NOW} onRefresh={vi.fn()} scanMeta="正在加载清理预演..." scanState={scanState({ phase: "enriching" })} scanning busy={false} />);
    expect(screen.getByRole("status").textContent).toContain("测量占用／加载补充信息");
    expect(screen.getByRole("status").textContent).toContain("正在加载清理预演...");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps the native refresh button outside the strip and mirrors its disabled state", () => {
    const onRefresh = renderHeader(observationCoverageItem("manager:npm"), { busy: true });
    const refresh = screen.getByRole("button", { name: "刷新当前管理器" }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();

    cleanup();
    const enabled = renderHeader(observationCoverageItem("manager:npm"));
    fireEvent.click(screen.getByRole("button", { name: "刷新当前管理器" }));
    expect(enabled).toHaveBeenCalledOnce();
  });

  it("suppresses detailed failure notes while keeping unavailable and unsupported notes", () => {
    renderHeader(observationCoverageItem("manager:npm", { status: "failed", note: "扫描失败原因" }));
    expect(screen.queryByText(/扫描失败原因/)).toBeNull();

    cleanup();
    renderHeader(observationCoverageItem("manager:npm", { status: "unavailable", note: "CLI 缺失" }));
    expect(screen.getByText(/CLI 缺失/)).toBeTruthy();

    cleanup();
    renderHeader(observationCoverageItem("manager:npm", { status: "observed", note: "清单不可用" }));
    expect(screen.getByText(/清单不可用/)).toBeTruthy();
  });

  it("does not add a page-wide busy flag", () => {
    renderHeader(observationCoverageItem("manager:npm"));
    expect(document.querySelector("[data-observation-item='manager:npm']")?.getAttribute("aria-busy")).toBeNull();
  });
});
