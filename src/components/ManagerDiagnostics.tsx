import type { CommandEnvelope, CommandFailure, ManagerSnapshot } from "../types";
import type { ManagerScanState } from "../managerScanning";
import { formatHomePathsInText } from "../utils/format";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

const failureHelp: Record<CommandFailure["kind"], string> = {
  MissingBinary: "未安装或应用 PATH 不可见；可在终端检查命令来源后重新扫描。",
  MissingPath: "路径不存在；请检查管理器是否已初始化或目录是否已移动。",
  CommandFailed: "命令返回失败；展开输出查看具体原因。",
  ParseFailure: "命令输出无法识别；检查管理器版本和原始输出。",
  PermissionDenied: "应用没有读取或执行权限；请检查系统权限后重试。",
  Timeout: "命令超时；可能与网络或管理器响应有关，已读取的清单仍保留。",
};

export function commandForCopy(command: CommandEnvelope) {
  return [command.program, ...command.args].map((value) => /^[a-zA-Z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`).join(" ");
}

export function ManagerDiagnostics({ manager, state, busy, homeDirectory, onRefresh, onCopy }: {
  manager: ManagerSnapshot | null;
  state?: ManagerScanState;
  busy: boolean;
  homeDirectory: string | null;
  onRefresh: () => void;
  onCopy: (value: string) => void;
}) {
  const failures = [...(state?.failures ?? manager?.failures ?? [])];
  if (manager?.homebrew?.cleanup.failure) failures.push(manager.homebrew.cleanup.failure);
  if (manager?.pip?.outdatedFailure) failures.push(manager.pip.outdatedFailure);
  const text = (value: string) => formatHomePathsInText(value, homeDirectory);
  const failedPaths = manager?.paths.filter((path) => ["Error", "Missing", "PermissionDenied"].includes(path.size.status) || path.size.skipped > 0) ?? [];
  return <Card>
    <CardHeader><CardTitle>扫描诊断</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">
      {state?.error ? <Alert><AlertTitle>最近扫描有异常</AlertTitle><AlertDescription>{text(state.error)}{state.scannedAt ? ` · 当前数据显示自 ${new Date(state.scannedAt).toLocaleString()}` : ""}</AlertDescription></Alert> : null}
      <details>
        <summary className="cursor-pointer text-sm">查看环境、命令与失败步骤（{failures.length}）</summary>
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {manager?.pip ? <p className="break-all">Python 解释器：{text(manager.pip.pythonExecutable)}</p> : null}
          {manager?.paths.map((path) => <p className="break-all" key={`${path.kind}:${path.path}`}>{path.label}：{text(path.path)}</p>)}
          {state?.diagnostics ? <>
            <p className="text-muted-foreground">以下是应用环境中的命令解析结果，可能与终端 shell 配置不同。</p>
            {state.diagnostics.executables.map((entry) => <p className="break-all" key={entry.program}>{entry.program} → {entry.resolvedPath ? text(entry.resolvedPath) : "未找到可执行文件"}</p>)}
            <p>应用 PATH</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">{text(state.diagnostics.pathEntries.join("\n"))}</pre>
          </> : <p className="text-muted-foreground">完成一次扫描后显示应用环境。</p>}
          {failures.map((failure, index) => <Alert key={index}>
            <AlertTitle>{failureHelp[failure.kind]}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>{text(failure.message)}</p>
              {failure.command ? <p className="break-all">{text(commandForCopy(failure.command))} · 超时 {failure.command.timeoutMs / 1000} 秒</p> : null}
              {failure.command ? <Button type="button" size="sm" variant="outline" onClick={() => onCopy(commandForCopy(failure.command!))}>复制失败步骤命令</Button> : null}
              {failure.stdout || failure.stderr ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{text([failure.stdout, failure.stderr].filter(Boolean).join("\n"))}</pre> : null}
            </AlertDescription>
          </Alert>)}
          {manager?.commands.map((command, index) => <div className="flex flex-wrap items-center gap-2" key={index}><code className="min-w-0 flex-1 break-all text-xs">{text(commandForCopy(command))}</code><Button type="button" size="sm" variant="outline" onClick={() => onCopy(commandForCopy(command))}>复制检查命令</Button></div>)}
        </div>
      </details>
      {failedPaths.map((path) => <p className="break-all text-xs text-muted-foreground" key={path.path}>{path.label}：{text(path.size.message ?? "路径缺失或读取不完整")}</p>)}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onRefresh} type="button" size="sm" variant="outline">重新扫描管理器</Button>
        {failedPaths.length ? <Button disabled={busy} onClick={onRefresh} type="button" size="sm" variant="outline">重试目录测量</Button> : null}
        {manager?.homebrew?.cleanup.status === "Failed" ? <Button disabled={busy} onClick={onRefresh} type="button" size="sm" variant="outline">重试 Homebrew 预演</Button> : null}
        {manager?.pip?.outdatedStatus === "Failed" ? <Button disabled={busy} onClick={onRefresh} type="button" size="sm" variant="outline">重试 pip 更新检查</Button> : null}
      </div>
    </CardContent>
  </Card>;
}
