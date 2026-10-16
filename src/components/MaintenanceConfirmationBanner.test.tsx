// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MaintenanceConfirmationBanner } from "./MaintenanceConfirmationBanner";
import type { MaintenanceOperation } from "../managerMaintenanceWorkflow";

afterEach(cleanup);

function operation(changes: Partial<MaintenanceOperation> = {}): MaintenanceOperation {
  return {
    id: 1, request: { kind: "cleanupCache", managerId: "Npm" }, phase: "finished",
    execution: { status: "succeeded", title: "npm 缓存已清理", message: "npm cache clean --force" },
    verification: { status: "failed", message: "目录读取不完整" },
    reclaimable: null, reclaimDetails: null, invalidation: null, ...changes,
  };
}

it("shows independent execution and verification outcomes and offers only a read retry", async () => {
  const retry = vi.fn();
  const confirm = vi.fn();
  render(<MaintenanceConfirmationBanner operation={operation()} onCancel={vi.fn()} onConfirm={confirm} onRetryVerification={retry} />);
  expect(within(screen.getByRole("region", { name: "执行结果" })).getByText("执行结果：npm 缓存已清理")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "快照核对" })).getByText("最新快照读取失败")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "清理缓存" })).toBeNull();
});

it.each(["executing", "verifying"] as const)("prevents dismissal during %s, including Escape", async (phase) => {
  const cancel = vi.fn();
  render(<MaintenanceConfirmationBanner operation={operation({ phase, ...(phase === "executing" ? { execution: null, verification: { status: "notStarted", message: null } } : { verification: { status: "reading", message: null } }) })} onCancel={cancel} onConfirm={vi.fn()} onRetryVerification={vi.fn()} />);
  await userEvent.keyboard("{Escape}");
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  if (phase === "verifying") expect(screen.getByText("执行结果：npm 缓存已清理")).toBeTruthy();
});

it("removes confirmation actions when its frozen target is invalidated", () => {
  render(<MaintenanceConfirmationBanner operation={operation({ phase: "invalidated", execution: null, verification: { status: "notStarted", message: null }, invalidation: "目标快照已变化，请关闭后重新确认。" })} onCancel={vi.fn()} onConfirm={vi.fn()} onRetryVerification={vi.fn()} />);
  expect(screen.getByText("目标快照已变化，请关闭后重新确认。")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "清理缓存" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "关闭" }).length).toBeGreaterThan(0);
});


it("gives keyboard users access to the frozen cleanup preview", () => {
  render(<MaintenanceConfirmationBanner operation={operation({ request: { kind: "cleanupCache", managerId: "Homebrew" }, phase: "confirming", execution: null, verification: { status: "notStarted", message: null }, reclaimDetails: "Would remove: /fixture/Cellar/example/old" })} onCancel={vi.fn()} onConfirm={vi.fn()} onRetryVerification={vi.fn()} />);
  const preview = screen.getByRole("region", { name: "清理预演明细" });
  expect(preview.textContent).toContain("/fixture/Cellar/example/old");
  expect(document.activeElement).toBe(preview);
});
