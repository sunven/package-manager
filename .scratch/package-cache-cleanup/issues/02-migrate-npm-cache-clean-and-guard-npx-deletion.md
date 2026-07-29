Status: ready-for-agent

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

- [ ] `CleanCache` is removed from `NpmMaintenanceOperation` and npm's plan lives in the static table.
- [ ] npm's plan is: `npm cache clean --force`, then guarded deletion of `_npx`.
- [ ] `NpmMaintenanceOperation::UninstallGlobalPackage` and its command are unchanged, still at a 30-second timeout.
- [ ] Before deleting, the guarded deletion asserts the path is absolute.
- [ ] It asserts the path is prefixed by the value returned by `npm config get cache`.
- [ ] It asserts the path's basename is exactly `_npx`.
- [ ] Any failed assertion reports a failure instead of proceeding with the deletion.
- [ ] `npm config get cache` returning an empty string cannot produce a deletion.
- [ ] A successful `npm cache clean --force` followed by a failed `_npx` deletion reports **partially completed**, naming the step that ran and the step that failed — not outright failure.
- [ ] `NpxCache` remains visible under npm cache context and remains excluded from separately counted totals.
- [ ] Guardrail tests cover: relative path rejected, empty `npm config get cache` rejected, wrong basename rejected, valid path accepted.
- [ ] Existing npm uninstall tests pass unchanged.
- [ ] `cargo test` passes.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
