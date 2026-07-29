# Homebrew 清理有意超出「只清缓存」的范围

`CONTEXT.md` 把「清理」定义为回收可由管理器自行重建的缓存类派生数据，但 Homebrew 这一项执行的 `brew cleanup` 除了删过期下载缓存和 stale lock 文件，**还会删除已安装 formula 的旧版本**（Cellar 里的非当前版本），这不是缓存而是已安装产物。我们知情并接受这个越界，因为 Homebrew 没有提供「只清缓存」的子命令（`--prune=all` 和 `--scrub` 只调整缓存清理力度，旧版本照删；`--prune-prefix` 是反向操作），唯一的纯缓存清理途径是 `rm -rf $(brew --cache)`，而那违反 [ADR-0001](./0001-delegated-cache-cleanup.md)。

## Considered Options

被否决的方案是 Homebrew 不提供清理执行，保持只有 `brew cleanup --dry-run` 预览加命令复制。

否决理由有两条。其一，`brew cleanup -n` 是这批管理器中**唯一的原生 dry-run**，扫描阶段已经拿到了逐条明细和确切的可回收字节数，这让 Homebrew 的确认弹窗能在用户点击前列出**具体将被删除的每一项**——这是本工具所有清理操作中最强的安全保障，放弃执行等于把最有据可依的那一项排除在外。其二，「删除旧版本」在 Homebrew 用户的认知里就是 `brew cleanup` 的定义，提供一个语义残缺的版本比不提供更违背预期。

## Consequences

- Homebrew 清理后无法再回退到 formula 的旧版本，需要重新下载。当前版本永不受影响。
- **不要**因为它违反 `CONTEXT.md` 里「清理」的定义而把它"修"成只清缓存——那个定义描述的是本工具清理能力的**主体形态**，Homebrew 是唯一一处记录在案的例外。
- Homebrew 是唯一被允许越界的管理器，理由是它同时具备「无纯缓存清理途径」和「有原生 dry-run 兜底」两个条件。新的越界申请需要同时满足这两条。
