use crate::maintenance_history::{
    MaintenanceDetail, MaintenanceDomain, MaintenanceHistoryState, MaintenanceOperation,
};
use serde::Serialize;

pub(crate) struct OperationHeader {
    pub domain: MaintenanceDomain,
    pub operation: MaintenanceOperation,
    pub detail: MaintenanceDetail,
    pub before_snapshot_id: Option<String>,
}

pub(crate) enum OperationEnd<'a, T> {
    Completed(&'a T),
    Aborted(&'a str),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt<T: Serialize> {
    #[serde(flatten)]
    pub result: T,
    pub history_id: Option<String>,
    pub history_warning: Option<String>,
}

/// Runs one confirmed maintenance operation and keeps its record.
///
/// The adapter's `execute` must return `Err` only when no operation target was
/// executed. Mid-batch failures belong in the domain result as per-target
/// outcomes, so an `Err` is safe to record as `NotExecuted` without losing
/// completed work.
pub(crate) fn run<T, Item>(
    history: &MaintenanceHistoryState,
    header: OperationHeader,
    execute: impl FnOnce(&mut dyn FnMut(&Item)) -> Result<T, String>,
    mut record: impl FnMut(&MaintenanceHistoryState, &str, &Item) -> Result<(), String>,
    finish: impl FnOnce(&MaintenanceHistoryState, &str, OperationEnd<'_, T>) -> Result<(), String>,
) -> Result<Receipt<T>, String>
where
    T: Serialize,
{
    let (history_id, mut warning) = match history.begin(
        header.domain,
        header.operation,
        header.detail,
        header.before_snapshot_id,
    ) {
        Ok(id) => (Some(id), None),
        Err(error) => (None, Some(error)),
    };

    let mut item_warning: Option<String> = None;
    let result = {
        let mut sink = |item: &Item| {
            let Some(id) = history_id.as_deref() else {
                return;
            };
            if let Err(error) = record(history, id, item) {
                if item_warning.is_none() {
                    item_warning = Some(error);
                }
            }
        };
        execute(&mut sink)
    };

    let result = match result {
        Ok(result) => result,
        Err(error) => {
            if let Some(id) = history_id.as_deref() {
                let _ = finish(history, id, OperationEnd::Aborted(&error));
            }
            return Err(error);
        }
    };

    if let Some(error) = item_warning {
        warning.get_or_insert(error);
    }
    if let Some(id) = history_id.as_deref() {
        if let Err(error) = finish(history, id, OperationEnd::Completed(&result)) {
            warning.get_or_insert(error);
        }
    }

    Ok(Receipt {
        result,
        history_id,
        history_warning: warning,
    })
}

#[cfg(test)]
#[path = "maintenance_operation_tests.rs"]
mod tests;
