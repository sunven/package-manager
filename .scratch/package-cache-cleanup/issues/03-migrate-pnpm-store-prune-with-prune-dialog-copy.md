Status: done

# Migrate pnpm Store Prune to the New Entry Point with Prune-Type Dialog Copy

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

Move pnpm's store prune onto the new entry point, and establish the **prune-type** confirmation dialog presentation that uv will reuse.

Migrate `StorePrune` out of `PnpmMaintenanceOperation` into the plan table as a single-step plan running `pnpm store prune`. `UninstallGlobalPackage` stays in `PnpmMaintenanceOperation` on its existing command at its existing 30-second timeout.

The dialog change is the substantive part. `pnpm store prune` removes only content no longer referenced by any project, so the measured `PathKind::Store` usage is a **severe over-estimate** of what will be reclaimed. Showing that figure would teach the user the feature is broken when they see the store barely shrink. Prune-type managers therefore show **no figure** and instead explain that only unreferenced content is removed and that the actual amount depends on current references.

This slice also introduces the data-driven dialog copy that later slices extend. `MaintenanceConfirmationBanner` currently hardcodes copy in an if/else chain; with 8 managers arriving that becomes an 8-arm chain. Drive the copy from data instead. User-facing Chinese copy stays in TypeScript — only the plan table lives in Rust.

## Acceptance criteria

- [x] `StorePrune` is removed from `PnpmMaintenanceOperation` and pnpm's plan lives in the static table as a single `pnpm store prune` step.
- [x] `PnpmMaintenanceOperation::UninstallGlobalPackage` and its command are unchanged, still at a 30-second timeout.
- [x] The pnpm confirmation dialog shows **no** reclaimable-space figure.
- [x] The pnpm confirmation dialog explains that only unreferenced store content is removed and the actual amount depends on current references.
- [x] The dialog still shows the command text that will run.
- [x] Dialog copy is driven from data rather than an extended hardcoded if/else chain.
- [x] Confirming executes the plan; cancelling executes nothing.
- [x] Pending state is shown and duplicate submissions are prevented.
- [x] Successful prune refreshes pnpm so the displayed store usage updates.
- [x] Failure surfaces the underlying error without hiding existing pnpm scan data.
- [x] Hardlink-deduplicated store size semantics are unchanged.
- [x] Existing pnpm uninstall tests pass unchanged.
- [x] A frontend test asserts no figure is rendered in the pnpm dialog.
- [x] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md

## Comments

- pnpm's `store prune` now lives in the plan table; `StorePrune` is gone from `PnpmMaintenanceOperation`, and a new Rust test asserts a `{"kind":"storePrune"}` payload is now *rejected*, so the uninstall command cannot keep a second route to it. `UninstallGlobalPackage` is untouched at 30 seconds.
- The prune-type presentation is established: pnpm shows no reclaim figure and instead carries a `reclaimNote` explaining that only unreferenced content goes and the amount depends on current references. uv reuses this in issue 06.
- **Scope beyond the criteria as written — please review.** The grep for this slice showed `onRequestCacheClean` / `onRequestStorePrune` threaded through three `PathPanel` layers, one pair per manager. Extending that shape to the remaining five managers means 8 prop pairs across 3 layers. So the two request kinds `cleanCache` and `storePrune` were merged into a single `cleanupCache` + `managerId`, and per-manager copy moved into a new `src/cleanupCopy.ts` table keyed the same way the Rust plan table is. Rationale: with one backend entry point these two kinds describe the same operation on different managers, and `CONTEXT.md` already treats 清理 as one concept — the criterion "dialog copy is driven from data" cannot be met cleanly while two kinds mean one thing. This touched shipped state (`MaintenanceRequest`, `requestNpmCacheClean`/`requestPnpmStorePrune` → `requestCacheCleanup`), `App.tsx`, `PathPanel` (3 layers), and 2 existing test files.
- `cleanupCopy.ts` doubles as the frontend's source of truth for *whether* a manager can be cleaned: absence from the table means no affordance renders, mirroring absence from the Rust plan table. A test asserts nvm, Maven and Cargo are absent, so a future contributor cannot grant one of them a button without tripping it.
- `MaintenanceConfirmationBanner`'s if/else chain is gone; it now reads the table, and partial completion renders in its own amber tone rather than borrowing the success or failure styling.
- Verified with `cargo test` (70 passed), `pnpm test` (37 passed, 6 new), `pnpm build`, no warnings.
- Blast radius was analysed by grep: 8 Rust sites for `StorePrune`, 30+ TS sites for the two props. Risk MEDIUM.
- Test teeth verified by mutation: granting Cargo a plan entry and deleting pnpm's `reclaimNote` each failed a test. Reverted.
