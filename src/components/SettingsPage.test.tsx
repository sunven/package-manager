import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppUpdateView } from "../appUpdateWorkflow";
import { SettingsPage } from "./SettingsPage";

const noop = () => {};

const updateView: AppUpdateView = {
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

describe("SettingsPage", () => {
  it("shows enabled package manager settings and locks the final enabled manager", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        appUpdate={{ view: updateView, onCheck: noop, onDownload: noop, onSkip: noop }}
        enabledManagers={["Pnpm"]}
        managerSnapshots={{}}
        onSetManagerEnabled={noop}
        scanningManagers={new Set()}
      />,
    );

    expect(html).toContain("启用的包管理器");
    expect(html).toContain("已启用 1 / 13");
    expect(html).toContain("pnpm");
    expect(html).toContain("disabled");
  });

  it("shows the app update section with the current version", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        appUpdate={{ view: updateView, onCheck: noop, onDownload: noop, onSkip: noop }}
        enabledManagers={["Npm"]}
        managerSnapshots={{}}
        onSetManagerEnabled={noop}
        scanningManagers={new Set()}
      />,
    );

    expect(html).toContain("软件更新");
    expect(html).toContain("当前版本 v0.1.0");
  });
});
