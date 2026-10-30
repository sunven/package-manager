# 应用更新通过 GitHub Releases 分发

应用自身的更新使用 Tauri updater 插件，从 `https://github.com/sunven/package-manager/releases/latest/download/latest.json` 检查版本。发布由 `v*` 标签触发 GitHub Actions，在 `aarch64-apple-darwin` 上构建 dmg 与 app，并用 Tauri minisign 对更新包签名；安装完成后自动重启。首版以 `v0.1.0` 为基线，`CHANGELOG.md` 由 git-cliff 生成并作为 Release body 与更新说明。跳过某个版本只记录在本机 `localStorage`，不改变其他设备。当前不做 Apple Developer ID 签名与公证。

## Considered Options

- **自建静态托管或对象存储**：需要额外的托管、鉴权与发布凭证；仓库已公开，Releases 的固定下载地址直接满足端点要求。否决。
- **只提供手动下载 DMG**：无法形成「检查、下载、安装、重启」的应用内闭环，用户仍需自行比对版本。否决。
- **每次关闭提示都持久忽略该版本**：把「本次会话不再打扰」和「跳过这个版本」混为一种行为，用户无法只关掉当前提示。否决。
- **安装完成后让用户手动重启**：应用内没有未保存的编辑状态，扫描结果可重建；自动重启少一步且与已验证的参考实现一致。采纳。
- **首版直接定为 1.0.0**：与实际成熟度和现有 `0.1.0` 版本号不符。否决。
- **同时发布 Intel 产物**：项目从未构建过 `x86_64-apple-darwin`，也没有对应验证；先只覆盖 Apple Silicon。否决。
- **本次引入 Apple 公证**：需要付费开发者账号、证书与公证流程，而分发范围在产品文档中仍未确定。留作后续独立决策。否决。

## Consequences

- `tauri.conf.json` 增加 `plugins.updater`（端点与公钥）与 `bundle.createUpdaterArtifacts`；capabilities 增加 `updater:default`、`process:allow-restart`。
- 更新插件使用 `native-tls` 而不是默认的 rustls 特性：项目自身的 `reqwest` 与 updater 统一特性后，rustls 会因缺少 crypto provider 在任何 `reqwest` 客户端构造时 panic；系统 TLS 在 macOS 上可用且不需要全局 provider。
- 更新签名私钥只存在本机 `.tauri/` 与 GitHub Secrets；公钥提交进仓库。私钥或密码丢失后，已安装版本无法再接受新更新，只能重新下载安装。
- `latest.json` 只包含 `darwin-aarch64`；Intel Mac 需要从源码构建，未来扩展平台时需要同时提供对应架构的签名产物。
- 未公证的应用在 Gatekeeper 下可能出现提示；更新包自身的签名验证与 Apple 公证是两件事，前者不替代后者。
- 更新说明来自 git-cliff 生成的 `CHANGELOG.md`，随 Release body 进入 `latest.json`，由设置页渲染；没有发布说明时只显示版本号。
- 应用更新只替换安装包，不读写任何管理器、技能、插件或项目数据。
- 应用内检查失败不在全局提示中打扰用户，错误只在设置页的「软件更新」区展示。
