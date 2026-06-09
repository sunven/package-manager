import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathPanel } from "./PathPanel";
import type { ManagerSnapshot } from "../types";

const noop = () => {};

function pnpmManager(): ManagerSnapshot {
  return {
    id: "Pnpm",
    label: "pnpm",
    status: "Ready",
    version: "10.0.0",
    packages: [],
    paths: [
      {
        label: "Store",
        kind: "Store",
        path: "/Users/sunven/Library/pnpm/store/v10",
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

describe("PathPanel", () => {
  it("shows a pnpm store prune action near the store path", () => {
    const html = renderToStaticMarkup(
      <PathPanel
        homeDirectory="/Users/sunven"
        manager={pnpmManager()}
        onCopyCleanupCommand={noop}
        onCopyPath={noop}
        onRequestCacheClean={noop}
        onRequestStorePrune={noop}
        onOpenPath={noop}
        pendingHomebrewCleanup={false}
        pendingMaintenance={null}
        scanning={false}
      />,
    );

    expect(html).toContain("清理 pnpm store");
  });
});
