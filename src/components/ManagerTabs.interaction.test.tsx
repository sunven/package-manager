// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ManagerTabs } from "./ManagerTabs";
import { managerFixture } from "../test/fixtures";
import { managerCoverageItems } from "../test/observationFixtures";
import type { ManagerId } from "../types";

afterEach(cleanup);

it("associates each manager tab with a panel and switches visible content by keyboard", async () => {
  const user = userEvent.setup();
  function Managers() {
    const [selected, setSelected] = useState<ManagerId>("Npm");
    return <ManagerTabs managerIds={["Npm", "Pip"]} managerSnapshots={{ Npm: managerFixture("Npm"), Pip: managerFixture("Pip") }}
      coverageByManager={managerCoverageItems()} onSelect={setSelected} scanningManagers={new Set()} selectedManager={selected}>
      <p>当前管理器：{selected}</p>
      <button type="button">刷新当前管理器</button>
    </ManagerTabs>;
  }
  render(<Managers />);
  const tabs = within(screen.getByRole("tablist", { name: "包管理器" })).getAllByRole("tab");
  for (const tab of tabs) {
    const panel = document.getElementById(tab.getAttribute("aria-controls")!);
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(panel?.hidden).toBe(tab.getAttribute("aria-selected") !== "true");
  }
  expect(within(screen.getByRole("tabpanel", { name: /^Npm/ })).getByText("当前管理器：Npm")).toBeTruthy();
  tabs[0].focus();
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(tabs[1].getAttribute("aria-selected")).toBe("true"));
  expect(document.activeElement).toBe(tabs[1]);
  expect(within(screen.getByRole("tabpanel", { name: /^Pip/ })).getByText("当前管理器：Pip")).toBeTruthy();
  expect(screen.queryByText("当前管理器：Npm")).toBeNull();
  expect(screen.getAllByRole("button", { name: "刷新当前管理器" })).toHaveLength(1);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
});

it("keeps the content available when no managers are enabled", () => {
  render(<ManagerTabs coverageByManager={managerCoverageItems()} managerIds={[]} managerSnapshots={{}} onSelect={vi.fn()} scanningManagers={new Set()} selectedManager="Npm">
    <p>尚未扫描</p>
    <button type="button">刷新当前管理器</button>
  </ManagerTabs>);
  expect(screen.getByText("尚未扫描")).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新当前管理器" })).toBeTruthy();
  expect(screen.queryByRole("tablist")).toBeNull();
});

it("keeps missing CLI, unsupported, failed and last observed distinct in tab dots", () => {
  render(
    <ManagerTabs
      coverageByManager={managerCoverageItems({
        Npm: { status: "observed" },
        Yarn: { status: "observed" },
        Pip: { status: "unavailable" },
        Bun: { status: "lastObserved" },
        Homebrew: { status: "failed" },
      })}
      managerIds={["Npm", "Yarn", "Pip", "Bun", "Homebrew"]}
      managerSnapshots={{
        Npm: managerFixture("Npm"),
        Yarn: managerFixture("Yarn", { status: "Unsupported" }),
        Pip: managerFixture("Pip", { status: "Missing" }),
        Bun: managerFixture("Bun"),
        Homebrew: managerFixture("Homebrew"),
      }}
      onSelect={vi.fn()}
      scanningManagers={new Set()}
      selectedManager="Npm"
    >
      <p>内容</p>
    </ManagerTabs>,
  );

  const tabs = within(screen.getByRole("tablist", { name: "包管理器" })).getAllByRole("tab");
  const dots = tabs.map((tab) => within(tab).getByRole("img"));
  expect(dots[0].getAttribute("data-status")).toBe("Ready");
  expect(dots[0].getAttribute("data-observation-status")).toBe("observed");
  expect(dots[1].getAttribute("data-status")).toBe("Unsupported");
  expect(dots[1].getAttribute("aria-label")).toBe("不支持");
  expect(dots[2].getAttribute("data-status")).toBe("Missing");
  expect(dots[2].getAttribute("aria-label")).toBe("未安装");
  expect(dots[3].getAttribute("data-status")).toBe("neutral");
  expect(dots[3].getAttribute("aria-label")).toBe("上次观察");
  expect(dots[4].getAttribute("data-status")).toBe("Failed");
  expect(dots[4].getAttribute("aria-label")).toBe("失败");
});
