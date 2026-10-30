#!/usr/bin/env bash
# 准备并发布一个版本：同步版本号、生成 CHANGELOG、提交、打 tag，确认后推送。
# 用法：
#   ./scripts/release.sh          # 自动递增 PATCH
#   ./scripts/release.sh 0.1.0    # 首次发布基线

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

if [ -z "$VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  if ! [[ "$CURRENT" =~ $SEMVER ]]; then
    echo "package.json 中的版本号不是 MAJOR.MINOR.PATCH：$CURRENT"
    exit 1
  fi
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  VERSION="${MAJOR}.${MINOR}.$((10#$PATCH + 1))"
  echo "未指定版本号，自动递增：${CURRENT} -> ${VERSION}"
fi

if ! [[ "$VERSION" =~ $SEMVER ]]; then
  echo "版本号格式不正确：${VERSION}"
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "工作目录有未提交的更改，请先提交或暂存。"
  git status --short
  exit 1
fi

if grep -q "REPLACE_WITH_UPDATER_PUBKEY" src-tauri/tauri.conf.json; then
  echo "更新签名公钥尚未配置。"
  echo "先运行 pnpm tauri signer generate -w .tauri/package-manager.key"
  echo "再运行 node scripts/update-pubkey.mjs .tauri/package-manager.key.pub"
  exit 1
fi

node scripts/bump-version.mjs "$VERSION"

if command -v git-cliff >/dev/null 2>&1; then
  git-cliff --tag "v$VERSION" -o CHANGELOG.md
  echo "已生成 CHANGELOG.md"
else
  echo "未安装 git-cliff，跳过 CHANGELOG；CI 仍会从未提交历史生成 Release 说明。"
fi

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
if [ -f CHANGELOG.md ]; then
  git add CHANGELOG.md
fi
git commit -m "chore(release): prepare for v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

echo
echo "已创建 tag v$VERSION。推送后将触发 GitHub Actions 构建并发布。"
read -r -p "现在推送到 origin/main 与该 tag？(y/N) " REPLY

if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  git push origin main
  git push origin "v$VERSION"
  echo "已推送。构建进度：https://github.com/sunven/package-manager/actions"
else
  echo "未推送。需要时执行：git push origin main && git push origin v$VERSION"
fi
