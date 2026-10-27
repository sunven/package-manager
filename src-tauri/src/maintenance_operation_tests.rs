use super::*;
use crate::maintenance_history::{
    ExecutionSummary, MaintenanceDomain, MaintenanceHistoryState, MaintenanceOperation,
    ManagerDetail,
};
use crate::types::ManagerId;

fn header() -> OperationHeader {
    OperationHeader {
        domain: MaintenanceDomain::Manager,
        operation: MaintenanceOperation::CleanupCache,
        detail: MaintenanceDetail::Manager(ManagerDetail {
            manager_id: ManagerId::Npm,
            target: None,
            steps: None,
        }),
        before_snapshot_id: None,
    }
}

fn store() -> (tempfile::TempDir, MaintenanceHistoryState) {
    let directory = tempfile::tempdir().unwrap();
    let store = MaintenanceHistoryState::new(directory.path().into());
    (directory, store)
}

#[test]
fn begin_failure_runs_operation_without_writing_a_record() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("maintenance-v2.json"), b"not json").unwrap();
    let store = MaintenanceHistoryState::new(directory.path().into());
    let mut recorded = Vec::new();
    let receipt = run(
        &store,
        header(),
        |sink| {
            sink(&1u32);
            Ok(7u32)
        },
        |_, _, item| {
            recorded.push(*item);
            Ok(())
        },
        |_, _, _| panic!("finish must not run without a record"),
    )
    .unwrap();

    assert_eq!(receipt.result, 7);
    assert!(receipt.history_id.is_none());
    assert!(receipt.history_warning.is_some());
    assert!(recorded.is_empty());
}

#[test]
fn records_each_item_before_completing_the_record() {
    let (_directory, store) = store();
    let events = std::cell::RefCell::new(Vec::new());
    let receipt = run(
        &store,
        header(),
        |sink| {
            sink(&1u32);
            sink(&2u32);
            Ok(2u32)
        },
        |history, id, item| {
            events.borrow_mut().push(format!("record:{item}"));
            history.update(id, |record| {
                record.message = format!("item {item}");
                Ok(())
            })
        },
        |history, id, end| match end {
            OperationEnd::Completed(result) => {
                events.borrow_mut().push(format!("finish:{result}"));
                history.finish(id, ExecutionSummary::Succeeded, "done".into())
            }
            OperationEnd::Aborted(_) => panic!("unexpected abort"),
        },
    )
    .unwrap();

    assert_eq!(*events.borrow(), ["record:1", "record:2", "finish:2"]);
    let record = store.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.execution, ExecutionSummary::Succeeded);
    assert_eq!(record.message, "done");
    assert!(record.finished_at.is_some());
}

#[test]
fn execute_error_finishes_not_executed_and_returns_error() {
    let (_directory, store) = store();
    let result = run::<u32, u32>(
        &store,
        header(),
        |_sink| Err("boom".into()),
        |_, _, _| Ok(()),
        |history, id, end| match end {
            OperationEnd::Aborted(error) => {
                assert_eq!(error, "boom");
                history.finish(id, ExecutionSummary::NotExecuted, error.into())
            }
            OperationEnd::Completed(_) => panic!("unexpected completion"),
        },
    );

    match result {
        Err(error) => assert_eq!(error, "boom"),
        Ok(_) => panic!("expected execution error"),
    }
    let record = &store.list().records[0];
    assert_eq!(record.execution, ExecutionSummary::NotExecuted);
    assert!(record.finished_at.is_some());
}

#[test]
fn first_item_warning_wins_and_later_items_are_still_recorded() {
    let (_directory, store) = store();
    let attempts = std::cell::Cell::new(0);
    let receipt = run(
        &store,
        header(),
        |sink| {
            sink(&1u32);
            sink(&2u32);
            sink(&3u32);
            Ok(3u32)
        },
        |_, _, _| {
            attempts.set(attempts.get() + 1);
            Err(format!("warning {}", attempts.get()))
        },
        |history, id, _| history.finish(id, ExecutionSummary::Partial, "done".into()),
    )
    .unwrap();

    assert_eq!(attempts.get(), 3);
    assert_eq!(receipt.history_warning.as_deref(), Some("warning 1"));
}

#[test]
fn finish_failure_becomes_the_history_warning() {
    let (_directory, store) = store();
    let receipt = run(
        &store,
        header(),
        |sink| {
            sink(&1u32);
            Ok(1u32)
        },
        |_, _, _| Ok(()),
        |_, _, _| Err("finish failed".into()),
    )
    .unwrap();

    assert_eq!(receipt.history_warning.as_deref(), Some("finish failed"));
}
