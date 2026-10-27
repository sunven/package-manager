import { describe, expect, it } from "vitest";
import { managerTabPresentation } from "./managerObservationPresentation";
import { managerFixture } from "./test/fixtures";
import { NOW, OBSERVED_AT, observationCoverageItem } from "./test/observationFixtures";

function present(
  overrides: Parameters<typeof observationCoverageItem>[1] = {},
  options: { snapshot?: Parameters<typeof managerFixture>[1]; scanning?: boolean } = {},
) {
  return managerTabPresentation(observationCoverageItem("manager:npm", overrides), {
    managerName: "npm",
    snapshot: managerFixture("Npm", options.snapshot),
    scanning: options.scanning ?? false,
    now: NOW,
  });
}

describe("manager tab presentation", () => {
  it("preserves missing CLI and unsupported semantics instead of mapping them to failure or ready", () => {
    expect(present({ status: "unavailable" })).toMatchObject({ status: "Missing", label: "未安装" });
    expect(present({ status: "observed" }, { snapshot: { status: "Unsupported" } })).toMatchObject({
      status: "Unsupported",
      label: "不支持",
    });
    expect(present({ status: "observed" }, { snapshot: { status: "Partial" } })).toMatchObject({
      status: "Partial",
      label: "部分可用",
    });
  });

  it("maps failures, scanning and current reads to the tab dot", () => {
    expect(present({ status: "failed" })).toMatchObject({ status: "Failed", label: "失败" });
    expect(present({ status: "inProgress" })).toMatchObject({ status: "Scanning", label: "扫描中" });
    expect(present({ status: "observed" }, { scanning: true })).toMatchObject({ status: "Scanning", label: "扫描中" });
    expect(present({ status: "observed" }, { snapshot: { status: "Ready" } })).toMatchObject({
      status: "Ready",
      label: "就绪",
    });
  });

  it("maps last observed and not observed to neutral tabs", () => {
    expect(present({ status: "lastObserved", lastSuccessAt: OBSERVED_AT })).toMatchObject({
      status: "neutral",
      label: "上次观察",
    });
    expect(present({ status: "notObserved", lastSuccessAt: null })).toMatchObject({
      status: "Not scanned",
      label: "未扫描",
    });
  });

  it("builds a compact title with observation time and detail", () => {
    const presentation = present({
      status: "observed",
      note: "清单不可用",
      lastSuccessAt: OBSERVED_AT,
    }, { snapshot: { status: "Unsupported" } });
    expect(presentation.title).toContain("npm");
    expect(presentation.title).toContain("不支持");
    expect(presentation.title).toContain("观察于");
    expect(presentation.title).toContain("清单不可用");
    expect(presentation.observationStatus).toBe("observed");
  });
});
