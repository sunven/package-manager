import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathPanel } from "./PathPanel";
import type { ManagerId, ManagerSnapshot, ManagerStatus, PathKind } from "../types";

const noop = () => {};

function manager(
  id: ManagerId,
  kind: PathKind,
  label: string,
  status: ManagerStatus = "Ready",
): ManagerSnapshot {
  return {
    id,
    label: id,
    status,
    version: "1.0.0",
    packages: [],
    paths: [
      {
        label,
        kind,
        path: `/Users/sunven/${id}`,
        size: {
          status: "Ready",
          bytes: 1024,
          human: "1.0 KiB",
          files: 3,
          directories: 1,
          skipped: 0,
          message: null,
        },
      },
    ],
    commands: [],
    failures: [],
    unsupportedReason: null,
    homebrew: null,
    maven: null,
    pip: null,
    docker: null,
  };
}

function homebrewMaintenance(cleanupStatus: "Pending" | "Ready" | "Failed") {
  return {
    formulaCount: 2,
    caskCount: 1,
    outdatedCount: 0,
    leafCount: 0,
    outdated: [],
    leaves: [],
    cleanup: {
      status: cleanupStatus,
      command: {
        program: "brew",
        args: ["cleanup", "--dry-run"],
        preview: "brew cleanup --dry-run",
        timeoutMs: 30000,
      },
      rawOutput: cleanupStatus === "Ready" ? "Removing: /opt/homebrew/Cellar/node/24.1.0" : "",
      reclaimedBytes: cleanupStatus === "Ready" ? 1 : null,
      reclaimedHuman: cleanupStatus === "Ready" ? "1.2 GB" : null,
      message: null,
      failure: null,
    },
  };
}

function render(snapshot: ManagerSnapshot) {
  return renderToStaticMarkup(
    <PathPanel
      homeDirectory="/Users/sunven"
      manager={snapshot}
      onCopyCleanupCommand={noop}
      onCopyPath={noop}
      onRequestCacheCleanup={noop}
      onOpenPath={noop}
      pendingHomebrewCleanup={false}
      pendingMaintenance={null}
      scanning={false}
    />,
  );
}

describe("PathPanel", () => {
  it("shows a pnpm store prune action near the store path", () => {
    expect(render(manager("Pnpm", "Store", "Store"))).toContain("清理 pnpm store");
  });

  it("shows cleanup actions for Yarn and Bun on their cache paths", () => {
    expect(render(manager("Yarn", "Cache", "Cache"))).toContain("清理 Yarn 缓存");
    expect(render(manager("Bun", "BunCache", "Bun cache"))).toContain("清理 Bun 缓存");
  });

  it("still offers Yarn cleanup when Yarn 2+ is reported as Unsupported", () => {
    // `Unsupported` denies a global package listing, not cache capability. The
    // cache path is scanned and sized, so withholding the button would leave a
    // visible multi-gigabyte figure with no way to act on it.
    const html = render(manager("Yarn", "Cache", "Cache folder", "Unsupported"));

    expect(html).toContain("清理 Yarn 缓存");
  });

  it("offers no cleanup when the manager is not installed", () => {
    expect(render(manager("Yarn", "Cache", "Cache", "Missing"))).not.toContain("清理 Yarn 缓存");
    expect(render(manager("Bun", "BunCache", "Bun cache", "Missing"))).not.toContain("清理 Bun 缓存");
  });

  it("offers Homebrew cleanup on the dry-run card once the preview has landed", () => {
    const ready = { ...manager("Homebrew", "Cache", "Cache"), homebrew: homebrewMaintenance("Ready") };
    const pending = { ...manager("Homebrew", "Cache", "Cache"), homebrew: homebrewMaintenance("Pending") };

    expect(render(ready)).toContain("执行 Homebrew 清理");
    // No dry-run yet means no itemised list to confirm against, so no button.
    expect(render(pending)).not.toContain("执行 Homebrew 清理");
  });

  it("puts the Homebrew button on the dry-run card, next to the itemised list", () => {
    const ready = { ...manager("Homebrew", "Cache", "Cache"), homebrew: homebrewMaintenance("Ready") };
    const html = render(ready);

    // The button and the list of what will be removed must be on the same card;
    // that pairing is the safety argument for Homebrew (ADR-0002). Exclusion from
    // the cache path card is asserted at the copy-table level.
    expect(html).toContain("清理预演");
    expect(html).toContain("Cellar/node/24.1.0");
    expect(html).toContain("执行 Homebrew 清理");
  });

  it("offers uv cleanup on its cache card only", () => {
    expect(render(manager("Uv", "UvCache", "uv cache"))).toContain("清理 uv 缓存");
    expect(render(manager("Uv", "UvTools", "uv tools"))).not.toContain("清理 uv 缓存");
    expect(render(manager("Uv", "UvPythonInstallations", "uv pythons"))).not.toContain("清理 uv 缓存");
  });

  it("offers pip cleanup on its stacked cache card", () => {
    // pip has no inline path card, so its cleanup lives on the stacked PathCard.
    // Before this existed, a manager without inline paths had nowhere to put the
    // affordance and would silently ship without one.
    const html = render(manager("Pip", "Cache", "pip cache"));

    expect(html).toContain("清理 pip 缓存");
  });

  it("offers no pip cleanup when Python is not installed", () => {
    expect(render(manager("Pip", "Cache", "pip cache", "Missing"))).not.toContain("清理 pip 缓存");
  });

  it("offers no cleanup on stacked cards for managers that have no plan", () => {
    // Maven's local repository is the largest directory many users have, and it
    // renders as a stacked card just like pip's cache. It must stay button-free.
    const html = render(manager("Maven", "LocalRepository", "Local repository"));

    expect(html).toContain("本地仓库");
    expect(html).not.toContain("清理");
  });

  it("offers no cleanup for managers that have no plan", () => {
    // nvm renders inline path cards like npm and Yarn do, so this exercises the
    // copy table's gate rather than passing because the card type never had a
    // button. nvm has no cleanup plan per ADR-0001.
    const html = render(manager("Nvm", "NvmDir", "nvm 目录"));

    expect(html).toContain("nvm 目录");
    expect(html).not.toContain("清理");
  });
});
