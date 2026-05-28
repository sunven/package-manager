import { RefreshCw } from "lucide-react";
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
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-7">
      <header className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-9 text-slate-950 sm:text-3xl">包管理器控制中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            查看 npm、pnpm、Yarn Classic、Homebrew、Maven 和 pip 的本机包、缓存/仓库位置和维护信号。所有危险操作只复制命令，不直接执行。
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-teal-700 bg-teal-700 px-4 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={scanning}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw className={scanning ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {scanning ? `正在扫描 ${managerLabel(selectedManager)}...` : `刷新 ${managerLabel(selectedManager)}`}
          </button>
          <div className="min-h-5 text-left text-xs text-slate-500 lg:text-right">{scanMeta}</div>
        </div>
      </header>
      {children}
    </div>
  );
}
