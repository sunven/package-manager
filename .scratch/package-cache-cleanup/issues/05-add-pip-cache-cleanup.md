Status: ready-for-agent

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

- [ ] pip's plan is a single step of the form `<python> -m pip cache purge`.
- [ ] The interpreter is resolved inside the cleanup handler using the same logic as the scan, including the `python3` → `python` fallback.
- [ ] `run_cache_cleanup`'s signature still accepts only a `ManagerId`; no interpreter parameter is added.
- [ ] No backend state is introduced to carry the scan's resolved interpreter.
- [ ] A cleanup affordance appears on pip's cache path card.
- [ ] The confirmation dialog shows the measured pip cache path usage as the reclaimable figure.
- [ ] The dialog shows the command text that will run.
- [ ] Confirming executes the plan; cancelling executes nothing.
- [ ] Pending state is shown and duplicate submissions are prevented.
- [ ] Success refreshes pip so the displayed cache usage updates.
- [ ] Failure surfaces the underlying error without hiding existing pip scan data.
- [ ] Failed interpreter resolution reports a useful failure rather than running a partial command.
- [ ] No affordance renders when pip is `Missing`.
- [ ] A Rust test asserts the command takes the `<python> -m pip cache purge` form with structured args.
- [ ] A Rust test asserts the interpreter is resolved internally, not supplied by the caller.
- [ ] `pip cache remove <pattern>` is not implemented.
- [ ] Existing pip scan, inspect, and outdated-hydration tests pass unchanged.
- [ ] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/04-add-yarn-and-bun-cache-cleanup.md
