import type {
  AsyncStatus,
  DisplayStatus,
  HomebrewFilter,
  ManagerId,
  MavenFilter,
  PackageKind,
  PackageSignal,
  PathKind,
  PipEnvironmentHealth,
  PipFilter,
} from "./types";

export const managerOrder: ManagerId[] = ["Npm", "Pnpm", "Yarn", "Homebrew", "Maven", "Pip", "Cargo"];

export const managerLabels: Record<ManagerId, string> = {
  Npm: "npm",
  Pnpm: "pnpm",
  Yarn: "Yarn",
  Homebrew: "Homebrew",
  Maven: "Maven",
  Pip: "pip",
  Cargo: "Cargo",
};

export const statusLabels: Record<DisplayStatus, string> = {
  Ready: "就绪",
  Missing: "未安装",
  Unsupported: "不支持",
  Partial: "部分可用",
  Failed: "失败",
  Pending: "等待中",
  PermissionDenied: "无权限",
  Error: "错误",
  Scanning: "扫描中",
  "Not scanned": "未扫描",
  neutral: "未扫描",
};

export const pathKindLabels: Record<PathKind, string> = {
  Cache: "缓存",
  NpxCache: "npx 缓存",
  Store: "存储",
  GlobalModules: "全局模块",
  GlobalDir: "全局目录",
  CargoBin: "Cargo 二进制目录",
  CargoRegistryCache: "Cargo registry 缓存",
  CargoRegistrySource: "Cargo registry 源码",
  CargoGitCache: "Cargo git 缓存",
  CargoGitCheckouts: "Cargo git checkouts",
  Prefix: "安装前缀",
  Cellar: "软件目录",
  Caskroom: "应用目录",
  LocalRepository: "本地仓库",
  SitePackages: "站点包目录",
  UserSite: "用户站点包目录",
};

export const packageKindLabels: Record<PackageKind, string> = {
  Generic: "通用",
  Formula: "配方包",
  Cask: "应用包",
  MavenArtifact: "Maven 构件",
  PythonDistribution: "Python 包",
};

export const signalLabels: Record<PackageSignal, string> = {
  Outdated: "可更新",
  Leaf: "叶子包",
  DuplicateVersions: "多版本",
  Snapshot: "快照版",
  Editable: "可编辑安装",
  UserSite: "用户目录",
  DirectUrl: "直接链接",
};

export const homebrewFilterLabels: Record<HomebrewFilter, string> = {
  All: "全部",
  Formulae: "配方包",
  Casks: "应用包",
  Outdated: "可更新",
  Leaves: "叶子包",
};

export const mavenFilterLabels: Record<MavenFilter, string> = {
  All: "全部",
  Duplicates: "多版本",
  Snapshots: "快照版",
};

export const pipFilterLabels: Record<PipFilter, string> = {
  All: "全部",
  Outdated: "可更新",
  Editable: "可编辑安装",
  UserSite: "用户目录",
  DirectUrl: "直接链接",
};

export const environmentKindLabels: Record<PipEnvironmentHealth["environmentKind"], string> = {
  System: "系统环境",
  User: "用户环境",
  VirtualEnv: "虚拟环境",
  Unknown: "未知环境",
};

export const asyncStatusLabels: Record<AsyncStatus, string> = {
  Pending: "等待中",
  Ready: "就绪",
  Failed: "失败",
};
