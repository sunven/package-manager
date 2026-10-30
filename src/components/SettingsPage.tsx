import { managerLabels, managerOrder } from "../constants";
import type { DisplayStatus, ManagerId, ManagerSnapshot } from "../types";
import { Checkbox } from "../../components/ui/checkbox";
import { AppUpdatePanel, type AppUpdatePanelProps } from "./AppUpdatePanel";
import { PageHeader, Panel, PanelHead, StatusBadge } from "./ui";

export function SettingsPage({
  appUpdate,
  enabledManagers,
  lockedManager,
  managerSnapshots,
  onSetManagerEnabled,
  scanningManagers,
}: {
  appUpdate: AppUpdatePanelProps;
  enabledManagers: ManagerId[];
  lockedManager?: ManagerId | null;
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  onSetManagerEnabled: (managerId: ManagerId, enabled: boolean) => void;
  scanningManagers: Set<ManagerId>;
}) {
  const enabledSet = new Set(enabledManagers);

  return (
    <main className="view-grid">
      <PageHeader
        title="设置"
        description="选择要显示和扫描的包管理器，不会安装或卸载它们。至少保留一个已启用管理器。"
      />
      <p className="sr-only" id="manager-settings-help">选择要显示和扫描的包管理器，不会安装或卸载它们。至少保留一个已启用管理器。</p>
      <Panel className="overflow-hidden">
        <PanelHead
          action={
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              已启用 {enabledManagers.length} / {managerOrder.length}
            </span>
          }
          title="启用的包管理器"
        />
        <div className="grid grid-cols-1 gap-px bg-border min-[720px]:grid-cols-2 min-[1100px]:grid-cols-3">
          {managerOrder.map((managerId) => {
            const enabled = enabledSet.has(managerId);
            const locked = managerId === lockedManager || (enabled && enabledManagers.length === 1);
            const manager = managerSnapshots[managerId];
            const status: DisplayStatus = scanningManagers.has(managerId) ? "Scanning" : manager?.status ?? "Not scanned";
            const version = manager?.version ?? null;

            return (
              <label
                className={`grid min-h-10 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-card px-4 py-3 transition-colors ${
                  locked ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/60"
                }`}
                key={managerId}
              >
                <span className="grid min-w-0 gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{managerLabels[managerId]}</span>
                    <StatusBadge className="shrink-0" status={status} />
                  </span>
                  {version ? <span className="truncate text-xs text-muted-foreground">{version}</span> : null}
                </span>
                <Checkbox
                  aria-describedby="manager-settings-help"
                  aria-label={`启用 ${managerLabels[managerId]}`}
                  checked={enabled}
                  disabled={locked}
                  onCheckedChange={(checked) => onSetManagerEnabled(managerId, checked === true)}
                />
              </label>
            );
          })}
        </div>
      </Panel>
      <Panel>
        <PanelHead title="扫描与留存" />
        <div className="grid gap-3 p-4">
          <dl className="fact-list fact-list--columns">
            <div className="fact-row"><dt>扫描方式</dt><dd>按需扫描，不做后台自动刷新</dd></div>
            <div className="fact-row"><dt>启动时</dt><dd>仅扫描首个已启用管理器</dd></div>
            <div className="fact-row"><dt>历史快照</dt><dd>每个管理器保留最近 20 份</dd></div>
            <div className="fact-row"><dt>维护记录</dt><dd>保留最近 500 条已关闭记录</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">切换启用状态后，进入对应管理器或手动刷新即可读取；历史只读，不构成撤销或维护授权。</p>
        </div>
      </Panel>
      <AppUpdatePanel {...appUpdate} />
    </main>
  );
}
