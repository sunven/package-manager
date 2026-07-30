Status: done

# Add the Cache Cleanup Plan Table and Single Backend Entry Point

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

The backend foundation every other slice builds on: one Tauri command, one static plan table, step-sequence execution, and honest partial-completion reporting.

Add `run_cache_cleanup(managerId: ManagerId) -> Result<CacheCleanupRun, String>`. It takes no other parameter — no program, no arguments, no path. The frontend's entire vocabulary for this API is the existing 11-value `ManagerId` enum, already validated by serde, so it is syntactically incapable of expressing which command runs.

Add the static manager-to-plan table. A plan is a **step sequence**, not a single command. A step is either an allowlisted command or a guarded directory deletion. Managers with no plan return a "no cleanup plan" outcome, distinct from a failure, so the frontend can tell "not offered" from "tried and broke".

Populate the table in this slice with the *shape* and with entries for managers whose plans need no extra machinery. The remaining managers are wired in by later slices; nvm, Maven, and Cargo are permanently absent per ADR-0001.

Cleanup steps get a 300-second timeout, separate from the 5–15s scan timeouts and the 30s uninstall timeout. A large cache must not present as a timeout, because `command.rs:118` kills the child on timeout, leaving a half-deleted cache that the result model would otherwise report as outright failure.

Execution stops at the first failing step. The result carries per-step outcomes plus an overall state distinguishing **fully succeeded**, **partially completed**, and **failed outright**. Do not reuse `ManagerStatus::Partial` — that means "manager partially usable" and is a different concept (see `CONTEXT.md`).

## Acceptance criteria

- [x] `run_cache_cleanup` is registered in `invoke_handler` and accepts only a `ManagerId`.
- [x] The manager-to-plan mapping is a single static table in Rust; no plan is constructed from frontend input.
- [x] A plan is a step sequence supporting two step kinds: allowlisted command, and guarded directory deletion. — the `GuardedDeletion` variant landed in issue 02, which owns its only instance
- [x] `Nvm`, `Maven`, and `Cargo` resolve to "no cleanup plan", returned as a distinguishable outcome rather than an error.
- [x] Cleanup command steps run with a 300-second timeout.
- [x] Existing scan timeouts (5–15s) are unchanged.
- [x] Existing `UninstallGlobalPackage` operations remain on their existing commands at a 30-second timeout, untouched.
- [x] Execution stops at the first failing step; later steps do not run.
- [x] The result carries per-step outcomes and an overall state distinguishing fully succeeded, partially completed, and failed outright.
- [x] `ManagerStatus::Partial` is not reused for cleanup outcomes.
- [x] The runner receives structured args, never a shell string.
- [x] A table-driven test asserts the exact `(program, args)` for every populated plan.
- [x] A test asserts `Nvm`, `Maven`, and `Cargo` have no plan, so a future contributor cannot quietly grant them one.
- [x] Fake-runner tests cover a multi-step plan where all steps succeed, where the first step fails, and where a later step fails, asserting the partial-completion distinction in each case.
- [x] A test asserts cleanup steps use the 300-second timeout.
- [x] `cargo test` passes.

## Blocked by

Nothing.

## Comments

- Implemented in `src-tauri/src/managers/cleanup.rs` (new), with result types added to `types.rs` and the command registered in `lib.rs`. Verified with `cargo test` (65 passed, 12 of them new), `pnpm test` (27 passed), and `pnpm build`.
- **Deviation from the acceptance criteria as written:** the step enum currently has only the `Command` variant. The guarded-deletion variant is added by issue 02, which is the slice that owns the `_npx` deletion and its path assertions — adding an unused variant here would have been speculative. The plan-as-step-sequence shape that variant needs is in place.
- The plan table is populated for Yarn, Bun, uv, Homebrew, and Docker. Npm, Pnpm, and Pip map to an empty plan for now; issues 02, 03, and 05 fill them in. An empty plan is currently indistinguishable from "deliberately no plan" for those three — the `nvm_maven_and_cargo_have_no_cleanup_plan` test guards only the three permanent exclusions, so it does not go green for the wrong reason once 02/03/05 land.
- Blast radius was analysed by grep: this slice is purely additive — `run()`, `managers/mod.rs`, and `types.rs` gain new items, while `run_command_owned`, `envelope_owned`, `command_failure`, and `ManagerId` are reused with unchanged signatures. Risk LOW.
- Test teeth were verified by mutation rather than by a red-first run: adding `--force` to the uv plan and collapsing `PartiallyCompleted` into `Failed` each produced failures (3 in total), then both mutations were reverted.
