import { Activity, Hammer, List, RefreshCw, Settings } from "lucide-react";
import { Button } from "../../components/ui/button";
import { managerLabel } from "../utils/format";
import type { ManagerId } from "../types";

export function Shell({
  children,
  activeView,
  onRefresh,
  onShowHealth,
  onShowBuildArtifacts,
  onShowManagers,
  onShowSettings,
  scanMeta,
  scanning,
  selectedManager,
  totalBytes,
}: {
  children: React.ReactNode;
  activeView: "health" | "managers" | "artifacts" | "settings";
  onRefresh: () => void;
  onShowHealth: () => void;
  onShowBuildArtifacts: () => void;
  onShowManagers: () => void;
  onShowSettings: () => void;
  scanMeta: string;
  scanning: boolean;
  selectedManager: ManagerId;
  totalBytes: string;
}) {
  return (
    <div className="min-h-screen bg-background p-7 text-foreground">
      <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5">
        <div className="min-w-0">
          <h1 className="text-3xl font-medium leading-9">开发环境控制中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            查看本机开发工具链的资产、空间占用和风险信号。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1 rounded-2xl bg-muted p-1">
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
                onClick={onShowBuildArtifacts}
                size="sm"
                type="button"
                variant={activeView === "artifacts" ? "secondary" : "ghost"}
              >
                <Hammer data-icon="inline-start" />
                构建产物
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
            {activeView === "artifacts" ? null : (
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
          <div className="min-h-5 text-right text-xs text-muted-foreground">{activeView === "artifacts" ? "" : scanMeta}</div>
        </div>
      </header>
      {children}
    </div>
  );
}
