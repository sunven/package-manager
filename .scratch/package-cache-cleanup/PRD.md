Status: done

# PRD: Cache Cleanup Execution Across Package Managers

## Problem Statement

Package Manager Control Center already scans 11 package managers, measures their cache/store/repository disk usage, and computes a Development Health summary that ranks where disk space is going and how much is reclaimable. But only npm and pnpm can act on that: npm exposes `npm cache clean --force` and pnpm exposes `pnpm store prune`. For the other nine managers the app stops at observation — the user reads a size, then leaves the app and runs the command by hand.

This is the worst possible split, because the app is specifically good at the part that motivates cleanup (finding the multi-gigabyte directory) and useless at the part that resolves it. The Development Health page makes this concrete: `developmentHealth.ts` already emits recommendations carrying exact byte counts for Homebrew cleanup and Docker reclaimable space, and those recommendations are **not clickable**. The app tells the user there is 4 GB to reclaim and offers no way to reclaim it.

The requested behavior is cleanup execution for each manager, with safety as an explicit requirement rather than an afterthought.

## Solution

Add cache cleanup execution for the 8 managers whose own CLI can clean their own cache, through a single allowlisted backend entry point.

The safety model is structural rather than procedural — it does not rest on how many confirmation dialogs the user clicks, but on what the system is capable of expressing:

- **Delegated cleanup only.** Deletion is always performed by the manager's own CLI. The app selects an allowlisted subcommand from a static Rust table; it does not delete files. See ADR-0001.
- **A single backend entry point.** `run_cache_cleanup(managerId: ManagerId)` is the entire API surface. The frontend's vocabulary is an 11-value enum validated by serde, so it is *syntactically incapable* of expressing which command runs. The allowlist is a property of the type system, not a convention to uphold in 8 places.
- **One documented guarded-deletion exception.** `_npx`, because `npm cache clean --force` only clears `_cacache` and npm ships no command for `_npx`. Guarded by three path-identity assertions.
- **Three managers get no cleanup at all.** nvm, Maven, and Cargo have no official cache-cleaning subcommand, so under delegated cleanup they have no cleanup plan. This is architectural, not a disabled button.

A cleanup plan is a **step sequence**, not a single command: Docker runs two commands, npm runs a command followed by the guarded deletion. Multi-step plans therefore need honest partial-completion reporting.

### Cleanup plan table

| Manager | Step sequence | Confirmation dialog figure |
|---|---|---|
| Npm | `npm cache clean --force` → guarded deletion of `_npx` | cache path usage |
| Pnpm | `pnpm store prune` | none; prune explanation instead |
| Yarn | `yarn cache clean` | cache path usage |
| Homebrew | `brew cleanup` | dry-run exact bytes + itemized list |
| Pip | `<freshly resolved python> -m pip cache purge` | cache path usage |
| Bun | `bun pm cache rm` | cache path usage |
| Uv | `uv cache prune` (**without** `--force`) | none; prune explanation instead |
| Docker | `docker builder prune -f` → `docker image prune -f` | `docker system df` reclaimable |
| Nvm / Maven / Cargo | **no cleanup plan** | — |

Success criteria:

- Each of the 8 managers with a cleanup plan exposes a cleanup affordance on its path card, and executes only its own table-defined step sequence.
- nvm, Maven, and Cargo expose no cleanup affordance and their absence is documented as deliberate.
- The frontend cannot cause any command outside the static table to run, and cannot influence a command's program or arguments.
- Every cleanup requires explicit confirmation before any command executes.
- The confirmation dialog states the figure whose provenance is genuinely available for that manager, and states no figure where only a misleading one would be available.
- A partially completed multi-step plan is reported as partially completed, naming which steps ran and which step failed — never as outright failure.
- Cleanup uses a 300-second timeout, separate from scan timeouts, so that "large cache" does not present as "timed out".
- Successful cleanup refreshes the affected manager so displayed usage is not stale, and the Development Health summary recomputes.
- Development Health recommendations navigate to the owning manager tab.
- Existing npm/pnpm uninstall behavior, scan behavior, and size semantics are unchanged.
- `pnpm test`, `pnpm build`, and `cargo test` pass.

## User Stories

1. As a developer, I want a cleanup affordance on each manager's cache path card, so that I can reclaim space where I discovered the usage.
2. As a developer, I want cleanup to require confirmation, so that a misclick does not delete anything.
3. As a developer, I want the confirmation to tell me how much space will actually be reclaimed when that number is knowable, so that I can judge whether the operation is worth it.
4. As a developer, I want the confirmation to *not* show me a number when the number would be misleading, so that I do not conclude the feature is broken when a prune reclaims little.
5. As a developer cleaning Homebrew, I want to see the itemized list of what will be removed before confirming, so that I can veto an unexpected deletion.
6. As a developer, I want to know that Homebrew cleanup also removes old versions of installed formulae, so that the scope is not a surprise after the fact.
7. As a developer cleaning uv, I want cleanup to keep cache entries my existing environments still reference, so that cleanup does not force re-downloads.
8. As a developer cleaning Docker, I want build cache and dangling images removed but tagged images, containers, and volumes untouched, so that cleanup cannot destroy data.
9. As a developer, I want a cleanup that partly succeeded to say so, so that I know whether retrying will repeat work already done.
10. As a developer, I want cleanup of a very large cache to finish rather than be killed at 30 seconds, so that I am not left with a half-deleted cache reported as a failure.
11. As a developer, I want to see when cleanup is running, so that I do not click repeatedly.
12. As a developer, I want successful cleanup to refresh the usage figures, so that I can see the effect.
13. As a developer, I want failed cleanup to show the underlying error, so that I can tell a stopped Docker daemon from a permission problem.
14. As a developer, I want the Development Health recommendations to take me to the manager that owns them, so that I do not have to remember which tab to open.
15. As a developer using Yarn 2+, I want a cleanup affordance even though the manager is marked unsupported, so that a status about missing *package listings* does not block cache work.
16. As a developer, I want nvm, Maven, and Cargo to have no cleanup button, so that the app never deletes directories it derived a path for itself.
17. As a developer, I want to understand why Maven and Cargo — often my largest directories — are excluded, so that it does not look like an oversight.
18. As a developer, I want cleanup unavailable for managers that are not installed, so that I am not offered an action that cannot run.
19. As a developer, I want my npm/pnpm global package uninstall flow to keep working exactly as before, so that this change costs me nothing.
20. As a maintainer, I want the mapping from manager to cleanup command to live in one static table, so that adding a manager cannot loosen the allowlist.
21. As a maintainer, I want a test asserting the exact program and arguments for all 8 plans, so that a command can never silently change.
22. As a maintainer, I want a test asserting nvm/Maven/Cargo resolve to no plan, so that a future contributor cannot quietly grant them one.
23. As a maintainer, I want the `_npx` guarded deletion's path assertions covered by tests, so that the one exception to delegated cleanup stays narrow.
24. As a maintainer, I want partial-completion reporting covered by tests, so that the misleading "failed" report cannot come back.
25. As a maintainer, I want cleanup to never pass `--force` to uv, so that uv's native in-use check is not bypassed.
26. As a maintainer, I want README's safety model and boundary sections to match what the app now does.

## Implementation Decisions

### Backend shape

- Add one Tauri command: `run_cache_cleanup(managerId: ManagerId) -> Result<CacheCleanupRun, String>`. No other parameters. The frontend cannot pass a program, an argument, or a path.
- The manager-to-plan mapping is a static table in Rust. A plan is a step sequence; a step is either an allowlisted command or a guarded directory deletion.
- Managers with no plan return a "no cleanup plan" outcome rather than an error, so the frontend can distinguish "not offered" from "failed".
- Migrate npm's `CleanCache` out of `NpmMaintenanceOperation` and pnpm's `StorePrune` out of `PnpmMaintenanceOperation` into the new entry point. Leaving them behind would put npm cache cleanup on two code paths and defeat the single-entry design.
- `UninstallGlobalPackage` stays in both existing enums and existing commands, unchanged, at its existing 30-second timeout.
- Cleanup steps use a 300-second timeout. Scan timeouts (5–15s) and uninstall timeout (30s) are untouched.

### Partial completion

- The cleanup result carries per-step outcomes and an overall state distinguishing fully succeeded, partially completed, and failed outright.
- Do not reuse `ManagerStatus::Partial` — that term means "manager partially usable" and is a different concept. Use a distinct representation.
- Stop at the first failing step. A failing step usually indicates an environmental problem (daemon down, permission denied) that the next step will hit too; continuing multiplies blast radius without adding information.
- Fix the existing defect at `node.rs:471-491`, where a failed `_npx` deletion reports outright failure even though `npm cache clean --force` already succeeded.

### The `_npx` guarded deletion

- Before deleting, assert: the path is absolute; it is prefixed by the value returned by `npm config get cache`; its basename is exactly `_npx`. Any assertion failing means report a failure, not proceed.
- Today `npm config get cache` returning an empty string yields the relative path `_npx`, which would delete a same-named directory under the process cwd. The assertions must close this.

### Pip's interpreter

- Resolve the python executable inside the cleanup handler using the same resolution logic as the scan (`python3` with fallback to `python`), not from a frontend-supplied value.
- Accepting an interpreter path from the frontend would make the API accept an arbitrary program path, destroying the single-entry guarantee.
- Re-resolving means cleanup targets the interpreter in effect *now*, which is the more correct behavior, not merely an acceptable compromise.

### Confirmation dialog

- Present the figure according to its provenance: Homebrew from `HomebrewCleanupPreview` (exact bytes plus `rawOutput` itemization); Docker from `DockerDiskUsageRow.reclaimable`; full-clear managers from the already-measured cache path usage; prune-type managers (pnpm, uv) get no figure and an explanation that only unreferenced content is removed.
- Never show a path-usage figure next to a prune operation. It over-estimates severely and teaches users the feature is broken.
- Keep showing the command text that will run, as the existing dialog does.
- User-facing Chinese copy stays in TypeScript; the plan table stays in Rust. Drive the copy from data rather than extending the existing hardcoded if/else chain, which would otherwise become an 8-arm chain.

### Frontend

- Cleanup affordances go on each manager's path card, following the existing npm/pnpm pattern in `PathPanel`.
- Homebrew keeps its dedicated `HomebrewCleanupCard`, now with an execute affordance alongside the dry-run preview.
- Development Health recommendations become clickable and **navigate** to the owning manager tab. They do not execute. Execution stays anchored next to the cache path, its size, and the button, because the figure's provenance matters and the user needs all three in one view.
- Yarn 2+ gets a cleanup affordance despite `ManagerStatus::Unsupported`, which only denies a global package listing. If berry's `yarn cache clean` fails because the app sets no cwd, the existing failure path reports stderr faithfully — do not pre-detect this.
- Refresh via the existing `refresh(managerId)`, which already bumps tokens, rescans, re-measures path sizes, and re-hydrates the Homebrew cleanup preview and pip outdated. Development Health recomputes automatically through `App.tsx`'s `useMemo`.
- Preserve pending state and duplicate-submission prevention.

### Docker

- `docker builder prune -f` then `docker image prune -f`. Never `-a`, never `system prune`, never `--volumes`. Containers and volumes are never touched.
- Dangling images qualify because Docker itself guarantees they carry no tag and no container reference — a structural orphan, a stronger safety case than the Cellar old versions already accepted for Homebrew.

## Testing Decisions

- Tests assert external behavior: the exact command each plan runs, that no other command is reachable, that confirmation gates execution, and that results are reported honestly.
- Rust: one table-driven test asserting exact `(program, args)` for all 8 plans. A test asserting nvm/Maven/Cargo resolve to no plan. Tests that `uv` args never contain `--force` and Docker args never contain `-a` or `system`.
- Rust: fake-runner tests for multi-step plans covering all-succeed, first-step-fails, and second-step-fails, asserting the partial-completion distinction. Explicitly cover npm's "cache cleaned but `_npx` deletion failed" case, which today reports a misleading outright failure.
- Rust: `_npx` guardrail tests — relative path rejected, empty `npm config get cache` rejected, wrong basename rejected, valid path accepted.
- Rust: assert the runner receives structured args, never a shell string.
- Rust: assert cleanup steps use the 300-second timeout and uninstall still uses 30 seconds.
- Rust: pip cleanup resolves its interpreter internally and the command takes the `<python> -m pip cache purge` form.
- Frontend: per-manager confirmation gating, cancel executing nothing, pending state, duplicate-click prevention, success and failure feedback, refresh after success.
- Frontend: the dialog shows an exact figure for Homebrew, a reclaimable figure for Docker, path usage for full-clear managers, and **no figure** for pnpm and uv.
- Frontend: partial completion renders as partial, not as failure.
- Frontend: no cleanup affordance renders for nvm, Maven, or Cargo.
- Frontend: Yarn 2+ renders a cleanup affordance despite `Unsupported`.
- Frontend: Development Health recommendations navigate and do not execute.
- Existing tests must keep passing unchanged: path-size semantics (`Cache` counted, `NpxCache` not counted separately), hardlink dedup, npm/pnpm uninstall behavior, pip outdated hydration tokens.
- Regression: `pnpm test`, `pnpm build`, `cd src-tauri && cargo test`.
- Manual: clean each of the 8 managers, confirm usage refreshes; confirm Docker cleanup with the daemon stopped surfaces a real error; confirm nvm/Maven/Cargo show no affordance; confirm a manager that is not installed offers nothing.

## Out of Scope

- Uninstalling global packages for managers beyond the existing npm/pnpm support.
- Cleanup for nvm, Maven, and Cargo (ADR-0001).
- Any new guarded deletion beyond `_npx`.
- Batch or one-click cleanup across managers. Widest blast radius per misclick, and the provenance-specific figures decided above cannot survive a combined dialog — it would degrade to one aggregate number, i.e. the black-box confirmation rejected for single managers, scaled up 8×.
- An operation log or audit trail. Cleanup is scoped to self-healing derived data, so after-the-fact forensics buys no safety.
- Undo. Cache is re-downloadable by definition.
- `docker image prune -a`, `docker system prune`, volume or container removal.
- Passing `--force` to uv.
- Per-package cache size analysis.
- Cleaning `_npx` independently of npm cache.
- `pip cache remove <pattern>` for selective removal.
- Modifying any manager's configuration.
- Executing cleanup from the Development Health page.
- Background or scheduled cleanup.

## Further Notes

This supersedes the guidance in `.scratch/npm-package-cache-actions/PRD.md`, which said further managers should get separate PRDs "because each manager has different destructive command semantics". That reasoning holds for uninstall — `npm uninstall -g`, `brew uninstall`, and `cargo uninstall` genuinely differ in behavior and risk. It does not hold for cache cleanup, where the semantics converged: all 8 managers reduce to "ask the manager's CLI to clean its own cache", which is exactly why a single static table covers them. The residual divergence (Homebrew's extra scope, uv's prune choice, Docker's two steps, three figure-presentation modes) has been resolved centrally and recorded in ADR-0001, ADR-0002, and this PRD.

Splitting this into per-manager PRDs would restate the safety model 8 times, and restatement drifts — which is the exact failure the single-table decision exists to prevent.

Two ADRs govern this work and should be read before changing its shape:

- `docs/adr/0001-delegated-cache-cleanup.md` — why deletion is always delegated, and why nvm/Maven/Cargo are permanently excluded.
- `docs/adr/0002-homebrew-cleanup-exceeds-cache-scope.md` — why Homebrew is knowingly allowed to exceed the cache-only scope.

`CONTEXT.md` defines the vocabulary this PRD uses, including the distinction between 清理 and 卸载, and the correction that `ManagerStatus::Unsupported` denies only a global package listing.

## Comments

- All 10 issues complete. 8 of 11 managers have cleanup; nvm, Maven and Cargo are permanently excluded per ADR-0001.
- Verified with `cargo test` (74 passed), `pnpm test` (73 passed), `pnpm build`, `cargo fmt`, no compiler warnings.
- Deviations from the PRD as written, all recorded in the owning issue: the request kinds `cleanCache`/`storePrune` were merged into one `cleanupCache` + `managerId` (issue 03); Docker shows per-resource-type reclaimable rows rather than one aggregate figure (issue 08); most of issue 09 turned out to already exist.
- Blast radius was analysed by grep for every slice, and recorded per issue.
- Four entry-point shapes emerged rather than the one the PRD implied: inline path card (npm/pnpm/Yarn/Bun/uv), stacked path card (pip), dedicated dry-run card (Homebrew), resource summary panel (Docker). All four read from the same `cleanupCopy` table and call the same `run_cache_cleanup(managerId)`.
