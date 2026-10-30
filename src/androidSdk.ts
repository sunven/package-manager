import type { AndroidSdkCli, ManagerSnapshot, PackageRow } from "./types";

export function androidSdkRemovalCommand(cli: AndroidSdkCli, packageId: string) {
  if (cli.flavor === "Android") {
    return `${cli.program} --sdk=${cli.sdkRoot} sdk remove ${packageId.split(";").join("/")}`;
  }
  return `${cli.program} --sdk_root=${cli.sdkRoot} --uninstall "${packageId}"`;
}

export function androidSdkUninstallBlockReason(
  manager: ManagerSnapshot | null | undefined,
  pkg: PackageRow,
): string | null {
  if (!manager || manager.id !== "AndroidSdk") return "尚未读取 Android SDK 清单。";
  if (manager.status === "Missing") return "未找到 Android SDK 根目录。";
  if (manager.status === "Unsupported") return "旧版 SDK 布局不支持组件操作。";
  if (pkg.name.startsWith("cmdline-tools;")) {
    return "cmdline-tools 提供维护 CLI，不能在应用内卸载。";
  }
  if (!manager.androidSdk?.cli) {
    return "未找到可用的 android 或 sdkmanager CLI，无法卸载组件。";
  }
  return null;
}
