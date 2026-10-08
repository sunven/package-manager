// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { PackageTable } from "./PackageTable";
import { managerFixture } from "../test/fixtures";
import type { PackageRow } from "../types";

afterEach(cleanup);

describe("package lookup", () => {
  it("searches hidden paths and preserves the original package identity for actions", async () => {
    const user = userEvent.setup();
    const pkg = (name: string, version: string, path: string): PackageRow => ({ name, version, path, kind: "Generic", source: "global", signals: [], actions: [] });
    const copy = vi.fn();
    const uninstall = vi.fn();
    const noop = vi.fn();
    render(<PackageTable homeDirectory={null} manager={managerFixture("Npm", { packages: [pkg("zeta", "10", "/lib/zeta"), pkg("alpha", "2", "/custom/alpha")] })}
      menuOpenIndex={null} onCopyPackage={copy} onCopyPackageAction={noop} onHomebrewFilter={noop} onMavenFilter={noop} onPipFilter={noop}
      onOpenPackage={noop} onCopyPath={noop} onOpenPath={noop} onRequestCacheCleanup={noop} onRequestPackageUninstall={uninstall}
      onSelectPackage={noop} onToggleActions={noop} pendingMaintenance={null} scanning={false} selectedHomebrewFilter="All" selectedMavenFilter="All" selectedPackageIndex={null} selectedPipFilter="All" />);
    const input = screen.getByRole("searchbox");
    await user.type(input, "/CUSTOM");
    expect(screen.queryByText("zeta")).toBeNull();
    const row = screen.getByText("alpha").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "复制包名" }));
    expect(copy).toHaveBeenCalledWith(1);
    fireEvent.click(within(row).getByRole("button", { name: "卸载全局包" }));
    expect(uninstall).toHaveBeenCalledWith(1);
    await user.clear(input);
    await user.type(input, "not-installed");
    expect(screen.getByText("没有匹配当前搜索条件的软件包")).toBeTruthy();
  });
});
