mod bun;
mod cargo;
mod cleanup;
mod docker;
mod homebrew;
mod maven;
mod node;
mod pip;
mod scan_support;
#[cfg(test)]
mod test_support;
mod uv;

use crate::types::{ManagerId, ManagerScanSnapshot, ManagerSnapshot};
use std::time::Instant;

pub(crate) use cleanup::run_cache_cleanup_with_runner;
pub(crate) use homebrew::hydrate_homebrew_cleanup_with_runner;
pub(crate) use node::{run_npm_maintenance_with_runner, run_pnpm_maintenance_with_runner};
pub(crate) use pip::hydrate_pip_outdated_with_runner;

pub(crate) fn scan_manager_snapshot(manager: ManagerId) -> ManagerScanSnapshot {
    let started = Instant::now();
    let manager = scan_single_manager(manager);

    ManagerScanSnapshot {
        scan_duration_ms: started.elapsed().as_millis(),
        manager,
    }
}

fn scan_single_manager(manager: ManagerId) -> ManagerSnapshot {
    match manager {
        ManagerId::Npm => node::scan_npm(),
        ManagerId::Pnpm => node::scan_pnpm(),
        ManagerId::Yarn => node::scan_yarn(),
        ManagerId::Nvm => node::scan_nvm(),
        ManagerId::Homebrew => homebrew::scan_homebrew(),
        ManagerId::Maven => maven::scan_maven(),
        ManagerId::Pip => pip::scan_pip(),
        ManagerId::Cargo => cargo::scan_cargo(),
        ManagerId::Docker => docker::scan_docker(),
        ManagerId::Bun => bun::scan_bun(),
        ManagerId::Uv => uv::scan_uv(),
    }
}
