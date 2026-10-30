#!/usr/bin/env node
// 把更新签名公钥写入 tauri.conf.json 的 plugins.updater.pubkey。
// 用法：node scripts/update-pubkey.mjs [公钥文件路径]
// 默认读取 .tauri/package-manager.key.pub。

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pubkeyPath = process.argv[2] ?? ".tauri/package-manager.key.pub";
const configPath = path.join(root, "src-tauri/tauri.conf.json");

let pubkey;
try {
  pubkey = (await readFile(path.resolve(root, pubkeyPath), "utf8")).trim();
} catch {
  console.error(`无法读取公钥文件：${pubkeyPath}`);
  console.error("先运行 pnpm tauri signer generate -w .tauri/package-manager.key");
  process.exit(1);
}

if (!pubkey) {
  console.error(`公钥文件为空：${pubkeyPath}`);
  process.exit(1);
}

const config = JSON.parse(await readFile(configPath, "utf8"));
config.plugins ??= {};
config.plugins.updater ??= {};
config.plugins.updater.pubkey = pubkey;

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("已写入 plugins.updater.pubkey");
