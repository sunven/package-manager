import { failureKindLabels } from "../constants";
import type { ManagerSnapshot } from "../types";
import { displayMessage, trimTail } from "../utils/format";
import { EmptyState, Panel, PanelHead, StatusBadge } from "./ui";

export function FailurePanel({
  manager,
  scanning,
}: {
  manager: ManagerSnapshot | null;
  scanning: boolean;
}) {
  return (
    <Panel>
      <PanelHead eyebrow="诊断" title="失败记录" />
      <div className="space-y-3 p-4">
        {!manager ? (
          <EmptyState message={scanning ? "正在扫描诊断..." : "尚未扫描"} />
        ) : manager.failures.length ? (
          manager.failures.map((failure, index) => (
            <article className="rounded-lg border border-slate-200 bg-white p-3" key={`${failure.kind}-${failure.message}-${index}`}>
              <div className="flex items-start gap-2">
                <StatusBadge status="Failed" />
                <span className="min-w-0 text-sm font-medium text-slate-700">
                  {failureKindLabels[failure.kind]}：{displayMessage(failure.message)}
                </span>
              </div>
              {failure.command ? <code className="mt-3 block overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{failure.command.preview}</code> : null}
              {failure.stderr ? <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{trimTail(failure.stderr)}</pre> : null}
            </article>
          ))
        ) : (
          <EmptyState message="没有失败记录" />
        )}
      </div>
    </Panel>
  );
}
