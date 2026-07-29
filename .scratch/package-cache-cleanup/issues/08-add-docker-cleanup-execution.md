Status: ready-for-agent

# Add Docker Cleanup as a Two-Step Build Cache and Dangling Image Prune

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

Docker is the only manager whose plan is genuinely multi-step, so it is the real exercise of the step-sequence and partial-completion machinery from issue 01.

The plan is `docker builder prune -f`, then `docker image prune -f`. Build cache is pure derived data. Dangling images qualify because Docker itself guarantees they carry no tag and no container reference — a structural orphan, which is a stronger safety case than the Cellar old versions already accepted for Homebrew in ADR-0002.

**Hard boundaries.** Never `-a` on `image prune` (that removes tagged images not currently referenced by a container, including ones the user deliberately pulled). Never `docker system prune`. Never `--volumes`. Containers and volumes are never touched under any circumstance.

The dialog figure comes from `docker system df` reclaimable, already captured at scan time in `DockerDiskUsageRow.reclaimable`. Note this figure covers more resource types than the plan actually prunes, so present it as reclaimable space reported by Docker rather than implying the plan will reclaim all of it.

Partial completion matters most here. If `builder prune` succeeds and `image prune` fails, the user must be told build cache was reclaimed and image pruning was not — otherwise they retry and cannot tell what already happened. The most likely failure is a stopped Docker daemon, which will fail the first step; execution stops there rather than hitting the same wall twice.

This also makes actionable the `docker-cleanup-signals` recommendation that `developmentHealth.ts:279` already computes from `danglingImageCount` and `unusedImageCount`.

## Acceptance criteria

- [ ] Docker's plan is exactly two steps: `docker builder prune -f`, then `docker image prune -f`.
- [ ] The args contain no `-a` or `--all`.
- [ ] The args contain no `system`.
- [ ] The args contain no `--volumes`.
- [ ] No step removes containers or volumes.
- [ ] A cleanup affordance appears in the Docker view.
- [ ] The confirmation dialog shows the `docker system df` reclaimable figure.
- [ ] The dialog makes clear the figure is Docker's reported reclaimable space, not a promise that the plan reclaims all of it.
- [ ] The dialog states that build cache and dangling images will be removed, and that tagged images, containers, and volumes will not.
- [ ] The dialog shows both command texts that will run.
- [ ] Confirming executes the plan; cancelling executes nothing.
- [ ] `builder prune` succeeding and `image prune` failing reports **partially completed**, naming which step reclaimed space and which failed.
- [ ] `builder prune` failing stops execution; `image prune` does not run.
- [ ] A stopped Docker daemon produces a useful error rather than a generic failure.
- [ ] Pending state is shown and duplicate submissions are prevented.
- [ ] Success refreshes Docker so image/container/volume counts and disk usage rows update.
- [ ] Failure surfaces the underlying error without hiding existing Docker scan data.
- [ ] No affordance renders when Docker is `Missing`.
- [ ] Table-driven Rust tests assert the exact `(program, args)` of both steps and the absence of `-a`, `system`, and `--volumes`.
- [ ] Fake-runner tests cover both-succeed, first-fails, and second-fails, asserting the reported state in each case.
- [ ] A frontend test asserts partial completion renders as partial, not as failure.
- [ ] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/02-migrate-npm-cache-clean-and-guard-npx-deletion.md
