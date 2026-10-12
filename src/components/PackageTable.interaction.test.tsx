// @vitest-environment jsdom
import { useState } from "react";
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
    expect(screen.getByText("没有匹配的条目，请调整搜索词")).toBeTruthy();
  });

  it.each(["Npm", "Pip"] as const)("keeps native table semantics and independent keyboard actions for %s", async (managerId) => {
    const user = userEvent.setup();
    const copy = vi.fn();
    const select = vi.fn();
    const noop = vi.fn();
    const packages: PackageRow[] = ["zeta", "alpha"].map((name) => ({
      name, version: "2", path: `/lib/${name}`, kind: managerId === "Pip" ? "PythonDistribution" : "Generic", source: "global", signals: ["Outdated"], actions: [],
    }));
    function Table() {
      const [selected, setSelected] = useState<number | null>(null);
      const [menu, setMenu] = useState<number | null>(null);
      return <PackageTable homeDirectory={null} manager={managerFixture(managerId, { packages })}
        menuOpenIndex={menu} onCopyPackage={copy} onCopyPackageAction={noop} onHomebrewFilter={noop} onMavenFilter={noop} onPipFilter={noop}
        onOpenPackage={noop} onCopyPath={noop} onOpenPath={noop} onRequestCacheCleanup={noop} onRequestPackageUninstall={noop}
        onSelectPackage={(index) => { select(index); setSelected(index); }} onToggleActions={(index) => setMenu((current) => current === index ? null : index)}
        pendingMaintenance={null} scanning={false} selectedHomebrewFilter="All" selectedMavenFilter="All" selectedPackageIndex={selected} selectedPipFilter="All" />;
    }
    render(<Table />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    const name = screen.getByRole("button", { name: "选择 alpha 2" });
    const row = name.closest("tr")!;
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(within(row).getByRole("cell", { name: managerId === "Npm" ? /alpha.*可更新/ : /alpha.*Python 包/ })).toBeTruthy();

    name.focus();
    await user.keyboard("{Enter}");
    expect(select).toHaveBeenCalledExactlyOnceWith(1);
    expect(name.getAttribute("aria-pressed")).toBe("true");
    select.mockClear();
    await user.keyboard(" ");
    expect(select).toHaveBeenCalledExactlyOnceWith(1);
    select.mockClear();

    await user.tab();
    const action = within(row).getByRole("button", { name: managerId === "Npm" ? "复制包名" : "操作" });
    expect(document.activeElement).toBe(action);
    await user.keyboard("{Enter}");
    if (managerId === "Pip") {
      const copyItem = await screen.findByRole("menuitem", { name: "复制包名" });
      expect(document.activeElement).toBe(copyItem);
      await user.keyboard("{Enter}");
    }
    expect(copy).toHaveBeenCalledExactlyOnceWith(1);
    expect(select).not.toHaveBeenCalled();
    expect(name.getAttribute("aria-pressed")).toBe("true");
  });
});
