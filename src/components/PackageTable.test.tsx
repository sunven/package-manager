import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PackageTable } from "./PackageTable";
import type { ManagerSnapshot } from "../types";

const noop = () => {};

function packageManager(id: "Npm" | "Pnpm" | "Nvm" | "Fvm", signals: ManagerSnapshot["packages"][number]["signals"] = []): ManagerSnapshot {
  return {
    id,
    label: id === "Npm" ? "npm" : id === "Pnpm" ? "pnpm" : id === "Nvm" ? "nvm" : "FVM",
    status: "Ready",
    version: "10.0.0",
    packages: [
      {
        name: "@scope/tool",
        version: "1.2.3",
        path: "/Users/sunven/.local/share/pnpm/global/5/node_modules/@scope/tool",
        source: "global",
        kind: "Generic",
        signals,
        actions: [],
      },
    ],
    paths: [],
    commands: [],
    failures: [],
    unsupportedReason: null,
    homebrew: null,
    maven: null,
    pip: null,
    docker: null,
  };
}

function renderPackageTable(manager: ManagerSnapshot) {
  return renderToStaticMarkup(
    <PackageTable
      homeDirectory="/Users/sunven"
      manager={manager}
      menuOpenIndex={null}
      onCopyPackage={noop}
      onCopyPackageAction={noop}
      onHomebrewFilter={noop}
      onMavenFilter={noop}
      onOpenPackage={noop}
      onCopyPath={noop}
      onOpenPath={noop}
      onPipFilter={noop}
      onRequestCacheCleanup={noop}
      onRequestPackageUninstall={noop}
      onSelectPackage={noop}
      onToggleActions={noop}
      pendingMaintenance={null}
      scanning={false}
      selectedHomebrewFilter="All"
      selectedMavenFilter="All"
      selectedPackageIndex={null}
      selectedPipFilter="All"
    />,
  );
}

describe("PackageTable", () => {
  it("renders Android SDK components with descriptions and blocks cmdline-tools removal", () => {
    const manager: ManagerSnapshot = {
      id: "AndroidSdk",
      label: "Android SDK",
      status: "Ready",
      version: "22.0",
      packages: [
        { name: "platforms;android-36", version: "2", path: "/sdk/platforms/android-36", source: "Android SDK Platform 36", kind: "AndroidSdkComponent", signals: [], actions: [] },
        { name: "cmdline-tools;22.0", version: "22.0", path: "/sdk/cmdline-tools/latest", source: "Android SDK Command-line Tools", kind: "AndroidSdkComponent", signals: [], actions: [] },
      ],
      paths: [],
      commands: [],
      failures: [],
      unsupportedReason: null,
      homebrew: null,
      maven: null,
      pip: null,
      docker: null,
      androidSdk: { cli: { program: "/sdk/cmdline-tools/latest/bin/android", flavor: "Android", sdkRoot: "/sdk" } },
    };

    const html = renderPackageTable(manager);

    expect(html).toContain("说明");
    expect(html).toContain("Android SDK Platform 36");
    expect(html).toContain("卸载 SDK 组件");
    expect(html).toContain("cmdline-tools 提供维护 CLI");
  });

  it("explains an unsupported Android SDK layout without the Yarn copy", () => {
    const manager: ManagerSnapshot = {
      ...packageManager("Npm"),
      id: "AndroidSdk",
      label: "Android SDK",
      status: "Unsupported",
      packages: [],
      unsupportedReason: "旧版 Android SDK 布局只提供集中式包索引，无法提供逐组件清单。",
    };

    const html = renderPackageTable(manager);

    expect(html).toContain("旧版 Android SDK 布局");
    expect(html).not.toContain("Yarn 现代版本");
  });

  it.each(["Missing", "Failed", "Partial"] as const)("does not present an unread %s list as an empty installation", (status) => {
    const html = renderPackageTable({ ...packageManager("Npm"), status, packages: [] });

    expect(html).toContain("扫描诊断");
    expect(html).not.toContain("未找到全局软件包");
  });

  it("keeps observed packages visible after an incomplete scan", () => {
    const html = renderPackageTable({ ...packageManager("Npm"), status: "Partial" });

    expect(html).toContain("@scope/tool");
    expect(html).not.toContain("扫描不完整，暂未读到条目");
  });

  it("keeps Docker storage and cleanup visible when the resource list is incomplete", () => {
    const html = renderPackageTable({
      ...packageManager("Npm"), id: "Docker", label: "Docker", status: "Partial", packages: [],
      docker: {
        imageCount: 0, containerCount: 0, runningContainerCount: 0, volumeCount: 0,
        danglingImageCount: 0, unusedImageCount: 0, diskUsageStatus: "Ready", diskUsageMessage: null,
        diskUsage: [{ resourceType: "Build Cache", totalCount: "1", activeCount: "0", size: "2 GB", reclaimable: "2 GB" }],
      },
    });

    expect(html).toContain("扫描不完整，暂未读到条目");
    expect(html).toContain("2 GB");
    expect(html).toContain("执行 Docker 清理");
  });

  it("shows pnpm global packages with the compact npm table columns", () => {
    const html = renderPackageTable(packageManager("Pnpm"));

    expect(html).toContain("名称");
    expect(html).toContain("版本");
    expect(html).toContain("操作");
    expect(html).not.toContain(">来源</th>");
    expect(html).not.toContain(">路径</th>");
  });

  it("shows a pnpm global package uninstall action", () => {
    const html = renderPackageTable(packageManager("Pnpm"));

    expect(html).toContain("卸载全局包");
  });

  it("shows nvm packages with compact table columns", () => {
    const html = renderPackageTable(packageManager("Nvm"));

    expect(html).toContain("名称");
    expect(html).toContain("版本");
    expect(html).toContain("操作");
    expect(html).not.toContain(">来源</th>");
    expect(html).not.toContain(">路径</th>");
    expect(html).not.toContain("当前版本");
  });

  it("marks the current nvm node version", () => {
    const html = renderPackageTable(packageManager("Nvm", ["Current"]));

    expect(html).toContain("当前版本");
  });

  it("shows FVM versions with compact table columns", () => {
    const html = renderPackageTable(packageManager("Fvm"));

    expect(html).toContain("名称");
    expect(html).toContain("版本");
    expect(html).toContain("操作");
    expect(html).not.toContain(">来源</th>");
    expect(html).not.toContain(">路径</th>");
  });

  it("shows an FVM-specific empty message instead of the global package one", () => {
    const html = renderPackageTable({ ...packageManager("Fvm"), packages: [] });

    expect(html).toContain("未找到已安装的 Flutter 版本");
    expect(html).not.toContain("未找到全局软件包");
  });
});
