# 发布流水线与版本脚本

Status: done

- `cliff.toml`、`scripts/bump-version.mjs`、`scripts/release.sh`、`scripts/README.md`。
- `.github/workflows/release.yml`：`v*` 标签构建 `aarch64-apple-darwin`，上传签名产物与 `latest.json`，校验字段非空。
- README 补充应用更新与发布说明。
