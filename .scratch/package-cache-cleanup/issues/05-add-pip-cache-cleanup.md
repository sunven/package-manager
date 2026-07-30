Status: done

# Add pip Cache Cleanup with Backend-Resolved Interpreter

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

pip's plan is a single `<python> -m pip cache purge` step — but pip is the one manager that puts real pressure on the single-entry design, and resolving that pressure correctly is the point of this slice.

Every pip command takes the form `<python_executable> -m pip ...` (`pip.rs:27`), and `python_executable` is resolved dynamically at scan time via `python3 -c "import sys; print(sys.executable)"` with a `python3` → `python` fallback. So the static table cannot contain pip's `program` as a literal.

**Resolve the interpreter inside the cleanup handler**, reusing the scan's resolution logic. Do **not** accept it from the frontend. Adding an interpreter parameter would make the API accept an arbitrary program path from the frontend, which destroys the guarantee that the frontend cannot express which command runs — the entire basis of the safety model in ADR-0001 and issue 01. Do not cache the scan's resolution either; Tauri commands here are stateless and this manager is not worth breaking that.

Re-resolving is not merely an acceptable compromise, it is **more correct**: cleanup should act on the python environment in effect now, not the one that was in effect when the scan ran minutes ago.

pip is a full-clear manager — `pip cache purge` empties the wheel cache — so the dialog shows the measured cache path usage.

## Acceptance criteria

- [x] pip's plan is a single step of the form `<python> -m pip cache purge`.
- [x] The interpreter is resolved inside the cleanup handler using the same logic as the scan, including the `python3` → `python` fallback.
- [x] `run_cache_cleanup`'s signature still accepts only a `ManagerId`; no interpreter parameter is added.
- [x] No backend state is introduced to carry the scan's resolved interpreter.
- [x] A cleanup affordance appears on pip's cache path card.
- [x] The confirmation dialog shows the measured pip cache path usage as the reclaimable figure.
- [x] The dialog shows the command text that will run.
- [x] Confirming executes the plan; cancelling executes nothing.
- [x] Pending state is shown and duplicate submissions are prevented.
- [x] Success refreshes pip so the displayed cache usage updates.
- [x] Failure surfaces the underlying error without hiding existing pip scan data.
- [x] Failed interpreter resolution reports a useful failure rather than running a partial command.
- [x] No affordance renders when pip is `Missing`.
- [x] A Rust test asserts the command takes the `<python> -m pip cache purge` form with structured args.
- [x] A Rust test asserts the interpreter is resolved internally, not supplied by the caller.
- [x] `pip cache remove <pattern>` is not implemented.
- [x] Existing pip scan, inspect, and outdated-hydration tests pass unchanged.
- [x] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/04-add-yarn-and-bun-cache-cleanup.md

## Comments

- pip's plan is a new `CleanupStep::PipCommand` variant carrying only args. A third variant beat wrapping every existing entry's `program` in a `Literal(...)` enum — 7 entries would have gotten noisier to accommodate 1, and "pip has no fixed program" is genuinely pip-specific rather than a general mechanism.
- `resolve_python_for_cleanup` in `pip.rs` mirrors the scan's `python3` → `python` probe but without the `&mut ManagerSnapshot` the scan version needs for failure recording. `run_cache_cleanup`'s signature still takes only a `ManagerId`; no interpreter parameter was added, so the ADR-0001 guarantee holds. Four Rust tests cover the happy path, the `python` fallback, resolution failure (asserting pip never runs), and that the plan carries no caller-supplied program.
- The resolution targets `python3`/`python` rather than re-deriving `sys.executable` as the scan does. `python3 -m pip cache purge` and `<sys.executable> -m pip cache purge` address the same environment, and this costs one command instead of two.
- **pip exposed a structural gap the earlier managers hid.** pip has no inline path card — `splitPaths` has no `pipInlinePathKinds`, so its cache renders as a stacked `PathCard`, which had no cleanup affordance and did not even receive `managerId`. Any manager without inline paths would have silently shipped without a button. `PathCard` now takes the same `cleanupAvailable` / `managerId` / `onRequestCacheCleanup` / `pendingMaintenance` props as `InlinePathCell` and renders the affordance from the same copy table. This unblocks issue 07 (Homebrew) too.
- Chose to extend `PathCard` rather than add pip to the inline list: the inline layout is a compact multi-column grid and pip has a single cache path, so moving it there would have changed how pip's paths look for reasons unrelated to cleanup.
- Added a Maven regression test on the stacked card. Maven's local repository is often a user's largest directory and now renders next to pip's cache in the same card type, so an explicit test asserts it stays button-free per ADR-0001.
- Corrected a test assertion mid-flight: it checked for the raw path label `Local repository`, but `pathLabel()` renders it as 本地仓库. The button-absence half was always correct.
- Verified with `cargo test` (74 passed, 4 new), `pnpm test` (48 passed, 3 new), `pnpm build`, no warnings. `cargo fmt` applied.
- Test teeth verified by mutation: removing the stacked-card affordance failed the pip test. Reverted.
