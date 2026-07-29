Status: ready-for-agent

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

- [ ] `run_cache_cleanup` is registered in `invoke_handler` and accepts only a `ManagerId`.
- [ ] The manager-to-plan mapping is a single static table in Rust; no plan is constructed from frontend input.
- [ ] A plan is a step sequence supporting two step kinds: allowlisted command, and guarded directory deletion.
- [ ] `Nvm`, `Maven`, and `Cargo` resolve to "no cleanup plan", returned as a distinguishable outcome rather than an error.
- [ ] Cleanup command steps run with a 300-second timeout.
- [ ] Existing scan timeouts (5–15s) are unchanged.
- [ ] Existing `UninstallGlobalPackage` operations remain on their existing commands at a 30-second timeout, untouched.
- [ ] Execution stops at the first failing step; later steps do not run.
- [ ] The result carries per-step outcomes and an overall state distinguishing fully succeeded, partially completed, and failed outright.
- [ ] `ManagerStatus::Partial` is not reused for cleanup outcomes.
- [ ] The runner receives structured args, never a shell string.
- [ ] A table-driven test asserts the exact `(program, args)` for every populated plan.
- [ ] A test asserts `Nvm`, `Maven`, and `Cargo` have no plan, so a future contributor cannot quietly grant them one.
- [ ] Fake-runner tests cover a multi-step plan where all steps succeed, where the first step fails, and where a later step fails, asserting the partial-completion distinction in each case.
- [ ] A test asserts cleanup steps use the 300-second timeout.
- [ ] `cargo test` passes.

## Blocked by

Nothing.
