import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppUpdateView } from "../appUpdateWorkflow";
import { AppUpdatePanel } from "./AppUpdatePanel";

const noop = () => {};

const baseView: AppUpdateView = {
  phase: "idle",
  devMode: false,
  currentVersion: "0.1.0",
  availableVersion: null,
  notes: null,
  progress: null,
  error: null,
  dismissedVersion: null,
  promptVersion: null,
};

function render(view: Partial<AppUpdateView>) {
  return renderToStaticMarkup(
    <AppUpdatePanel
      onCheck={noop}
      onDownload={noop}
      onSkip={noop}
      view={{ ...baseView, ...view }}
    />,
  );
}

describe("AppUpdatePanel", () => {
  it("shows the current version and the idle state", () => {
    const html = render({});

    expect(html).toContain("软件更新");
    expect(html).toContain("当前版本 v0.1.0");
    expect(html).toContain("尚未检查更新。");
    expect(html).toContain("检查更新");
  });

  it("offers to install or skip an available version", () => {
    const html = render({
      phase: "available",
      availableVersion: "0.1.2",
      notes: "### 修复\n\n- 更新提示",
      promptVersion: "0.1.2",
    });

    expect(html).toContain("发现新版本 v0.1.2");
    expect(html).toContain("更新到 0.1.2");
    expect(html).toContain("跳过此版本");
    expect(html).toContain("更新提示");
  });

  it("hides the skip action once the version is dismissed", () => {
    const html = render({
      phase: "available",
      availableVersion: "0.1.2",
      dismissedVersion: "0.1.2",
    });

    expect(html).toContain("更新到 0.1.2");
    expect(html).not.toContain("跳过此版本");
  });

  it("renders determinate and indeterminate download progress", () => {
    const determinate = render({ phase: "downloading", availableVersion: "0.1.2", progress: 42 });
    expect(determinate).toContain("正在下载更新… 42%");
    expect(determinate).toContain('aria-valuenow="42"');

    const indeterminate = render({ phase: "downloading", availableVersion: "0.1.2", progress: null });
    expect(indeterminate).toContain("正在下载更新…");
    expect(indeterminate).not.toContain("aria-valuenow");
  });

  it("shows failures and disables checking in development mode", () => {
    const failed = render({ phase: "failed", error: "网络连接失败，请检查网络设置。" });
    expect(failed).toContain("网络连接失败，请检查网络设置。");
    expect(failed).toContain("重新检查");

    const dev = render({ devMode: true });
    expect(dev).toContain("开发模式下无法检查更新");
    expect(dev).toContain("disabled");
  });
});
