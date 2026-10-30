# 接入 Tauri updater 与配置

Status: done

- 引入 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`、`react-markdown`。
- `Cargo.toml` 增加 updater/process 插件并在 `lib.rs` 注册。
- `tauri.conf.json` 增加 `plugins.updater` 与 `createUpdaterArtifacts`。
- capabilities 增加 `updater:default`、`process:allow-restart`，同步 `capabilities.test.ts`。
- 提供 `scripts/update-pubkey.mjs` 写入公钥。
