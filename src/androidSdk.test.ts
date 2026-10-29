import { describe, expect, it } from "vitest";
import { androidSdkRemovalCommand, androidSdkUninstallBlockReason } from "./androidSdk";
import { managerFixture } from "./test/fixtures";
import type { AndroidSdkCli, PackageRow } from "./types";

const packageRow: PackageRow = {
  name: "platforms;android-36",
  version: "2",
  source: "Android SDK Platform 36",
  kind: "AndroidSdkComponent",
  path: "/sdk/platforms/android-36",
  actions: [],
  signals: [],
};

const androidCli: AndroidSdkCli = {
  program: "/sdk/cmdline-tools/latest/bin/android",
  flavor: "Android",
  sdkRoot: "/sdk",
};

describe("Android SDK maintenance copy", () => {
  it("builds root-bound removal commands for both CLIs", () => {
    expect(androidSdkRemovalCommand(androidCli, "system-images;android-36;google_apis;arm64-v8a")).toBe(
      "/sdk/cmdline-tools/latest/bin/android --sdk=/sdk sdk remove system-images/android-36/google_apis/arm64-v8a",
    );
    expect(androidSdkRemovalCommand({ ...androidCli, program: "/sdk/cmdline-tools/latest/bin/sdkmanager", flavor: "Sdkmanager" }, "platforms;android-36")).toBe(
      "/sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/sdk --uninstall \"platforms;android-36\"",
    );
  });

  it("explains every reason a component cannot be removed here", () => {
    const manager = managerFixture("AndroidSdk", { androidSdk: { cli: androidCli } });

    expect(androidSdkUninstallBlockReason(manager, packageRow)).toBeNull();
    expect(androidSdkUninstallBlockReason({ ...manager, status: "Missing" }, packageRow)).toContain("未找到");
    expect(androidSdkUninstallBlockReason({ ...manager, status: "Unsupported" }, packageRow)).toContain("旧版");
    expect(androidSdkUninstallBlockReason({ ...manager, androidSdk: { cli: null } }, packageRow)).toContain("CLI");
    expect(
      androidSdkUninstallBlockReason(manager, { ...packageRow, name: "cmdline-tools;22.0" }),
    ).toContain("cmdline-tools");
  });
});
