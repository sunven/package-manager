Status: done

# Migrate npm Cache Clean to the New Entry Point and Guard the `_npx` Deletion

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

Move npm's cache cleanup onto the new single entry point and close a real path-derivation hole in the one guarded deletion the app performs.

Migrate `CleanCache` out of `NpmMaintenanceOperation` into the plan table as npm's two-step plan: `npm cache clean --force`, then guarded deletion of `_npx`. `UninstallGlobalPackage` stays in `NpmMaintenanceOperation` on its existing command at its existing 30-second timeout — do not touch it. Leaving `CleanCache` behind would put npm cache cleanup on two code paths and defeat the single-entry design.

Add the path-identity assertions to the `_npx` deletion. Today `node.rs:527` derives the path as `npm config get cache` stdout joined with `_npx` and hands it straight to `remove_dir_all_if_exists` with **no validation**. If `npm config get cache` returns an empty string, `Path::new("").join("_npx")` yields the relative path `_npx`, which would delete a same-named directory under the process cwd. This is the app's only guarded-deletion exception (ADR-0001) and it must be narrow enough to be provable.

Fix the misleading report at `node.rs:471-491`: a failed `_npx` deletion currently returns outright failure even though `npm cache clean --force` already succeeded, so the dialog reads "npm 缓存清理失败" while the cache is in fact gone. Under the new result model this is **partially completed**.

`_npx` remains a child of npm cache for display and remains excluded from separately counted size totals — no change to size semantics.

## Acceptance criteria

- [x] `CleanCache` is removed from `NpmMaintenanceOperation` and npm's plan lives in the static table.
- [x] npm's plan is: `npm cache clean --force`, then guarded deletion of `_npx`.
- [x] `NpmMaintenanceOperation::UninstallGlobalPackage` and its command are unchanged, still at a 30-second timeout.
- [x] Before deleting, the guarded deletion asserts the path is absolute.
- [x] It asserts the path is prefixed by the value returned by `npm config get cache`.
- [x] It asserts the path's basename is exactly `_npx`.
- [x] Any failed assertion reports a failure instead of proceeding with the deletion.
- [x] `npm config get cache` returning an empty string cannot produce a deletion.
- [x] A successful `npm cache clean --force` followed by a failed `_npx` deletion reports **partially completed**, naming the step that ran and the step that failed — not outright failure.
- [x] `NpxCache` remains visible under npm cache context and remains excluded from separately counted totals.
- [x] Guardrail tests cover: relative path rejected, empty `npm config get cache` rejected, wrong basename rejected, valid path accepted.
- [x] Existing npm uninstall tests pass unchanged.
- [x] `cargo test` passes.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md

## Comments

- npm's cleanup now lives in the plan table as a two-step plan: `npm cache clean --force`, then the guarded `_npx` deletion. `CleanCache` is gone from `NpmMaintenanceOperation`, and `run_npm_maintenance_with_runner_and_cache_cleaner` / `npm_cache_path_for_clean` / `remove_dir_all_if_exists` were removed from `node.rs` (the deleter moved into `cleanup.rs`, which is now its only consumer). `UninstallGlobalPackage` is untouched at its 30-second timeout.
- The three path-identity assertions live in `assert_guarded_path`, and `npm_cache_root` rejects an empty or failed `npm config get cache` before a path is ever constructed. The previously unvalidated derivation could yield the relative path `_npx` and delete a same-named directory under the process cwd; two tests now cover that specific case, one of which asserts the deleter is never called at all.
- The misleading report is fixed end-to-end: a successful cache clean followed by a failed `_npx` deletion is `PartiallyCompleted`, and the UI names what ran and what did not instead of saying the cleanup failed.
- **Scope beyond the criteria as written:** the criteria are backend-only, but removing `CleanCache` from the enum breaks the frontend that invoked it, so the frontend was rewired in the same slice — `types.ts` operation types, the `run_cache_cleanup` call path in `usePackageManagers.ts`, and a new `warn` tone on `MaintenanceResult` for partial completion. Leaving that for a later slice would have shipped a broken app.
- Two Rust tests in `mod.rs` (`run_npm_maintenance_cleans_cache_with_force`, `run_npm_maintenance_removes_npx_cache_after_cleaning_npm_cache`) were deleted rather than ported: `cleanup.rs` now covers the same behaviour plus the guardrails, so keeping them would have been duplication against a deleted API.
- The three cleanup-reporting helpers were placed in `state.ts` rather than the hook, because the hook has no test harness and `state.ts` is this project's tested home for pure frontend state functions. Four frontend tests cover them.
- Verified with `cargo test` (71 passed), `pnpm test` (31 passed), `pnpm build`, and no compiler warnings after forcing a rebuild.
- Blast radius was analysed by grep: 6 sites for the `CleanCache` variant, 3 for the deleted cache-cleaner function, 2 Rust tests rewritten, plus the two frontend call sites. Risk MEDIUM — shipped, tested code across the Rust/TS boundary.
- Test teeth verified by mutation: short-circuiting `assert_guarded_path` to always return `Ok` failed 2 tests, including the relative-path case. Reverted.
