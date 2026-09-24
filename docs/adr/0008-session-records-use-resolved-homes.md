# 会话记录只来自各自解析到的那一个 home

项目清理允许用户选择扫描根目录，是因为项目散落在磁盘各处，而且后端会登记授权范围。会话记录的位置由代理自己的 home 决定。本工具不提供目录选择器，只观察并移除解析到的一个 Codex home 和一个 Claude home：有 `CODEX_HOME` 就用它，否则用 `~/.codex` 下的 `sessions`；有 `CLAUDE_CONFIG_DIR` 就用它，否则用 `~/.claude` 下的 `projects`。

## Considered Options

像项目清理那样让用户另选目录。这样能覆盖第二个 home，但页面就能把任意目录里的对话文件移入废纸篓。

## Consequences

- 不是当前环境所解析的那个 home 里的会话记录不会出现，也不能被移除。
- 不要为了覆盖更多目录而加上文件夹选择器。
