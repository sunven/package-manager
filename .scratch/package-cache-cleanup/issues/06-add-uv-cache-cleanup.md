Status: done

# Add uv Cache Cleanup Using Prune Without `--force`

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

uv's plan is a single `uv cache prune` step. Two constraints on it are deliberate and must not be "improved" later.

**Use `prune`, not `clean`.** `uv cache clean` empties the cache including entries still referenced by existing environments, forcing re-downloads; `uv cache prune` removes only unreachable objects. Choosing prune keeps uv consistent with pnpm, where the app already chose `pnpm store prune` over wiping the store. Picking `clean` would make uv the only manager that discards cache still in use.

**Never pass `--force`.** Both `uv cache clean` and `uv cache prune` accept `--force`, documented as "Force removal of the cache, ignoring in-use checks" — meaning uv performs an in-use check by default. That check is one of only two native safety nets across all 8 managers (the other being Homebrew's dry-run). Bypassing a free safety net has no justification.

uv is prune-type, so it reuses the presentation established for pnpm: **no figure**, plus an explanation that only unreferenced content is removed. The measured `PathKind::UvCache` usage would severely over-estimate what prune reclaims.

## Acceptance criteria

- [x] uv's plan is a single `uv cache prune` step.
- [x] The args contain no `--force`.
- [x] The args contain no `clean`.
- [x] The args contain no `--ci`.
- [x] A cleanup affordance appears on uv's cache path card.
- [x] The confirmation dialog shows **no** reclaimable-space figure.
- [x] The dialog explains that only unreferenced cache content is removed and the actual amount depends on current references.
- [x] The dialog shows the command text that will run.
- [x] Confirming executes the plan; cancelling executes nothing.
- [x] Pending state is shown and duplicate submissions are prevented.
- [x] Success refreshes uv so the displayed cache usage updates.
- [x] Failure surfaces the underlying error without hiding existing uv scan data.
- [x] No affordance renders when uv is `Missing`.
- [x] A Rust test asserts the exact `(program, args)` and that `--force` is absent.
- [x] A frontend test asserts no figure is rendered in the uv dialog.
- [x] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/03-migrate-pnpm-store-prune-with-prune-dialog-copy.md

## Comments

- The smallest slice: uv's plan and its `--force`/`clean`/`--ci` assertions already landed in issue 01, and the prune-type dialog presentation already landed in issue 03, so this was a `cleanupCopy.ts` entry plus tests.
- uv renders three inline path cards, and only one of them is derived data. Tests assert the affordance appears on `UvCache` and **not** on `UvTools` or `UvPythonInstallations` — those hold tools and Python runtimes the user installed, so a cleanup button next to them would invite exactly the kind of loss ADR-0001 exists to prevent.
- uv is prune-type: no reclaim figure, and a note that the amount depends on current references. The uv cache directory size would badly over-promise what `prune` actually frees.
- The dialog description states that `--force` is not passed, so the user can see that uv's own in-use check is left intact rather than having to trust it.
- Verified with `cargo test` (74 passed), `pnpm test` (51 passed, 3 new), `pnpm build`, no warnings.
- Test teeth verified by mutation on both sides: giving uv a `reclaimSource` failed the prune-semantics test, and swapping the Rust plan to `cache clean --force` failed 2 Rust tests. Both reverted.
