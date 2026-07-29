Status: ready-for-agent

# Migrate pnpm Store Prune to the New Entry Point with Prune-Type Dialog Copy

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

Move pnpm's store prune onto the new entry point, and establish the **prune-type** confirmation dialog presentation that uv will reuse.

Migrate `StorePrune` out of `PnpmMaintenanceOperation` into the plan table as a single-step plan running `pnpm store prune`. `UninstallGlobalPackage` stays in `PnpmMaintenanceOperation` on its existing command at its existing 30-second timeout.

The dialog change is the substantive part. `pnpm store prune` removes only content no longer referenced by any project, so the measured `PathKind::Store` usage is a **severe over-estimate** of what will be reclaimed. Showing that figure would teach the user the feature is broken when they see the store barely shrink. Prune-type managers therefore show **no figure** and instead explain that only unreferenced content is removed and that the actual amount depends on current references.

This slice also introduces the data-driven dialog copy that later slices extend. `MaintenanceConfirmationBanner` currently hardcodes copy in an if/else chain; with 8 managers arriving that becomes an 8-arm chain. Drive the copy from data instead. User-facing Chinese copy stays in TypeScript — only the plan table lives in Rust.

## Acceptance criteria

- [ ] `StorePrune` is removed from `PnpmMaintenanceOperation` and pnpm's plan lives in the static table as a single `pnpm store prune` step.
- [ ] `PnpmMaintenanceOperation::UninstallGlobalPackage` and its command are unchanged, still at a 30-second timeout.
- [ ] The pnpm confirmation dialog shows **no** reclaimable-space figure.
- [ ] The pnpm confirmation dialog explains that only unreferenced store content is removed and the actual amount depends on current references.
- [ ] The dialog still shows the command text that will run.
- [ ] Dialog copy is driven from data rather than an extended hardcoded if/else chain.
- [ ] Confirming executes the plan; cancelling executes nothing.
- [ ] Pending state is shown and duplicate submissions are prevented.
- [ ] Successful prune refreshes pnpm so the displayed store usage updates.
- [ ] Failure surfaces the underlying error without hiding existing pnpm scan data.
- [ ] Hardlink-deduplicated store size semantics are unchanged.
- [ ] Existing pnpm uninstall tests pass unchanged.
- [ ] A frontend test asserts no figure is rendered in the pnpm dialog.
- [ ] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
