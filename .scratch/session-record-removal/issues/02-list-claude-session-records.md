Status: done

# 同一页列出 Claude 会话记录

## Parent

.scratch/session-record-removal/PRD.md

## What to build

Add a Claude section to the 会话记录 page, using the same record fields and grouping as Codex.

Resolve one Claude home: `CLAUDE_CONFIG_DIR` when set, otherwise the user's `.claude` directory. List session records only from that home's `projects` directory. The same identity rules apply: regular `.jsonl` files inside that directory, no symlinks, no other files, no directory picker.

A missing projects directory shows an empty Claude section. A read failure of one source does not hide records already read from the other source, and does not turn the whole page into a failure. Each section shows its own count and total size.

## Acceptance criteria

- [x] The page shows Codex and Claude as separate sections.
- [x] Claude records come only from the resolved home's `projects` directory.
- [x] Claude rows use the same fields, local month grouping, in-use marking, and empty working-directory behavior as Codex.
- [x] A missing projects directory shows an empty Claude section while Codex still lists.
- [x] A read failure of one source leaves the other source's records visible.
- [x] Each section shows its own count and total size.
- [x] Rust tests on a temporary directory cover Claude listing, symlink exclusion, and one source failing while the other still returns records.
- [x] Frontend policy tests cover the two sections remaining independent when one source is empty or failed.

## Blocked by

- .scratch/session-record-removal/issues/01-list-codex-session-records.md
