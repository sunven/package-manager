import { describe, expect, it } from "vitest";
import { createManagerScanQueue } from "./managerScanQueue";

describe("manager scan queue", () => {
  it("shares duplicate requests and limits all scans to two slots", async () => {
    const queue = createManagerScanQueue();
    const started: string[] = [];
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const npm = queue.run("Npm", async () => { started.push("npm"); await gate; });
    const duplicate = queue.run("Npm", async () => { started.push("duplicate"); });
    const pip = queue.run("Pip", async () => { started.push("pip"); await gate; });
    const brew = queue.run("Homebrew", async () => { started.push("brew"); });
    expect(duplicate).toBe(npm);
    await Promise.resolve();
    expect(started).toEqual(["npm", "pip"]);
    finish();
    await Promise.all([npm, pip, brew]);
    expect(started).toEqual(["npm", "pip", "brew"]);
    await queue.run("Npm", async () => { started.push("fresh"); });
    expect(started[started.length - 1]).toBe("fresh");
  });

  it("releases a failed slot and continues other managers", async () => {
    const queue = createManagerScanQueue();
    const results = await Promise.allSettled([
      queue.run("Npm", async () => { throw new Error("unavailable"); }),
      queue.run("Pip", async () => {}),
      queue.run("Homebrew", async () => {}),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });
});
