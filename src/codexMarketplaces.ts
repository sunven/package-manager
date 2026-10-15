export type CodexMarketplace = {
  id: string;
  name: string;
  root: string;
  sourceKind: string | null;
  source: string | null;
  readOnlyReason: string | null;
  refName: string | null;
  sparsePaths: string[];
};

export type CodexMarketplaceScan = {
  snapshotId: string | null;
  directory: string;
  configPath: string;
  status: "Ready" | "MissingCli" | "Incompatible" | "Failed";
  marketplaces: CodexMarketplace[];
  message: string | null;
  configError: string | null;
};

export type CodexMarketplaceRequest = {
  snapshotId: string;
  operation: "Add" | "Refresh" | "Remove";
  marketplaceId?: string;
  sourceKind?: "git" | "local";
  source?: string;
  refName?: string;
  sparsePaths?: string[];
};

export type CodexMarketplaceResult = {
  status: "Succeeded" | "AlreadyExists" | "Partial" | "Conflict" | "Failed";
  message: string;
  executed: boolean;
};

export function marketplaceSourceLabel(kind: string | null) {
  return kind === "git" ? "Git 仓库" : kind === "local" ? "本地目录" : "未知";
}
