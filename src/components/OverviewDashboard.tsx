import type { DevelopmentHealthSummary } from "../developmentHealth";
import type { MaintenanceRequest } from "../state";
import type { ManagerId, ManagerSnapshot } from "../types";

export function OverviewDashboard(_props: {
  enabledManagers: ManagerId[];
  health: DevelopmentHealthSummary;
  homeDirectory: string | null;
  managerSnapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  menuOpenIndex: number | null;
  onCopyCommand: (payload: string) => void;
  onCopyPackage: (index: number) => void;
  onCopyPackageAction: (index: number, actionIndex: number) => void;
  onCopyPath: (path: string) => void;
  onOpenManager: (managerId: ManagerId) => void;
  onOpenPackage: (index: number) => void;
  onOpenPath: (path: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onRequestPackageUninstall: (index: number) => void;
  onSelectManager: (managerId: ManagerId) => void;
  onSelectPackage: (index: number) => void;
  onShowManagers: () => void;
  onToggleActions: (index: number) => void;
  pendingMaintenance: MaintenanceRequest | null;
  query: string;
  scanningManagers: Set<ManagerId>;
  selectedManager: ManagerId;
  selectedPackageIndex: number | null;
}) {
  return null;
}

export function ManagerMark({ id }: { id: ManagerId }) {
  return (
    <span aria-hidden="true" className="studio-mark" data-manager={id}>
      {markGlyph[id]}
    </span>
  );
}

const markGlyph: Record<ManagerId, string> = {
  Npm: "n",
  Pnpm: "pn",
  Yarn: "y",
  Nvm: "nv",
  Homebrew: "b",
  Maven: "m",
  Pip: "py",
  Cargo: "c",
  Docker: "d",
  Bun: "bu",
  Uv: "uv",
  Fvm: "fv",
};
