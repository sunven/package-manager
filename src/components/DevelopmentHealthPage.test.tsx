import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DevelopmentHealthPage } from "./DevelopmentHealthPage";
import type { DevelopmentHealthSummary, HealthRecommendation } from "../developmentHealth";
import type { ManagerId } from "../types";
import { cleanupCopyFor } from "../cleanupCopy";

const noop = () => {};

function recommendation(
  id: string,
  managerId: ManagerId,
  title: string,
  bytes?: number,
): HealthRecommendation {
  return { id, tone: "review", managerId, title, detail: `${title} 的说明`, bytes };
}

function health(recommendations: HealthRecommendation[]): DevelopmentHealthSummary {
  return {
    enabledManagerCount: 11,
    scannedManagerCount: 3,
    readyManagerCount: 3,
    totalPackages: 20,
    totalBytes: 1024,
    maintenanceBytes: 512,
    scanIssueCount: 0,
    riskSignalCount: 0,
    reviewSignalCount: 1,
    recommendations,
    signalGroups: [],
    topStorage: [],
    managerStatuses: [],
  };
}

function render(
  recommendations: HealthRecommendation[],
  onOpenManager: (managerId: ManagerId) => void = noop,
) {
  return renderToStaticMarkup(
    <DevelopmentHealthPage
      health={health(recommendations)}
      homeDirectory="/Users/sunven"
      onOpenManager={onOpenManager}
    />,
  );
}

describe("DevelopmentHealthPage recommendations", () => {
  it("names the destination in the accessible label", () => {
    // Every row's visible label is 查看, so without this a screen reader user
    // hears the same word five times with no way to tell the rows apart.
    const html = render([recommendation("homebrew-cleanup", "Homebrew", "可回收 1.2 GB")]);

    expect(html).toContain('aria-label="查看 Homebrew：可回收 1.2 GB"');
  });

  it("offers navigation for managers that have no cleanup plan", () => {
    // Landing on the tab to inspect usage is useful even when nothing can be
    // cleaned — Maven's local repository is often the largest directory there is.
    const html = render([
      recommendation("maven-duplicates", "Maven", "本地仓库有重复版本"),
      recommendation("cargo-registry", "Cargo", "registry 缓存偏大"),
    ]);

    expect(html).toContain("查看 Maven：本地仓库有重复版本");
    expect(html).toContain("查看 Cargo：registry 缓存偏大");
  });

  it("renders no cleanup or confirm affordance on the health page", () => {
    // Execution stays on the manager tab, beside the figures that justify it.
    // A confirm button here would be divorced from that context.
    //
    // Asserted against the actual affordance labels rather than the substring
    // 清理: real recommendation text legitimately contains that word (e.g.
    // "Homebrew 清理预演有回收空间"), so a substring check would be meaningless.
    const html = render([
      recommendation("npm-cache", "Npm", "npm 缓存偏大", 4096),
      recommendation("docker-cleanup-signals", "Docker", "有 7 项 dangling 镜像"),
    ]);

    expect(html).not.toContain(cleanupCopyFor("Npm")?.action);
    expect(html).not.toContain(cleanupCopyFor("Docker")?.action);
    expect(html).not.toContain(cleanupCopyFor("Npm")?.confirm);
  });

  it("adds no batch affordance across managers", () => {
    const html = render([
      recommendation("npm-cache", "Npm", "npm 缓存偏大", 4096),
      recommendation("yarn-cache", "Yarn", "Yarn 缓存偏大", 2048),
    ]);

    expect(html).not.toContain("全部");
    expect(html).not.toContain("一键");
  });
});
