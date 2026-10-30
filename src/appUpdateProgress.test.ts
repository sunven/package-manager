import { describe, expect, it } from "vitest";
import { createAppUpdateProgressTracker } from "./appUpdateProgress";

describe("app update progress", () => {
  it("reports percentages when the total size is known", () => {
    const tracker = createAppUpdateProgressTracker();

    expect(tracker.started(200)).toBe(0);
    expect(tracker.progress(90)).toBe(45);
    expect(tracker.progress(10)).toBe(50);
    expect(tracker.finished()).toBe(100);
  });

  it("stays indeterminate when the total size is unknown", () => {
    const tracker = createAppUpdateProgressTracker();

    expect(tracker.started(undefined)).toBeNull();
    expect(tracker.progress(512)).toBeNull();
    expect(tracker.finished()).toBe(100);
  });

  it("clamps overshooting downloads to 100", () => {
    const tracker = createAppUpdateProgressTracker();

    tracker.started(100);
    expect(tracker.progress(160)).toBe(100);
  });
});
