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

export const managerOrder: ManagerId[] = ["Npm", "Pnpm", "Yarn", "Nvm", "Homebrew", "Maven", "Pip", "Cargo", "Docker", "Bun", "Uv"];

export const managerLabels: Record<ManagerId, string> = {
  Npm: "npm",
  Pnpm: "pnpm",
  Yarn: "Yarn",
  Nvm: "nvm",
  Homebrew: "Homebrew",
  Maven: "Maven",
  Pip: "pip",
  Cargo: "Cargo",
  Docker: "Docker",
  Bun: "Bun",
  Uv: "uv",
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
  NvmDir: "nvm 目录",
  NvmNodeVersions: "nvm Node 版本目录",
  CargoBin: "Cargo 二进制目录",
  CargoRegistryCache: "Cargo registry 缓存",
  CargoRegistrySource: "Cargo registry 源码",
  CargoGitCache: "Cargo git 缓存",
  CargoGitCheckouts: "Cargo git checkouts",
  DockerConfig: "Docker 配置",
  DockerBuildx: "Docker buildx 缓存",
  DockerDesktopData: "Docker Desktop 数据",
  BunInstall: "Bun 安装目录",
  BunCache: "Bun 缓存",
  UvTools: "uv 工具目录",
  UvPythonInstallations: "uv Python 目录",
  UvCache: "uv 缓存",
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
  DockerImage: "Docker 镜像",
  DockerContainer: "Docker 容器",
  DockerVolume: "Docker 卷",
  BunPackage: "Bun 全局包",
  UvTool: "uv 工具",
  UvPython: "uv Python",
};

export const signalLabels: Record<PackageSignal, string> = {
  Current: "当前版本",
  Outdated: "可更新",
  Leaf: "叶子包",
  DuplicateVersions: "多版本",
  Snapshot: "快照版",
  Editable: "可编辑安装",
  UserSite: "用户目录",
  DirectUrl: "直接链接",
  Dangling: "悬空",
  Unused: "未使用",
  Running: "运行中",
  Stopped: "已停止",
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
