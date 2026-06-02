import { failureKindLabels } from "../constants";
import type { ManagerSnapshot } from "../types";
import { displayMessage, trimTail } from "../utils/format";
import { EmptyState, Panel, PanelHead, StatusBadge } from "./ui";
import { Card, CardContent } from "../../components/ui/card";

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
      <div className="flex flex-col gap-3 p-4">
        {!manager ? (
          <EmptyState message={scanning ? "正在扫描诊断..." : "尚未扫描"} />
        ) : manager.failures.length ? (
          manager.failures.map((failure, index) => (
            <Card size="sm" key={`${failure.kind}-${failure.message}-${index}`}>
              <CardContent>
              <div className="flex items-start gap-2">
                <StatusBadge status="Failed" />
                <span className="min-w-0 text-sm font-medium">
                  {failureKindLabels[failure.kind]}：{displayMessage(failure.message)}
                </span>
              </div>
              {failure.command ? <code className="mt-3 block truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{failure.command.preview}</code> : null}
              {failure.stderr ? <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-foreground p-3 text-xs leading-5 text-background">{trimTail(failure.stderr)}</pre> : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState message="没有失败记录" />
        )}
      </div>
    </Panel>
  );
}
