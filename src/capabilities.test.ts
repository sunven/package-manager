import { describe, expect, it } from "vitest";
import defaultCapability from "../src-tauri/capabilities/default.json";

interface ScopedPermission {
  identifier: string;
  allow: { path: string }[];
}

function isScopedPermission(permission: unknown): permission is ScopedPermission {
  return (
    typeof permission === "object" &&
    permission !== null &&
    "identifier" in permission &&
    "allow" in permission
  );
}

describe("Tauri capabilities", () => {
  it("allows local paths to be opened from the package manager UI", () => {
    const openPathPermission = defaultCapability.permissions.find(
      (permission): permission is ScopedPermission =>
        isScopedPermission(permission) && permission.identifier === "opener:allow-open-path",
    );

    expect(openPathPermission).toBeDefined();
    expect(openPathPermission?.allow).toEqual(
      expect.arrayContaining([
        { path: "$HOME/.local/**" },
        { path: "$HOME/.m2/**" },
        { path: "$HOME/.nvm/**" },
        { path: "/opt/homebrew/**" },
        { path: "/usr/local/**" },
      ]),
    );
  });
});
