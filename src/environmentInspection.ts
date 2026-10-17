import type { ManagerId } from "./types";

export interface EnvironmentInspection {
  capturedAt: number;
  pathEntries: { original: string; path: string; issue: string | null }[];
  commands: {
    program: string;
    managers: ManagerId[];
    selectedPath: string | null;
    status: string;
    candidates: { pathIndex: number; path: string; target: string | null; status: string; message: string | null }[];
  }[];
}

export const resolutionLabels: Record<string, string> = {
  single: "单一来源", aliases: "多个路径指向同一文件", multiple: "存在不同安装来源", missing: "PATH 中未找到", unknown: "无法完整读取",
};
