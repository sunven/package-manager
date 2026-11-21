use super::*;
use crate::command::run_command;
use crate::project_scan_history::{
    CandidateKey, MeasurementState, ProjectScanHistoryState, ProjectScanRecord,
    ProjectScanRecordDraft,
};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Debug, Clone)]
pub(super) struct ActiveScan {
    id: String,
    stop: Arc<AtomicBool>,
    finalizing: bool,
}

impl ActiveScan {
    pub(super) fn stopped(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }
}

struct ScanGuard<'a> {
    state: &'a ProjectCleanupState,
    id: String,
}

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.state.lock() {
            if registry
                .active_scan
                .as_ref()
                .is_some_and(|scan| scan.id == self.id)
            {
                registry.active_scan = None;
                if registry.pending_scan_id.as_deref() == Some(&self.id) {
                    registry.pending_scan_id = None;
                }
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub(crate) enum ProjectScanProgress {
    Started {
        #[serde(rename = "scanId")]
        scan_id: String,
    },
    Discovered {
        scan: Box<ProjectDataScan>,
    },
    Measured {
        #[serde(rename = "candidateId")]
        candidate_id: String,
        measurement: DirectoryMeasurement,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectScanSummary {
    pub(crate) scan_id: String,
    pub(crate) finish: MeasurementState,
    pub(crate) finished_at: u64,
    pub(crate) record: Option<ProjectScanRecord>,
    pub(crate) history_warning: Option<String>,
}

pub(crate) fn request_stop(state: &ProjectCleanupState, scan_id: &str) -> Result<(), String> {
    let registry = state.lock()?;
    if registry.active_batch.is_some() {
        return Err("项目清理批次仍在执行，暂不能停止扫描".into());
    }
    if let Some(scan) = registry
        .active_scan
        .as_ref()
        .filter(|scan| scan.id == scan_id)
    {
        if !scan.finalizing {
            scan.stop.store(true, Ordering::Release);
        }
    }
    Ok(())
}

pub(crate) fn run(
    state: &ProjectCleanupState,
    history: &ProjectScanHistoryState,
    root_id: &str,
    max_depth: u8,
    progress: &(dyn Fn(ProjectScanProgress) + Sync),
) -> Result<ProjectScanSummary, String> {
    run_with(
        state,
        root_id,
        max_depth,
        progress,
        &discover_project_data_until,
        &measure_project_data_until,
        &probe_tool,
        &|draft| history.record(draft),
    )
}

fn run_with<D, M, P, R>(
    state: &ProjectCleanupState,
    root_id: &str,
    max_depth: u8,
    progress: &(dyn Fn(ProjectScanProgress) + Sync),
    discover: &D,
    measure: &M,
    probe: &P,
    record: &R,
) -> Result<ProjectScanSummary, String>
where
    D: Fn(&Path, u8, &dyn Fn() -> bool) -> Option<Discovery>,
    M: Fn(ProjectDataKind, &Path, &dyn Fn() -> bool) -> Option<DirectoryMeasurement> + Sync,
    P: Fn(&str) -> (bool, Option<String>),
    R: Fn(ProjectScanRecordDraft) -> Result<ProjectScanRecord, String>,
{
    let (root_path, max_depth, scan_id, preset_id, stop) = {
        let mut registry = state.lock()?;
        if registry.active_scan.is_some() || registry.active_batch.is_some() {
            return Err("项目扫描或清理批次仍在执行".into());
        }
        let (path, depth, id) = registry.prepare_scan(root_id, max_depth)?;
        let stop = Arc::new(AtomicBool::new(false));
        registry.active_scan = Some(ActiveScan {
            id: id.clone(),
            stop: stop.clone(),
            finalizing: false,
        });
        (path, depth, id, registry.active_preset_id.clone(), stop)
    };
    let _guard = ScanGuard {
        state,
        id: scan_id.clone(),
    };
    progress(ProjectScanProgress::Started {
        scan_id: scan_id.clone(),
    });
    let stopped = || stop.load(Ordering::Acquire);
    let stopped_summary = || ProjectScanSummary {
        scan_id: scan_id.clone(),
        finish: MeasurementState::Stopped,
        finished_at: now_ms(),
        record: None,
        history_warning: None,
    };
    let Some(discovery) = discover(&root_path, max_depth, &stopped) else {
        return Ok(stopped_summary());
    };
    if stopped() {
        return Ok(stopped_summary());
    }
    let (cargo_available, cargo_message) = probe("cargo");
    if stopped() {
        return Ok(stopped_summary());
    }
    let (maven_available, maven_message) = if discovery.has_maven_candidates() {
        probe("mvn")
    } else {
        (true, None)
    };
    let scan = {
        let mut registry = state.lock()?;
        if stopped() {
            return Ok(stopped_summary());
        }
        registry.install_scan(
            root_id,
            scan_id.clone(),
            root_path,
            max_depth,
            discovery,
            ToolAvailability {
                cargo_available,
                cargo_message,
                maven_available,
                maven_message,
            },
        )?
    };
    progress(ProjectScanProgress::Discovered {
        scan: Box::new(scan.clone()),
    });
    let candidates = scan
        .candidates
        .iter()
        .filter(|candidate| {
            matches!(
                candidate.status,
                ProjectDataCandidateStatus::Ready | ProjectDataCandidateStatus::Unrecognized
            )
        })
        .collect::<Vec<_>>();
    let cursor = AtomicUsize::new(0);
    std::thread::scope(|threads| -> Result<(), String> {
        let workers = (0..candidates.len().min(4))
            .map(|_| {
                threads.spawn(|| -> Result<(), String> {
                    while !stopped() {
                        let index = cursor.fetch_add(1, Ordering::Relaxed);
                        let Some(candidate) = candidates.get(index) else {
                            break;
                        };
                        let Some(measurement) = measure(
                            candidate.kind,
                            Path::new(&candidate.directory_path),
                            &stopped,
                        ) else {
                            break;
                        };
                        {
                            let mut registry = state.lock()?;
                            if stopped() {
                                break;
                            }
                            registry.apply_measurement(
                                &scan_id,
                                &candidate.candidate_id,
                                measurement.clone(),
                            )?;
                        }
                        progress(ProjectScanProgress::Measured {
                            candidate_id: candidate.candidate_id.clone(),
                            measurement,
                        });
                    }
                    Ok(())
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker
                .join()
                .map_err(|_| "项目目录测量任务未能完成".to_string())??;
        }
        Ok(())
    })?;
    let finish = {
        let mut registry = state.lock()?;
        registry
            .active_scan
            .as_mut()
            .ok_or("项目扫描状态不可用")?
            .finalizing = true;
        if stopped() {
            MeasurementState::Stopped
        } else {
            MeasurementState::Finished
        }
    };
    let finished_at = now_ms();
    let mut summary = ProjectScanSummary {
        scan_id: scan_id.clone(),
        finish,
        finished_at,
        record: None,
        history_warning: None,
    };
    if let Some(preset_id) = preset_id {
        match record(ProjectScanRecordDraft {
            preset_id,
            scan_id,
            root_path: scan.root_path,
            max_depth,
            finished_at,
            skipped: scan.skipped,
            measurement: finish,
            projects: scan.projects,
            candidates: scan
                .candidates
                .into_iter()
                .map(|candidate| CandidateKey {
                    kind: candidate.kind,
                    directory_path: candidate.directory_path,
                })
                .collect(),
        }) {
            Ok(record) => summary.record = Some(record),
            Err(error) => summary.history_warning = Some(error),
        }
    }
    Ok(summary)
}

fn probe_tool(program: &str) -> (bool, Option<String>) {
    match run_command(program, &["--version"], Duration::from_secs(5)) {
        Ok(run) if run.exit_code == Some(0) => (true, None),
        Ok(run) => (
            false,
            Some(run.stderr.trim().to_string()).filter(|message| !message.is_empty()),
        ),
        Err(failure) => (false, Some(failure.message)),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
#[path = "project_scan_tests.rs"]
mod tests;
