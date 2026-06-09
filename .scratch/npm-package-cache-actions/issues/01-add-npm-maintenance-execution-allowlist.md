Status: done

# Add npm Maintenance Execution Allowlist

## Parent

.scratch/npm-package-cache-actions/PRD.md

## What to build

Add an explicit backend execution path for npm maintenance operations. The app should be able to request only two npm operations: uninstall a selected global package and clean npm cache. The execution entrypoint must accept structured operation data, not an arbitrary command string, and must invoke npm with structured arguments.

This slice should make direct npm maintenance possible without exposing general command execution. It does not need to add final UI buttons yet, but it must provide the backend contract that the UI slices can call.

## Acceptance criteria

- [x] The backend exposes an npm maintenance execution operation for global package uninstall.
- [x] The backend executes package uninstall as npm with global uninstall arguments and the selected package name.
- [x] Scoped package names are passed correctly as a single structured argument.
- [x] The backend exposes an npm maintenance execution operation for cache clean.
- [x] The backend executes cache clean as npm with cache clean and force arguments.
- [x] The frontend cannot pass an arbitrary program, shell string, or arbitrary args through this npm maintenance API.
- [x] Successful operations return enough structured result information for the UI to show success and decide what to refresh.
- [x] Failed operations return enough failure information for the UI to show a useful error message.
- [x] Normal npm scan behavior remains read-only and does not execute uninstall or cache clean.
- [x] Rust tests cover successful uninstall, failed uninstall, scoped package uninstall, successful cache clean, failed cache clean, and the absence of arbitrary command execution.

## Blocked by

None - can start immediately
## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
