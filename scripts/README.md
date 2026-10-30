# 发布脚本

## 一次性准备：更新签名密钥

应用更新要求每个安装包都由同一把 Tauri minisign 密钥签名。公钥入库，私钥只放本机与 GitHub Secrets。

```bash
pnpm tauri signer generate -w .tauri/package-manager.key
node scripts/update-pubkey.mjs .tauri/package-manager.key.pub
```

- `.tauri/` 已被 git 忽略，私钥不会提交。
- 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：
  - `TAURI_SIGNING_PRIVATE_KEY`：`.tauri/package-manager.key` 的文件内容。
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时设置的密码。
- 公钥丢失或私钥更换后，已安装版本无法接受新更新，只能重新下载安装。

本地构建正式安装包时，`createUpdaterArtifacts` 需要同一把密钥：

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat .tauri/package-manager.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<密码>" \
pnpm tauri build
```

## 发布

首次发布以当前版本为基线：

```bash
./scripts/release.sh 0.1.0
```

后续发布自动递增 PATCH，也可以指定版本：

```bash
./scripts/release.sh
./scripts/release.sh 0.2.0
```

脚本会同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`，用 git-cliff 生成 `CHANGELOG.md`，提交并创建 `vX.Y.Z` tag；推送前会再次确认。

推送 tag 后，`.github/workflows/release.yml` 在 Apple Silicon runner 上构建 `dmg` 与 `app`，上传签名产物与 `latest.json`，并校验更新清单的版本、下载地址与签名非空。

## 已知限制

- 只构建 `aarch64-apple-darwin`。
- 未做 Apple Developer ID 签名与公证，Gatekeeper 可能提示；更新包签名与 Apple 公证是两件事。
- 更新端点固定为 `https://github.com/sunven/package-manager/releases/latest/download/latest.json`，因此仓库需要保持公开，Release 不能是草稿。
