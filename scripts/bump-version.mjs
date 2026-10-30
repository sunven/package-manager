#!/usr/bin/env node
// 同步 package.json、tauri.conf.json、Cargo.toml 与 Cargo.lock 中的版本号。
// 用法：node scripts/bump-version.mjs [MAJOR.MINOR.PATCH]
// 省略版本号时自动递增 PATCH。

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function read(file) {
  return readFile(path.join(root, file), "utf8");
}

async function write(file, content) {
  await writeFile(path.join(root, file), content);
}

const packagePath = "package.json";
const tauriPath = "src-tauri/tauri.conf.json";
const cargoPath = "src-tauri/Cargo.toml";
const lockPath = "src-tauri/Cargo.lock";

const packageJson = JSON.parse(await read(packagePath));
const previousVersion = String(packageJson.version);
const requested = process.argv[2];
let version = requested;
if (!version) {
  const [major, minor, patch] = previousVersion.split(".");
  version = `${major}.${minor}.${Number(patch) + 1}`;
}

if (!semver.test(version)) {
  console.error(`版本号格式不正确：${version}（应为 MAJOR.MINOR.PATCH）`);
  process.exit(1);
}

packageJson.version = version;
await write(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfig = JSON.parse(await read(tauriPath));
tauriConfig.version = version;
await write(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoToml = await read(cargoPath);
const nextCargoToml = cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`);
if (nextCargoToml === cargoToml && previousVersion !== version) {
  console.error("未能在 Cargo.toml 中找到 [package] version");
  process.exit(1);
}
await write(cargoPath, nextCargoToml);

const cargoLock = await read(lockPath);
const lockPattern = /(\[\[package\]\]\nname = "package-manager-control-center"\nversion = ")[^"]+(")/;
if (!lockPattern.test(cargoLock)) {
  console.error("未能在 Cargo.lock 中找到 package-manager-control-center");
  process.exit(1);
}
await write(lockPath, cargoLock.replace(lockPattern, `$1${version}$2`));

console.log(version);
