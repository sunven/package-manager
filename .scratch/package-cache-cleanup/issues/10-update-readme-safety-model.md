Status: ready-for-agent

# Update README to Match the New Cleanup Safety Model

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

README currently describes a safety model this feature replaces. Every claim below is now wrong and must be corrected — a stale safety section is worse than none, because it understates what the app can delete.

Wrong today:

- The intro says the tool covers npm/pnpm/Yarn/nvm/Homebrew/Maven/pip/Cargo, omitting Docker, Bun, and uv, which are already implemented.
- 「当前边界」says other managers 不直接 clean cache/store and 不直接执行 `brew cleanup`.
- 「安全策略」's 当前不允许的行为 list includes 自动清理非 npm/pnpm cache/store, 自动执行 Homebrew cleanup, 自动执行 pip cache purge, and 自动执行 Cargo cache 命令 — the first three are now allowed, the Cargo one is still correct but for a newly documented reason.
- 「后续候选」says 为 pnpm/Yarn/Bun/uv 等管理器补齐带确认的维护操作, which this feature delivers.
- 「扫描方式」lists maintenance actions for npm and pnpm only.
- 「已验证」's `cargo test` coverage list omits everything added here.

The most important addition is **why nvm, Maven, and Cargo have no cleanup**. Without it, their absence reads as an oversight, and Maven's local repository plus Cargo's registry directories are frequently a user's largest. State that it is deliberate and point at ADR-0001.

Also document the deliberate Homebrew scope exception and point at ADR-0002, so the README does not imply cleanup is strictly cache-only.

Add a pointer to `CONTEXT.md` and `docs/adr/`, neither of which existed before this feature.

## Acceptance criteria

- [ ] The intro lists all 11 managers, including Docker, Bun, and uv.
- [ ] The feature list describes cache cleanup execution for all 8 managers that have a plan, with the exact command each runs.
- [ ] 「当前边界」no longer claims managers other than npm/pnpm cannot clean cache/store.
- [ ] 「当前边界」no longer claims `brew cleanup` is not executed directly.
- [ ] 「当前边界」states that nvm, Maven, and Cargo have no cleanup capability, that this is deliberate, and links ADR-0001.
- [ ] 「安全策略」's allowed list covers delegated cleanup for the 8 managers and the single guarded `_npx` deletion with its path assertions.
- [ ] 「安全策略」's disallowed list is corrected: no arbitrary command execution, no cleanup for nvm/Maven/Cargo, no new guarded deletions, no batch cleanup, no `docker image prune -a`, no `docker system prune`, no volume or container removal, no `--force` to uv, no operation log, no undo.
- [ ] 「安全策略」documents that Homebrew cleanup also removes old versions of installed formulae, and links ADR-0002.
- [ ] 「安全策略」documents the 300-second cleanup timeout as distinct from scan timeouts.
- [ ] 「安全策略」documents partial-completion reporting for multi-step plans.
- [ ] 「扫描方式」lists the cleanup command for each of the 8 managers.
- [ ] 「已验证」's coverage list includes the plan table assertions, the no-plan assertions for nvm/Maven/Cargo, the `_npx` guardrail tests, partial-completion tests, and the per-manager frontend tests.
- [ ] The stale 「后续候选」entry about adding confirmed maintenance operations for pnpm/Yarn/Bun/uv is removed.
- [ ] README points at `CONTEXT.md` for vocabulary and `docs/adr/` for decisions.
- [ ] The 「项目结构」section reflects that `src-tauri/src` is split into `command.rs`, `disk_usage.rs`, `types.rs`, and `managers/`, not a single `lib.rs`.
- [ ] `pnpm test`, `pnpm build`, and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/09-navigate-from-development-health-recommendations.md
