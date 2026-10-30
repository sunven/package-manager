import { errorToString } from "./utils/format";

export const appUpdateDevNotice = "开发模式下无法检查更新；请在安装后的应用中检查。";

export function appUpdateErrorMessage(error: unknown, action: "check" | "download"): string {
  const message = errorToString(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return "网络连接失败，请检查网络设置。";
  }
  if (message.includes("404")) return "未找到更新服务器或更新包。";
  if (
    normalized.includes("signature") ||
    normalized.includes("verify") ||
    normalized.includes("minisign")
  ) {
    return "更新包签名验证失败，请联系开发者。";
  }

  return `${action === "check" ? "检查更新失败" : "更新失败"}：${message}`;
}
