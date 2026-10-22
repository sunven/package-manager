use super::*;
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
fn one_commit_uses_the_current_cascade_and_reports_completed_ids() {
    let (url, server) = mock_server(vec![
        (200, page(&[("ses_parent", None, 1, None), ("ses_child", Some("ses_parent"), 1, None)])),
        (200, session("ses_parent")),
        (200, active(&[])),
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
