// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AppUpdateToast } from "./AppUpdateToast";

afterEach(cleanup);

it("shows the available version and forwards close and view actions", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onView = vi.fn();
  render(<AppUpdateToast onClose={onClose} onView={onView} version="0.1.2" />);

  expect(screen.getByText("发现新版本")).toBeTruthy();
  expect(screen.getByText("版本 0.1.2 已可用。")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "关闭更新提示" }));
  expect(onClose).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "查看更新" }));
  expect(onView).toHaveBeenCalledOnce();
});
