import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PackageTable } from "./PackageTable";
import type { ManagerSnapshot } from "../types";

const noop = () => {};

function packageManager(id: "Npm" | "Pnpm" | "Nvm", signals: ManagerSnapshot["packages"][number]["signals"] = []): ManagerSnapshot {
  return {
    id,
    label: id === "Npm" ? "npm" : id === "Pnpm" ? "pnpm" : "nvm",
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
});
