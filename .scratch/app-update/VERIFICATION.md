# 应用更新验证

Status: done

日期：2026-10-30

## 自动化

| 检查 | 结果 |
| --- | --- |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm test` | 68 个文件、508 项通过（新增 25 项更新相关测试） |
| `pnpm build` | 通过 |
| `cargo check` | 通过 |
| `cargo test` | 360 项通过、10 项忽略 |

新增测试覆盖：进度追踪（已知/未知总长、越界）、跳过版本持久化与容错解析、工作流（初始化、无更新、发现更新、会话内关闭、跳过后新版本重现、错误映射、dev 模式、下载进度、签名失败）、设置页面板各状态、提示卡片交互、capabilities 权限。

## 浏览器检查

使用 `pnpm dev` 与 agent-browser 打开 `http://localhost:14201`，进入「设置」：

- 「软件更新」面板位于「管理器扫描设置」下方，标题与当前版本位对齐。
- 开发模式下显示「开发模式下无法检查更新；请在安装后的应用中检查。」，「检查更新」按钮禁用。
- 面板布局与现有 industrial-panel 风格一致。

浏览器没有 Tauri invoke，因此当前版本显示「版本未知」、后台扫描报错，属预期；安装后的应用由 `getVersion()` 读取版本。

## 未在本机验证

- 真实检查、下载、签名校验、安装与自动重启需要已生成的更新签名密钥与至少一个已发布 Release，未在本机执行。
- 首次发布前需要：`pnpm tauri signer generate -w .tauri/package-manager.key` → `node scripts/update-pubkey.mjs` → 配置 GitHub Secrets → `./scripts/release.sh 0.1.0` → 推送 tag 后观察 Actions 与 `latest.json` 校验步骤。
- Apple 公证未做，Gatekeeper 行为未验证。
