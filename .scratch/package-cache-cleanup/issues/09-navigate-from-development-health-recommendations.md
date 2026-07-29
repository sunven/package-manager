Status: ready-for-agent

# Make Development Health Recommendations Navigate to Their Owning Manager

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

The Development Health page is where the user forms the intent to clean up — it ranks storage, sums `maintenanceBytes`, and lists recommendations carrying exact byte counts. Right now every one of those recommendations is a dead end, so the user has to remember which tab owns it.

Make recommendations clickable, navigating to the owning manager's tab. **They do not execute.** Execution stays anchored beside the cache path, its measured size, and the cleanup button, because the confirmation figure's provenance differs per manager (exact dry-run for Homebrew, Docker-reported reclaimable for Docker, path usage for full-clear, none for prune-type) and the user needs all three in one view to judge it. Firing a confirmation dialog from the health page would divorce it from the data justifying it.

`HealthRecommendation` already carries the manager identity needed to route. Recommendations for managers with no cleanup plan (nvm, Maven, Cargo) still navigate — landing on the tab to inspect usage is useful even when no cleanup is offered.

No batch or one-click cleanup. Per the PRD, that is the widest blast radius per misclick, and the provenance-specific figures cannot survive a combined dialog — it would degrade to one aggregate number, which is exactly the black-box confirmation rejected for individual managers, scaled up 8×.

## Acceptance criteria

- [ ] Development Health recommendations are clickable.
- [ ] Clicking a recommendation selects the owning manager's tab.
- [ ] Clicking a recommendation executes no backend operation and opens no confirmation dialog.
- [ ] Recommendations for nvm, Maven, and Cargo navigate normally.
- [ ] No batch or "clean everything" affordance is added.
- [ ] Keyboard activation works, and the clickable element carries an accessible label naming the destination.
- [ ] Existing recommendation ordering, deduplication (`uniqueRecommendations`), and the 5-item cap are unchanged.
- [ ] Existing `maintenanceBytes` and `totalBytes` computation is unchanged.
- [ ] A frontend test asserts clicking a recommendation changes the selected manager.
- [ ] A frontend test asserts clicking a recommendation triggers no cleanup invocation.
- [ ] Existing `developmentHealth` tests pass unchanged.
- [ ] `pnpm test` passes.

## Blocked by

- .scratch/package-cache-cleanup/issues/07-add-homebrew-cleanup-execution.md
- .scratch/package-cache-cleanup/issues/08-add-docker-cleanup-execution.md
