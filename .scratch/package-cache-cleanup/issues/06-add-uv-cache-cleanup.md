Status: ready-for-agent

# Add uv Cache Cleanup Using Prune Without `--force`

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

uv's plan is a single `uv cache prune` step. Two constraints on it are deliberate and must not be "improved" later.

**Use `prune`, not `clean`.** `uv cache clean` empties the cache including entries still referenced by existing environments, forcing re-downloads; `uv cache prune` removes only unreachable objects. Choosing prune keeps uv consistent with pnpm, where the app already chose `pnpm store prune` over wiping the store. Picking `clean` would make uv the only manager that discards cache still in use.

**Never pass `--force`.** Both `uv cache clean` and `uv cache prune` accept `--force`, documented as "Force removal of the cache, ignoring in-use checks" — meaning uv performs an in-use check by default. That check is one of only two native safety nets across all 8 managers (the other being Homebrew's dry-run). Bypassing a free safety net has no justification.

uv is prune-type, so it reuses the presentation established for pnpm: **no figure**, plus an explanation that only unreferenced content is removed. The measured `PathKind::UvCache` usage would severely over-estimate what prune reclaims.

## Acceptance criteria

- [ ] uv's plan is a single `uv cache prune` step.
- [ ] The args contain no `--force`.
- [ ] The args contain no `clean`.
- [ ] The args contain no `--ci`.
- [ ] A cleanup affordance appears on uv's cache path card.
- [ ] The confirmation dialog shows **no** reclaimable-space figure.
- [ ] The dialog explains that only unreferenced cache content is removed and the actual amount depends on current references.
- [ ] The dialog shows the command text that will run.
- [ ] Confirming executes the plan; cancelling executes nothing.
- [ ] Pending state is shown and duplicate submissions are prevented.
- [ ] Success refreshes uv so the displayed cache usage updates.
- [ ] Failure surfaces the underlying error without hiding existing uv scan data.
- [ ] No affordance renders when uv is `Missing`.
- [ ] A Rust test asserts the exact `(program, args)` and that `--force` is absent.
- [ ] A frontend test asserts no figure is rendered in the uv dialog.
- [ ] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/03-migrate-pnpm-store-prune-with-prune-dialog-copy.md
