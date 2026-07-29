Status: ready-for-agent

# Add Yarn and Bun Cache Cleanup

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

The two simplest full-clear plans, which also establish the **full-clear** dialog presentation: `yarn cache clean` and `bun pm cache rm`, each a single step.

Because both commands empty their cache directory outright, the already-measured cache path usage *is* the amount reclaimed. Full-clear managers therefore show that figure in the confirmation dialog — unlike prune-type managers, here the number is honest.

Yarn needs one deliberate decision honored: **Yarn 2+ gets a cleanup affordance even though `ManagerStatus::Unsupported`**. That status only denies a global package listing — `scan_yarn_modern` (`node.rs:207`) still resolves `PathKind::Cache` and measures it. Withholding the button would produce an absurd screen: "缓存 3.2 GB" displayed with no way to act, for a reason (no package listing) unrelated to what the user wants to do.

Yarn 2+ commands typically require running inside a Yarn project, and this app sets no cwd (`command.rs:88` has no `.current_dir()`), so berry's `yarn cache clean` may fail. **Do not pre-detect this.** A non-zero exit flows through the existing failure path and the dialog reports stderr faithfully, which is correct behavior. This was not verifiable locally — the machine has Yarn 1.22.22.

## Acceptance criteria

- [ ] Yarn's plan is a single `yarn cache clean` step.
- [ ] Bun's plan is a single `bun pm cache rm` step.
- [ ] Both expose a cleanup affordance on their cache path card, following the existing `PathPanel` pattern.
- [ ] The Yarn affordance renders when the manager status is `Unsupported` (Yarn 2+).
- [ ] The Yarn affordance renders for Yarn Classic.
- [ ] No cwd detection or berry pre-check is added; a failing berry command reports its stderr through the existing failure path.
- [ ] Both confirmation dialogs show the measured cache path usage as the reclaimable figure.
- [ ] Both dialogs show the command text that will run.
- [ ] Confirming executes the plan; cancelling executes nothing.
- [ ] Pending state is shown and duplicate submissions are prevented.
- [ ] Success refreshes the manager so displayed cache usage updates.
- [ ] Failure surfaces the underlying error without hiding existing scan data.
- [ ] Neither affordance renders when the manager is `Missing`.
- [ ] Table-driven Rust tests assert the exact `(program, args)` for both plans.
- [ ] A frontend test asserts the Yarn affordance renders despite `Unsupported`.
- [ ] A frontend test asserts the full-clear dialogs render a figure.
- [ ] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/03-migrate-pnpm-store-prune-with-prune-dialog-copy.md
