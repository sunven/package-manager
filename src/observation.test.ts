import { describe, expect, it } from "vitest";
import { locateSearchTarget, searchManagers } from "./globalSearch";
import { compareSnapshots, snapshotDraft, type ArchivedSnapshot } from "./managerHistory";
import { managerFixture } from "./test/fixtures";
import type { ManagerId, PackageRow } from "./types";

const pkg = (name: string, version = "1", changes: Partial<PackageRow> = {}): PackageRow => ({ name, version, kind: "Generic", path: null, signals: [], actions: [], source: "fixture", ...changes });
function archive(id: string, packages: PackageRow[], managerId: ManagerId = "Npm"): ArchivedSnapshot {
  return { ...snapshotDraft(managerFixture(managerId, { scopeKey: "same-root", packages }), null), id, capturedAt: Number(id) };
}

describe("cross-manager lookup", () => {
  it("keeps same-named packages and runtime installations distinct and excludes disabled managers", () => {
    const snapshots = { Npm: managerFixture("Npm", { packages: [pkg("toolbox"), pkg("tool")] }), Pnpm: managerFixture("Pnpm", { packages: [pkg("tool")] }), Nvm: managerFixture("Nvm", { packages: [pkg("node", "20"), pkg("node", "22")] }) };
    expect(searchManagers(["Npm", "Pnpm"], snapshots, " TOOL ").map((r) => [r.managerId, r.name])).toEqual([["Npm", "tool"], ["Pnpm", "tool"], ["Npm", "toolbox"]]);
    const nodes = searchManagers(["Nvm"], snapshots, "node");
    expect(new Set(nodes.map((n) => n.observationId)).size).toBe(2);
    expect(searchManagers(["Pnpm"], snapshots, "tool")).toHaveLength(1);
  });
  it("matches hidden paths and re-resolves stable identity after row order changes", () => {
    const manager = managerFixture("Npm", { packages: [pkg("a"), pkg("tool", "2", { path: "/long/bin/tool" })], paths: [{ kind: "GlobalModules", label: "全局目录", path: "/modules", size: { status: "Pending", bytes: null, human: null, files: 0, directories: 0, skipped: 0, message: null } }] });
    const target = searchManagers(["Npm"], { Npm: manager }, "/long")[0];
    expect(locateSearchTarget(target, { ...manager, packages: [...manager.packages].reverse() })).toBe(0);
    expect(locateSearchTarget(target, { ...manager, packages: [] })).toBe(-1);
    expect(searchManagers(["Npm"], { Npm: manager }, "/modules")[0].kind).toBe("path");
    expect(locateSearchTarget(target, { ...manager, packages: [manager.packages[1], manager.packages[1]] })).toBe(-1);
  });
});

describe("snapshot comparison", () => {
  it("compares package additions, removals and versions", () => {
    const diff = compareSnapshots(archive("1", [pkg("old"), pkg("tool", "1")]), archive("2", [pkg("new"), pkg("tool", "2")]));
    expect(diff.issue).toBeNull();
    expect(diff.packages.map((p) => p.change).sort()).toEqual(["added", "changed", "removed"]);
  });
  it("preserves coexisting runtime installations", () => {
    const diff = compareSnapshots(archive("1", [pkg("node", "20")], "Nvm"), archive("2", [pkg("node", "20"), pkg("node", "22")], "Nvm"));
    expect(diff.packages.map((p) => p.change)).toEqual(["added"]);
  });
  it("compares actual Maven versions even when the displayed summary is unchanged", () => {
    const before = archive("1", [pkg("org:a", "3 versions", { kind: "MavenArtifact", observedVersions: ["1", "2", "3"] })], "Maven");
    const after = archive("2", [pkg("org:a", "3 versions", { kind: "MavenArtifact", observedVersions: ["1", "2", "4"] })], "Maven");
    expect(compareSnapshots(before, after).packages[0].after).toBe("1、2、4");
  });
  it("does not call Docker uptime a package version change", () => {
    const before = archive("1", [pkg("db", "Up 2 minutes", { kind: "DockerContainer", signals: ["Running"] })], "Docker");
    const after = archive("2", [pkg("db", "Up 5 minutes", { kind: "DockerContainer", signals: ["Running"] })], "Docker");
    expect(compareSnapshots(before, after).packages).toEqual([]);
    after.packages[0].signals = ["Stopped"];
    expect(compareSnapshots(before, after).packages[0].label).toBe("资源信息变化");
  });
  it("does not infer removals from failed, partial or different-source observations", () => {
    const before = archive("1", [pkg("tool")]);
    for (const changes of [{ complete: false }, { scopeKey: "other-root" }, { scopeKey: null }]) {
      const diff = compareSnapshots(before, { ...archive("2", []), ...changes });
      expect(diff.issue).toBeTruthy(); expect(diff.packages).toEqual([]);
    }
  });
  it("only computes a footprint delta for complete measurements of the same source and path", () => {
    const before = archive("1", []), after = archive("2", []);
    before.paths = [{ kind: "Cache", label: "缓存", path: "/cache", bytes: 100, complete: true }];
    after.paths = [{ ...before.paths[0], bytes: 20 }];
    expect(compareSnapshots(before, after).paths[0].delta).toBe(-80);
    after.paths[0].complete = false;
    expect(compareSnapshots(before, after).paths[0].delta).toBeNull();
    after.paths[0].complete = true; after.scopeKey = "other";
    expect(compareSnapshots(before, after).paths[0].delta).toBeNull();
  });
  it("archives data facts without executable actions and marks ambiguous identities incomplete", () => {
    const row = pkg("a", "1", { actions: [{ program: "danger", args: [], preview: "danger", timeoutMs: 0 }] });
    const draft = snapshotDraft(managerFixture("Npm", { packages: [row, row] }), null);
    expect(draft.complete).toBe(false);
    expect(JSON.stringify(draft)).not.toContain("danger");
  });
});
