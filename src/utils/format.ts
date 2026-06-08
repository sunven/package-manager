import { managerLabels } from "../constants";
import type { CommandEnvelope, DiskUsage, ManagerId, PathKind } from "../types";

export function managerLabel(managerId: ManagerId) {
  return managerLabels[managerId];
}

export function pathLabel(label: string) {
  const pathLabels: Record<string, string> = {
    Cache: "缓存",
    "Cache folder": "缓存文件夹",
    "npx cache": "npx 缓存",
    Store: "存储",
    "Global modules": "全局模块",
    "Global dir": "全局目录",
    "NVM dir": "nvm 目录",
    "Node versions": "Node 版本目录",
    "Cargo bin": "Cargo 二进制目录",
    "Cargo registry cache": "Cargo registry 缓存",
    "Cargo registry source": "Cargo registry 源码",
    "Cargo git cache": "Cargo git 缓存",
    "Cargo git checkouts": "Cargo git checkouts",
    "Docker config": "Docker 配置",
    "Docker buildx": "Docker buildx 缓存",
    "Docker Desktop data": "Docker Desktop 数据",
    "Bun install": "Bun 安装目录",
    "Bun cache": "Bun 缓存",
    "uv tools": "uv 工具目录",
    "uv Python installations": "uv Python 目录",
    "uv cache": "uv 缓存",
    Prefix: "安装前缀",
    Cellar: "软件目录",
    Caskroom: "应用目录",
    "Local repository": "本地仓库",
    "pip cache": "pip 缓存",
    "site-packages": "site-packages",
    "User site": "用户 site-packages",
  };
  return pathLabels[label] ?? label;
}

export function displayMessage(message: string) {
  return message
    .replace("Yarn 2+ does not expose a global package list equivalent to npm, pnpm, or Yarn Classic.", "Yarn 2+ 没有提供等同于 npm、pnpm 或 Yarn Classic 的全局软件包列表。")
    .replace("Outdated scan pending", "可更新包扫描等待中")
    .replace("Cleanup dry-run pending", "清理预演等待中")
    .replace("Size scan pending", "占用扫描等待中")
    .replace("Path does not exist", "路径不存在")
    .replace("Repository scan reached time limit", "仓库扫描已达到时间限制")
    .replace("Repository scan reached version directory limit", "仓库扫描已达到版本目录数量限制")
    .replace("Repository scan reached row limit", "仓库扫描已达到结果数量限制")
    .replace("Package manager scan failed:", "包管理器扫描失败：")
    .replace("Size scan failed:", "占用扫描失败：")
    .replace("Homebrew cleanup dry-run failed:", "Homebrew 清理预演失败：")
    .replace("pip outdated hydration failed:", "pip 可更新包扫描失败：")
    .replace("npm version probe failed", "npm 版本检测失败")
    .replace("npm global package list failed", "npm 全局软件包列表获取失败")
    .replace("pnpm version probe failed", "pnpm 版本检测失败")
    .replace("pnpm global package list failed", "pnpm 全局软件包列表获取失败")
    .replace("Yarn version probe failed", "Yarn 版本检测失败")
    .replace("Yarn global package list failed", "Yarn 全局软件包列表获取失败")
    .replace("nvm directory was not found at", "未找到 nvm 目录：")
    .replace("Maven version probe failed", "Maven 版本检测失败")
    .replace("Python version probe failed", "Python 版本检测失败")
    .replace("Python executable probe failed", "Python 可执行文件检测失败")
    .replace("pip version probe failed", "pip 版本检测失败")
    .replace("pip package list failed", "pip 软件包列表获取失败")
    .replace("pip cache dir failed", "pip 缓存目录获取失败")
    .replace("pip cache info failed", "pip 缓存信息获取失败")
    .replace("pip inspect failed", "pip 检查失败")
    .replace("pip outdated failed", "pip 可更新包扫描失败")
    .replace("Cargo version probe failed", "Cargo 版本检测失败")
    .replace("Cargo installed binary crate list failed", "Cargo 已安装二进制 crate 列表获取失败")
    .replace("Docker version probe failed", "Docker 版本检测失败")
    .replace("Docker image list failed", "Docker 镜像列表获取失败")
    .replace("Docker container list failed", "Docker 容器列表获取失败")
    .replace("Docker volume list failed", "Docker 卷列表获取失败")
    .replace("Docker disk usage failed", "Docker 磁盘占用获取失败")
    .replace("Bun version probe failed", "Bun 版本检测失败")
    .replace("Bun cache lookup failed", "Bun 缓存目录查询失败")
    .replace("Bun global bin lookup failed", "Bun 全局 bin 查询失败")
    .replace("Bun global package list failed", "Bun 全局包列表获取失败")
    .replace("uv version probe failed", "uv 版本检测失败")
    .replace("uv tool dir lookup failed", "uv 工具目录查询失败")
    .replace("uv python dir lookup failed", "uv Python 目录查询失败")
    .replace("uv cache dir lookup failed", "uv 缓存目录查询失败")
    .replace("uv tool list failed", "uv 工具列表获取失败")
    .replace("uv Python list failed", "uv Python 列表获取失败")
    .replace("Homebrew version probe failed", "Homebrew 版本检测失败")
    .replace("Homebrew formula list failed", "Homebrew 配方包列表获取失败")
    .replace("Homebrew cask list failed", "Homebrew 应用包列表获取失败")
    .replace("Homebrew outdated scan failed", "Homebrew 可更新包扫描失败")
    .replace("Homebrew leaves scan failed", "Homebrew 叶子包扫描失败")
    .replace("Homebrew prefix lookup failed", "Homebrew 安装前缀查询失败")
    .replace("Homebrew cache lookup failed", "Homebrew 缓存查询失败")
    .replace("Homebrew cellar lookup failed", "Homebrew 软件目录查询失败")
    .replace("Homebrew cleanup dry-run failed", "Homebrew 清理预演失败")
    .replace("Could not parse Yarn version:", "无法解析 Yarn 版本：")
    .replace("Could not read output from", "无法读取命令输出：")
    .replace("exceeded the configured timeout", "超过配置的超时时间")
    .replace("Could not wait for", "无法等待命令完成：")
    .replace("is not installed or is not on PATH", "未安装，或不在 PATH 中")
    .replace("python3 and python are not installed or are not on PATH", "python3 和 python 均未安装，或不在 PATH 中")
    .replace("Permission denied while running", "运行命令时权限被拒绝：")
    .replace("Could not run", "无法运行命令：");
}

export function countedSizePath(kind: PathKind) {
  return (
    kind === "Cache" ||
    kind === "Store" ||
    kind === "Cellar" ||
    kind === "Caskroom" ||
    kind === "LocalRepository" ||
    kind === "NvmDir" ||
    kind === "CargoRegistryCache" ||
    kind === "CargoRegistrySource" ||
    kind === "CargoGitCache" ||
    kind === "CargoGitCheckouts" ||
    kind === "DockerConfig" ||
    kind === "DockerBuildx" ||
    kind === "DockerDesktopData" ||
    kind === "BunInstall" ||
    kind === "BunCache" ||
    kind === "UvTools" ||
    kind === "UvPythonInstallations" ||
    kind === "UvCache"
  );
}

export function actionLabel(action: CommandEnvelope) {
  const [firstArg, secondArg] = action.args;
  const command = action.args.join(" ");
  if (command.includes("dependency:get")) return "复制获取依赖命令";
  if (command.includes("dependency:tree")) return "复制依赖树命令";
  if (command.includes("pip show")) return "复制查看命令";
  if (command.includes("pip install --upgrade")) return "复制升级命令";
  if (command.includes("pip uninstall")) return "复制卸载命令";
  if (command.includes("cargo install")) return "复制安装命令";
  if (command.includes("cargo uninstall")) return "复制卸载命令";
  if (command.includes("image inspect")) return "复制镜像详情命令";
  if (command.includes("image rm")) return "复制删除镜像命令";
  if (command.includes("container inspect")) return "复制容器详情命令";
  if (command.includes("container rm")) return "复制删除容器命令";
  if (command.includes("volume inspect")) return "复制卷详情命令";
  if (command.includes("volume rm")) return "复制删除卷命令";
  if (command.includes("pm view")) return "复制查看命令";
  if (command.includes("remove --global")) return "复制移除全局包命令";
  if (command.includes("pm cache rm")) return "复制清理缓存命令";
  if (command.includes("tool run")) return "复制运行工具命令";
  if (command.includes("tool uninstall")) return "复制卸载工具命令";
  if (command.includes("python install")) return "复制安装 Python 命令";
  if (command.includes("cache prune")) return "复制缓存精简命令";
  if (command.includes("cache clean")) return "复制清空缓存命令";
  if (command.includes("nvm use")) return "复制切换版本命令";
  if (firstArg === "upgrade" && secondArg === "--cask") return "复制应用包升级命令";
  if (firstArg === "upgrade") return "复制升级命令";
  if (firstArg === "uses") return "复制反向依赖命令";
  if (firstArg === "info") return "复制信息命令";
  return "复制命令";
}

export function shorten(value: string) {
  const parts = value.split("/");
  if (parts.length <= 4) return value;
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}

export function formatHomePath(value: string, homeDirectory: string | null) {
  const home = normalizeHomeDirectory(homeDirectory);
  if (!home) return value;
  if (value === home) return "~";
  if (value.startsWith(`${home}/`)) return `~${value.slice(home.length)}`;
  return value;
}

export function formatHomePathsInText(value: string, homeDirectory: string | null) {
  const home = normalizeHomeDirectory(homeDirectory);
  if (!home || !value.includes(home)) return value;

  let output = "";
  let start = 0;
  while (start < value.length) {
    const index = value.indexOf(home, start);
    if (index === -1) {
      output += value.slice(start);
      break;
    }

    const next = value[index + home.length];
    const previous = index > 0 ? value[index - 1] : undefined;
    output += value.slice(start, index);
    if (isHomePathStartBoundary(previous) && isHomePathEndBoundary(next)) {
      output += "~";
      start = index + home.length;
    } else {
      output += home;
      start = index + home.length;
    }
  }
  return output;
}

function normalizeHomeDirectory(homeDirectory: string | null) {
  if (!homeDirectory || homeDirectory === "/") return null;
  return homeDirectory.endsWith("/") ? homeDirectory.slice(0, -1) : homeDirectory;
}

function isHomePathStartBoundary(previous: string | undefined) {
  return previous === undefined || !/[A-Za-z0-9._/-]/.test(previous);
}

function isHomePathEndBoundary(next: string | undefined) {
  return next === undefined || next === "/" || !/[A-Za-z0-9._-]/.test(next);
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

export function trimTail(value: string, lineCount = 5) {
  const lines = value.trim().split(/\r?\n/);
  return lines.slice(-lineCount).join("\n");
}

export function actionFailureTitle(action: string) {
  switch (action) {
    case "copy-path":
    case "copy-command":
    case "copy-package":
    case "copy-package-action":
    case "copy-cleanup-command":
      return "复制失败";
    case "open-path":
    case "open-package":
      return "打开失败";
    case "refresh":
      return "扫描失败";
    default:
      return "操作失败";
  }
}

export function errorToString(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

export function sizeScanError(error: unknown): DiskUsage {
  return {
    status: "Error",
    bytes: null,
    human: null,
    files: 0,
    directories: 0,
    skipped: 0,
    message: errorToString(error),
  };
}
