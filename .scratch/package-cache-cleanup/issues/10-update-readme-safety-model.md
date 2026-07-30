Status: done

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

- [x] The intro lists all 11 managers, including Docker, Bun, and uv.
- [x] The feature list describes cache cleanup execution for all 8 managers that have a plan, with the exact command each runs.
- [x] 「当前边界」no longer claims managers other than npm/pnpm cannot clean cache/store.
- [x] 「当前边界」no longer claims `brew cleanup` is not executed directly.
- [x] 「当前边界」states that nvm, Maven, and Cargo have no cleanup capability, that this is deliberate, and links ADR-0001.
- [x] 「安全策略」's allowed list covers delegated cleanup for the 8 managers and the single guarded `_npx` deletion with its path assertions.
- [x] 「安全策略」's disallowed list is corrected: no arbitrary command execution, no cleanup for nvm/Maven/Cargo, no new guarded deletions, no batch cleanup, no `docker image prune -a`, no `docker system prune`, no volume or container removal, no `--force` to uv, no operation log, no undo.
- [x] 「安全策略」documents that Homebrew cleanup also removes old versions of installed formulae, and links ADR-0002.
- [x] 「安全策略」documents the 300-second cleanup timeout as distinct from scan timeouts.
- [x] 「安全策略」documents partial-completion reporting for multi-step plans.
- [x] 「扫描方式」lists the cleanup command for each of the 8 managers.
- [x] 「已验证」's coverage list includes the plan table assertions, the no-plan assertions for nvm/Maven/Cargo, the `_npx` guardrail tests, partial-completion tests, and the per-manager frontend tests.
- [x] The stale 「后续候选」entry about adding confirmed maintenance operations for pnpm/Yarn/Bun/uv is removed.
- [x] README points at `CONTEXT.md` for vocabulary and `docs/adr/` for decisions.
- [x] The 「项目结构」section reflects that `src-tauri/src` is split into `command.rs`, `disk_usage.rs`, `types.rs`, and `managers/`, not a single `lib.rs`.
- [x] `pnpm test`, `pnpm build`, and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/09-navigate-from-development-health-recommendations.md

## Comments

- Rewrote the intro, 功能, 当前边界, 扫描方式, 安全策略, 项目结构 and 已验证 sections. The old safety section was worse than none: it claimed the app does not clean caches other than npm/pnpm and does not execute `brew cleanup`, which understated what the app can now delete.
- The intro now leads with *why* the safety model is structural — deletion is delegated to each manager's own CLI — rather than listing which buttons exist. That framing is the thing a reader needs before the command list makes sense.
- The most important addition is the explicit statement that **nvm, Maven and Cargo have no cleanup and that this is deliberate**, with a pointer to ADR-0001. Their local repository and registry directories are frequently a user's largest, so without this the absence reads as an oversight someone would "fix".
- Documented the Homebrew scope exception with a pointer to ADR-0002, so README does not imply cleanup is strictly cache-only.
- Corrected 项目结构, which still described `src-tauri/src/lib.rs` as holding all adapters, space accounting and unit tests. That has not been true since the split into `command.rs` / `disk_usage.rs` / `types.rs` / `managers/`. Added `cleanupCopy.ts` on the frontend side.
- Dropped two stale 后续候选 entries this work resolved or rejected: "为 pnpm/Yarn/Bun/uv 补齐带确认的维护操作" (delivered) and "增加操作日志" (explicitly rejected — cleanup targets self-healing derived data, so after-the-fact forensics buys no safety).
- Added per-manager feature bullets for Docker, Bun and uv, which were implemented but only ever appeared in the scan list while every other manager had a detail line. Verified against `docker.rs`, `bun.rs` and `uv.rs` rather than written from memory.
- **Cross-checked every command claim against the Rust static table** rather than trusting my own summary: all 8 plans match exactly. Test counts in 已验证 (74 Rust, 73 frontend) were read from actual runs.
- Verified with `pnpm test` (73 passed), `cargo test` (74 passed), `pnpm build`.
