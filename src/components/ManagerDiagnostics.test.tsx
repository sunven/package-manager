// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandForCopy, ManagerDiagnostics } from "./ManagerDiagnostics";
import { managerFixture } from "../test/fixtures";

afterEach(cleanup);

describe("read-only diagnostics", () => {
  it("shows PATH context, failure details and structured retry actions", () => {
    const retry = vi.fn();
    const copy = vi.fn();
    const command = { program: "python3", args: ["--version"], preview: "python3 --version", timeoutMs: 5000 };
    const manager = managerFixture("Pip", {
      commands: [command], failures: [{ kind: "MissingBinary", message: "not found", command, stdout: "", stderr: "ENOENT" }],
      paths: [{ kind: "Cache", label: "缓存", path: "/missing", size: { status: "PermissionDenied", bytes: null, human: null, files: 0, directories: 0, skipped: 0, message: "no permission" } }],
    });
    render(<ManagerDiagnostics manager={manager} state={{ phase: "idle", error: "not found", scannedAt: null, diagnostics: { pathEntries: ["/usr/bin"], executables: [{ program: "python3", resolvedPath: null }] } }} homeDirectory={null} busy={false} onRefresh={vi.fn()} onRetry={retry} onCopy={copy} />);
    fireEvent.click(screen.getByText(/查看环境、命令与失败步骤/));
    expect(screen.getByText(/未安装或应用 PATH 不可见/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试目录测量" }));
    expect(retry).toHaveBeenCalledWith("paths");
    fireEvent.click(screen.getByRole("button", { name: "复制检查命令" }));
    expect(copy).toHaveBeenCalledWith("python3 --version");
  });

  it("quotes paths with spaces and shell metacharacters in copied commands", () => {
    expect(commandForCopy({ program: "/path with spaces/python", args: ["-m", "pip", "show", "$(example)"], preview: "", timeoutMs: 1 })).toBe("'/path with spaces/python' -m pip show '$(example)'");
  });
});
