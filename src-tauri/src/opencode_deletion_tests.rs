use super::*;
use crate::maintenance_adapters::{commit_opencode_deletion, record_followup};
use crate::maintenance_history::{
    ExecutionSummary, FollowUpReadStatus, MaintenanceDetail, MaintenanceHistoryState,
};
use crate::opencode_sessions::{test_service, Service};
use reqwest::Url;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

const NOW: i64 = 100 * DAY_MS;

fn page(records: &[(&str, Option<&str>, i64, Option<i64>)]) -> String {
    serde_json::json!({
        "data": records.iter().map(|(id, parent, updated, archived)| serde_json::json!({
            "id": id,
            "parentID": parent,
            "title": id,
            "time": { "updated": updated, "archived": archived },
            "location": { "directory": "/fixture" }
        })).collect::<Vec<_>>(),
        "cursor": {}
    }).to_string()
}

fn active(ids: &[&str]) -> String {
    let data = ids.iter().map(|id| (*id, serde_json::json!({}))).collect::<HashMap<_, _>>();
    serde_json::json!({ "data": data }).to_string()
}

fn session(id: &str) -> String {
    serde_json::json!({
        "data": {
            "id": id,
            "time": { "updated": 1 },
            "location": { "directory": "/fixture" }
        }
    }).to_string()
}

fn ids(records: &[OpenCodeSessionRecord]) -> Vec<&str> {
    records.iter().map(|record| record.id.as_str()).collect()
}

fn age_request(days: u8) -> PrepareRequest {
    PrepareRequest { kind: DeletionKind::Age, session_ids: Vec::new(), days: Some(days) }
}

fn selected_request(ids: &[&str]) -> PrepareRequest {
    PrepareRequest {
        kind: DeletionKind::Selected,
        session_ids: ids.iter().map(|id| (*id).to_string()).collect(),
        days: None,
    }
}

fn prepare_one(state: &DeletionState, service: &Service, id: &str) -> DeletionPlan {
    state.prepare_with_service(
        service,
        PrepareRequest { kind: DeletionKind::One, session_ids: vec![id.into()], days: None },
        0,
    ).unwrap()
}

#[test]
fn age_plan_blocks_recent_and_running_ancestors() {
    let records = [
        ("ses_old", None, 1, None),
        ("ses_old_child", Some("ses_old"), 1, None),
        ("ses_recent", None, NOW, None),
        ("ses_recent_child", Some("ses_recent"), 1, None),
        ("ses_active", None, 1, None),
        ("ses_active_child", Some("ses_active"), 1, None),
    ];
    let (url, server) = mock_server(vec![(200, page(&records)), (200, active(&["ses_active"]))]);
    let state = DeletionState::default();
    let plan = state.prepare_with_service(&test_service(url), age_request(30), NOW).unwrap();
    assert_eq!(plan.kind, DeletionKind::Age);
    assert_eq!(plan.days, Some(30));
    assert_eq!(plan.cutoff_ms, Some(NOW - 30 * DAY_MS));
    assert_eq!(ids(&plan.roots), vec!["ses_old", "ses_recent_child", "ses_active_child"]);
    assert_eq!(
        ids(&plan.affected),
        vec!["ses_old", "ses_old_child", "ses_recent_child", "ses_active_child"],
    );
    assert_eq!(
        ids(&plan.selected),
        vec!["ses_old", "ses_old_child", "ses_recent_child", "ses_active_child"],
    );
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn age_prepare_rejects_unreadable_activity() {
    let (url, server) = mock_server(vec![
        (200, page(&[("ses_old", None, 1, None)])),
        (500, String::new()),
    ]);
    let error = DeletionState::default()
        .prepare_with_service(&test_service(url), age_request(30), NOW)
        .unwrap_err();
    assert!(error.contains("按年龄删除暂不可用"));
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn selected_prepare_previews_the_cascade_without_deleting() {
    let records = [
        ("ses_parent", None, 1, None),
        ("ses_child", Some("ses_parent"), 1, None),
        ("ses_grandchild", Some("ses_child"), 1, None),
        ("ses_other", None, 1, None),
    ];
    let (url, server) = mock_server(vec![(200, page(&records))]);
    let state = DeletionState::default();
    let plan = state
        .prepare_with_service(&test_service(url), selected_request(&["ses_parent", "ses_child"]), 0)
        .unwrap();
    assert_eq!(ids(&plan.selected), vec!["ses_parent", "ses_child"]);
    assert_eq!(ids(&plan.roots), vec!["ses_parent"]);
    assert_eq!(ids(&plan.affected), vec!["ses_parent", "ses_child", "ses_grandchild"]);
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(!requests[0].starts_with("delete "));
}

#[test]
fn one_commit_keeps_root_only_preflight_and_reports_the_current_cascade() {
    let (url, server) = mock_server(vec![
        (200, page(&[("ses_parent", None, 1, None), ("ses_child", Some("ses_parent"), 1, None)])),
        (200, session("ses_parent")),
        (200, active(&["ses_child"])),
        (200, page(&[
            ("ses_parent", None, 1, None),
            ("ses_child", Some("ses_parent"), 1, None),
            ("ses_new", Some("ses_parent"), 1, None),
        ])),
        (204, String::new()),
    ]);
    let service = test_service(url);
    let state = DeletionState::default();
    let plan = prepare_one(&state, &service, "ses_parent");
    let result = state.commit_with_service(&service, &plan.plan_id).unwrap();
    assert_eq!(result.items[0].status, OpenCodeDeletionStatus::Deleted);
    assert_eq!(result.completed_ids, vec!["ses_parent", "ses_child", "ses_new"]);
    assert_eq!(server.join().unwrap().iter().filter(|request| request.starts_with("delete ")).count(), 1);
}

#[test]
fn one_delete_failures_keep_the_receipt_history_and_followup() {
    for (status, body) in [
        (409, ""),
        (500, ""),
        (200, "false"),
        (200, r#"{"data":false}"#),
        (200, "{"),
        (0, ""),
    ] {
        let records = [("ses_parent", None, 1, None), ("ses_child", Some("ses_parent"), 1, None)];
        let (url, server) = mock_server(vec![
            (200, page(&records)),
            (200, session("ses_parent")),
            (200, active(&[])),
            (200, page(&records)),
            (status, body.into()),
        ]);
        let service = test_service(url);
        let state = DeletionState::default();
        let plan = prepare_one(&state, &service, "ses_parent");
        let directory = tempfile::tempdir().unwrap();
        let history = MaintenanceHistoryState::new(directory.path().into());
        let attempt = commit_opencode_deletion(&history, &plan, |sink| {
            state.commit_with_service_reporter(&service, &plan.plan_id, sink)
        });
        let requests = server.join().unwrap();
        assert_eq!(requests.iter().filter(|request| request.starts_with("delete ")).count(), 1);
        let receipt = attempt.expect("a DELETE failure must keep its receipt");
        assert!(receipt.history_warning.is_none());
        assert_eq!(receipt.result.preflight_error, None);
        assert_eq!(receipt.result.items.len(), 1);
        assert_eq!(receipt.result.items[0].id, "ses_parent");
        assert_eq!(receipt.result.items[0].status, OpenCodeDeletionStatus::Failed);
        assert!(receipt.result.items[0].message.is_some());
        assert!(receipt.result.completed_ids.is_empty());
        let id = receipt.history_id.as_deref().unwrap();
        let serialized = serde_json::to_value(&receipt).unwrap();
        assert_eq!(serialized["historyId"], id);
        assert_eq!(serialized["items"][0]["status"], "failed");

        let record = history.get(id).unwrap();
        assert_eq!(record.execution, ExecutionSummary::Failed);
        assert!(record.finished_at.is_some());
        let MaintenanceDetail::OpenCodeDeletion(detail) = record.detail else {
            panic!("expected OpenCode deletion detail");
        };
        assert_eq!(detail.scope.plan_id, plan.plan_id);
        assert_eq!(detail.results.len(), 1);
        assert_eq!(detail.results[0].status, "Failed");
        assert_eq!(detail.results[0].message, receipt.result.items[0].message);
        assert!(detail.completed_ids.is_empty());

        record_followup(&history, id, "failed", Some("service stopped".into())).unwrap();
        let record = history.get(id).unwrap();
        assert_eq!(record.execution, ExecutionSummary::Failed);
        assert_eq!(record.follow_up_read.unwrap().status, FollowUpReadStatus::Failed);
    }
}

#[test]
fn one_preflight_rejection_is_not_executed_and_sends_no_delete() {
    let records = [("ses_parent", None, 1, None)];
    let (url, server) = mock_server(vec![
        (200, page(&records)),
        (200, session("ses_parent")),
        (200, active(&["ses_parent"])),
    ]);
    let service = test_service(url);
    let state = DeletionState::default();
    let plan = prepare_one(&state, &service, "ses_parent");
    let directory = tempfile::tempdir().unwrap();
    let history = MaintenanceHistoryState::new(directory.path().into());
    let error = commit_opencode_deletion(&history, &plan, |sink| {
        state.commit_with_service_reporter(&service, &plan.plan_id, sink)
    }).err().unwrap();
    assert!(error.contains("仍在运行"));
    assert!(server.join().unwrap().iter().all(|request| !request.starts_with("delete ")));
    let record = history.get(&history.list().records[0].id).unwrap();
    assert_eq!(record.execution, ExecutionSummary::NotExecuted);
    let MaintenanceDetail::OpenCodeDeletion(detail) = record.detail else {
        panic!("expected OpenCode deletion detail");
    };
    assert!(detail.results.is_empty());
    assert!(detail.completed_ids.is_empty());
}

#[test]
fn selected_commit_preflights_every_affected_record_and_reports_completed_ids() {
    let records = [("ses_parent", None, 1, None), ("ses_child", Some("ses_parent"), 1, None)];
    let (url, server) = mock_server(vec![
        (200, page(&records)),
        (200, page(&records)),
        (200, session("ses_parent")),
        (200, active(&[])),
        (200, session("ses_child")),
        (200, active(&[])),
        (200, session("ses_parent")),
        (200, active(&[])),
        (204, String::new()),
    ]);
    let service = test_service(url);
    let state = DeletionState::default();
    let plan = state
        .prepare_with_service(&service, selected_request(&["ses_parent"]), 0)
        .unwrap();
    let result = state.commit_with_service(&service, &plan.plan_id).unwrap();
    assert_eq!(result.items[0].status, OpenCodeDeletionStatus::Deleted);
    assert_eq!(result.completed_ids, vec!["ses_parent", "ses_child"]);
    assert_eq!(server.join().unwrap().iter().filter(|request| request.starts_with("delete ")).count(), 1);
}

#[test]
fn selected_commit_aborts_before_deleting_when_a_preflight_target_is_missing() {
    let records = [("ses_parent", None, 1, None)];
    let (url, server) = mock_server(vec![
        (200, page(&records)),
        (200, page(&records)),
        (404, String::new()),
    ]);
    let service = test_service(url);
    let state = DeletionState::default();
    let plan = state
        .prepare_with_service(&service, selected_request(&["ses_parent"]), 0)
        .unwrap();
    let result = state.commit_with_service(&service, &plan.plan_id).unwrap();
    assert!(result.preflight_error.is_some());
    assert!(result.items.is_empty());
    assert!(result.completed_ids.is_empty());
    assert!(server.join().unwrap().iter().all(|request| !request.starts_with("delete ")));
}

#[test]
fn age_commit_rejects_a_changed_cascade_without_deleting() {
    let (url, server) = mock_server(vec![
        (200, page(&[("ses_parent", None, 1, None), ("ses_child", Some("ses_parent"), 1, None)])),
        (200, active(&[])),
        (200, page(&[("ses_parent", None, 1, None), ("ses_new", Some("ses_parent"), 1, None)])),
    ]);
    let service = test_service(url);
    let state = DeletionState::default();
    let plan = state.prepare_with_service(&service, age_request(30), NOW).unwrap();
    let result = state.commit_with_service(&service, &plan.plan_id).unwrap();
    assert!(result.preflight_error.is_some());
    assert!(result.items.is_empty());
    assert!(server.join().unwrap().iter().all(|request| !request.starts_with("delete ")));
}

#[test]
fn age_commit_stops_after_the_first_failure_and_keeps_completed_ids() {
    let records = [
        ("ses_first", None, 1, None),
        ("ses_second", None, 1, None),
        ("ses_third", None, 1, None),
    ];
    let (url, server) = mock_server(vec![
        (200, page(&records)),
        (200, active(&[])),
        (200, page(&records)),
        (200, active(&[])),
        (204, String::new()),
        (200, page(&[("ses_second", None, 1, None), ("ses_third", None, 1, None)])),
        (200, active(&[])),
        (500, String::new()),
    ]);
    let service = test_service(url);
    let state = DeletionState::default();
    let plan = state.prepare_with_service(&service, age_request(30), NOW).unwrap();
    let result = state.commit_with_service(&service, &plan.plan_id).unwrap();
    assert_eq!(
        result.items.iter().map(|item| &item.status).collect::<Vec<_>>(),
        vec![
            &OpenCodeDeletionStatus::Deleted,
            &OpenCodeDeletionStatus::Failed,
            &OpenCodeDeletionStatus::NotAttempted,
        ],
    );
    assert_eq!(result.completed_ids, vec!["ses_first"]);
    assert_eq!(server.join().unwrap().iter().filter(|request| request.starts_with("delete ")).count(), 2);
}

#[test]
fn a_new_prepare_replaces_the_previous_plan_and_rejects_its_id() {
    let records = [("ses_parent", None, 1, None)];
    let (url, server) = mock_server(vec![(200, page(&records)), (200, page(&records))]);
    let service = test_service(url);
    let state = DeletionState::default();
    let first = state.prepare_with_service(&service, selected_request(&["ses_parent"]), 0).unwrap();
    let second = state.prepare_with_service(&service, selected_request(&["ses_parent"]), 0).unwrap();
    assert_ne!(first.plan_id, second.plan_id);
    let error = state.commit_with_service(&service, &first.plan_id).unwrap_err();
    assert!(error.contains("确认已失效"));
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn prepare_rejects_a_missing_selected_target() {
    let (url, server) = mock_server(vec![(200, page(&[("ses_other", None, 1, None)]))]);
    let error = DeletionState::default()
        .prepare_with_service(&test_service(url), selected_request(&["ses_missing"]), 0)
        .unwrap_err();
    assert!(error.contains("已不存在"));
    assert_eq!(server.join().unwrap().len(), 1);
}

fn mock_server(responses: Vec<(u16, String)>) -> (Url, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                request.extend_from_slice(&buffer[..count]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") || count == 0 {
                    break;
                }
            }
            requests.push(String::from_utf8_lossy(&request).to_lowercase());
            // Zero simulates a peer closing after receiving the request without replying.
            if status == 0 {
                continue;
            }
            let reason = if status == 404 { "Not Found" } else { "OK" };
            write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            ).unwrap();
        }
        requests
    });
    (Url::parse(&format!("http://{address}")).unwrap(), server)
}
