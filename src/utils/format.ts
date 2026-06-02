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
    .replace("Maven version probe failed", "Maven 版本检测失败")
    .replace("Python version probe failed", "Python 版本检测失败")
    .replace("Python executable probe failed", "Python 可执行文件检测失败")
    .replace("pip version probe failed", "pip 版本检测失败")
    .replace("pip package list failed", "pip 软件包列表获取失败")
    .replace("pip cache dir failed", "pip 缓存目录获取失败")
    .replace("pip cache info failed", "pip 缓存信息获取失败")
    .replace("pip inspect failed", "pip 检查失败")
    .replace("pip outdated failed", "pip 可更新包扫描失败")
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
  return kind === "Cache" || kind === "Store" || kind === "Cellar" || kind === "Caskroom" || kind === "LocalRepository";
}

export function actionLabel(action: CommandEnvelope) {
  const [firstArg, secondArg] = action.args;
  const command = action.args.join(" ");
  if (command.includes("dependency:get")) return "复制获取依赖命令";
  if (command.includes("dependency:tree")) return "复制依赖树命令";
  if (command.includes("pip show")) return "复制查看命令";
  if (command.includes("pip install --upgrade")) return "复制升级命令";
  if (command.includes("pip uninstall")) return "复制卸载命令";
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
