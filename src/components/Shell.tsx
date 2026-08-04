import { Activity, List, RefreshCw, Settings, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { managerLabel } from "../utils/format";
import type { ManagerId } from "../types";

export function Shell({
  children,
  activeView,
  onRefresh,
  onShowHealth,
  onShowProjectCleanup,
  onShowManagers,
  onShowSettings,
  scanMeta,
  scanning,
  selectedManager,
  totalBytes,
}: {
  children: React.ReactNode;
  activeView: "health" | "managers" | "cleanup" | "settings";
  onRefresh: () => void;
  onShowHealth: () => void;
  onShowProjectCleanup: () => void;
  onShowManagers: () => void;
  onShowSettings: () => void;
  scanMeta: string;
  scanning: boolean;
  selectedManager: ManagerId;
  totalBytes: string;
}) {
  return (
    <div className="min-h-screen bg-background p-7 text-foreground">
      <header className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <h1 className="text-3xl font-medium leading-9">开发环境控制中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            查看本机开发工具链的资产、空间占用和风险信号。
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:items-end">
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:flex sm:items-center">
              <Button
                onClick={onShowHealth}
                size="sm"
                type="button"
                variant={activeView === "health" ? "secondary" : "ghost"}
              >
                <Activity data-icon="inline-start" />
                体检
              </Button>
              <Button
                onClick={onShowManagers}
                size="sm"
                type="button"
                variant={activeView === "managers" ? "secondary" : "ghost"}
              >
                <List data-icon="inline-start" />
                包管理器
              </Button>
              <Button
                onClick={onShowProjectCleanup}
                size="sm"
                type="button"
                variant={activeView === "cleanup" ? "secondary" : "ghost"}
              >
                <Trash2 data-icon="inline-start" />
                项目清理
              </Button>
              <Button
                onClick={onShowSettings}
                size="sm"
                type="button"
                variant={activeView === "settings" ? "secondary" : "ghost"}
              >
                <Settings data-icon="inline-start" />
                设置
              </Button>
            </div>
            {activeView === "cleanup" ? null : (
              <>
                <div className="flex h-9 min-w-36 flex-col justify-center text-right">
                  <div className="text-xs font-medium leading-4 text-muted-foreground">总占用</div>
                  <div className="text-xl font-medium leading-5 tabular-nums">{totalBytes}</div>
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
              </>
            )}
          </div>
          <div className="min-h-5 text-xs text-muted-foreground xl:text-right">{activeView === "cleanup" ? "" : scanMeta}</div>
        </div>
      </header>
      {children}
    </div>
  );
}
