import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "./SettingsPage";

const noop = () => {};

describe("SettingsPage", () => {
  it("shows enabled package manager settings and locks the final enabled manager", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        enabledManagers={["Pnpm"]}
        managerSnapshots={{}}
        onSetManagerEnabled={noop}
        scanningManagers={new Set()}
      />,
    );

    expect(html).toContain("包管理工具");
    expect(html).toContain("已启用 1/11");
    expect(html).toContain("pnpm");
    expect(html).toContain("disabled");
  });
});
