import { RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { managerLabel } from "../utils/format";
import type { ManagerId } from "../types";

export function Shell({
  children,
  onRefresh,
  scanMeta,
  scanning,
  selectedManager,
  totalBytes,
}: {
  children: React.ReactNode;
  onRefresh: () => void;
  scanMeta: string;
  scanning: boolean;
  selectedManager: ManagerId;
  totalBytes: string;
}) {
  return (
    <div className="min-h-screen bg-background p-7 text-foreground">
      <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5">
        <div className="min-w-0">
          <h1 className="text-3xl font-medium leading-9">包管理器控制中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            查看 npm、pnpm、Yarn Classic、nvm、Homebrew、Maven、pip 和 Cargo 的本机包、缓存/仓库位置和维护信号。所有危险操作只复制命令，不直接执行。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center justify-end gap-2">
            <div className="min-w-36 text-right">
              <div className="text-xs font-medium text-muted-foreground">总占用</div>
              <div className="text-xl font-medium leading-6 tabular-nums">{totalBytes}</div>
            </div>
            <Button
              disabled={scanning}
              onClick={onRefresh}
              size="lg"
              type="button"
            >
              <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
              {scanning ? `正在扫描 ${managerLabel(selectedManager)}...` : `刷新 ${managerLabel(selectedManager)}`}
            </Button>
          </div>
          <div className="min-h-5 text-right text-xs text-muted-foreground">{scanMeta}</div>
        </div>
      </header>
      {children}
    </div>
  );
}
