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
}: {
  children: React.ReactNode;
  onRefresh: () => void;
  scanMeta: string;
  scanning: boolean;
  selectedManager: ManagerId;
}) {
  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-7">
      <header className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <h1 className="text-[28px] font-medium leading-9 sm:text-3xl">包管理器控制中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            查看 npm、pnpm、Yarn Classic、Homebrew、Maven、pip 和 Cargo 的本机包、缓存/仓库位置和维护信号。所有危险操作只复制命令，不直接执行。
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <Button
            disabled={scanning}
            onClick={onRefresh}
            size="lg"
            type="button"
          >
            <RefreshCw className={scanning ? "animate-spin" : undefined} data-icon="inline-start" />
            {scanning ? `正在扫描 ${managerLabel(selectedManager)}...` : `刷新 ${managerLabel(selectedManager)}`}
          </Button>
          <div className="min-h-5 text-left text-xs text-muted-foreground lg:text-right">{scanMeta}</div>
        </div>
      </header>
      {children}
    </div>
  );
}
