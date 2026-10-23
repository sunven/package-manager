use crate::opencode_sessions::{
    check_deletable, delete_checked, discover, eligible_ids, read_records, running_ids,
    send_delete, valid_session_id, OpenCodeSessionRecord, Service,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DeletionKind {
    One,
    Selected,
    Age,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareRequest {
    pub kind: DeletionKind,
    #[serde(default)]
    pub session_ids: Vec<String>,
    #[serde(default)]
    pub days: Option<u8>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeletionPlan {
    pub plan_id: String,
    pub kind: DeletionKind,
    pub days: Option<u8>,
    pub cutoff_ms: Option<i64>,
    pub selected: Vec<OpenCodeSessionRecord>,
    pub roots: Vec<OpenCodeSessionRecord>,
    pub affected: Vec<OpenCodeSessionRecord>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionResult {
    pub preflight_error: Option<String>,
    pub items: Vec<OpenCodeDeletionItem>,
    pub completed_ids: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionItem {
    pub id: String,
    pub status: OpenCodeDeletionStatus,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OpenCodeDeletionStatus {
    Deleted,
    Failed,
    NotAttempted,
}

#[derive(Clone)]
pub(crate) struct PreparedDeletion {
    pub plan: DeletionPlan,
    selected_ids: Vec<String>,
}

#[derive(Default)]
struct State {
    sequence: u64,
    prepared: Option<PreparedDeletion>,
}

#[derive(Clone, Default)]
pub(crate) struct DeletionState(Arc<Mutex<State>>);

impl DeletionState {
    pub(crate) fn prepare(&self, request: PrepareRequest) -> Result<DeletionPlan, String> {
        let service = discover()?
            .ok_or_else(|| "未发现正在运行的 OpenCode 服务，请启动 OpenCode 后重试。".to_string())?;
        self.prepare_with_service(&service, request, now_ms())
    }

    pub(crate) fn prepare_with_service(
        &self,
        service: &Service,
        request: PrepareRequest,
        now_ms: i64,
    ) -> Result<DeletionPlan, String> {
        let mut state = self.0.lock().map_err(|_| "OpenCode 删除计划状态不可用。")?;
        state.prepared = None;
        state.sequence += 1;
        let plan_id = format!("opencode-deletion-plan-{}", state.sequence);
        let prepared = prepare_plan(service, request, now_ms, plan_id)?;
        let plan = prepared.plan.clone();
        state.prepared = Some(prepared);
        Ok(plan)
    }

    pub(crate) fn peek_plan(&self, plan_id: &str) -> Result<DeletionPlan, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "OpenCode 删除计划状态不可用。")?;
        state
            .prepared
            .as_ref()
            .filter(|prepared| prepared.plan.plan_id == plan_id)
            .map(|prepared| prepared.plan.clone())
            .ok_or_else(|| "确认已失效，请刷新后重新确认。".to_string())
    }

    pub(crate) fn commit_with_reporter(
        &self,
        plan_id: &str,
        on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
    ) -> Result<OpenCodeDeletionResult, String> {
        let service = discover()?
            .ok_or_else(|| "未发现正在运行的 OpenCode 服务，请启动 OpenCode 后重试。".to_string())?;
        self.commit_with_service_reporter(&service, plan_id, on_item)
    }

    #[cfg(test)]
    pub(crate) fn commit_with_service(
        &self,
        service: &Service,
        plan_id: &str,
    ) -> Result<OpenCodeDeletionResult, String> {
        self.commit_with_service_reporter(service, plan_id, &mut |_| {})
    }

    pub(crate) fn commit_with_service_reporter(
        &self,
        service: &Service,
        plan_id: &str,
        on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
    ) -> Result<OpenCodeDeletionResult, String> {
        let prepared = {
            let mut state = self.0.lock().map_err(|_| "OpenCode 删除计划状态不可用。")?;
            if !state.prepared.as_ref().is_some_and(|prepared| prepared.plan.plan_id == plan_id) {
                return Err("确认已失效，请刷新后重新确认。".into());
            }
            state.prepared.take().ok_or("确认已失效，请刷新后重新确认。")?
        };
        commit_plan(service, prepared, on_item)
    }
}

fn prepare_plan(
    service: &Service,
    request: PrepareRequest,
    now_ms: i64,
    plan_id: String,
) -> Result<PreparedDeletion, String> {
    let records = read_records(service)?;
    match request.kind {
        DeletionKind::One => {
            if request.session_ids.len() != 1 {
                return Err("请选择一个 OpenCode 会话。".into());
            }
            prepare_selected(records, request.session_ids, plan_id, DeletionKind::One)
        }
        DeletionKind::Selected => {
            if request.session_ids.is_empty() {
                return Err("请选择要删除的 OpenCode 会话。".into());
            }
            prepare_selected(records, request.session_ids, plan_id, DeletionKind::Selected)
        }
        DeletionKind::Age => {
            let days = request.days.ok_or("按年龄删除只支持 7 天或 30 天。")?;
            if days != 7 && days != 30 {
                return Err("按年龄删除只支持 7 天或 30 天。".into());
            }
            let cutoff_ms = now_ms.saturating_sub(i64::from(days) * DAY_MS);
            let active = running_ids(service).map_err(|message| {
                format!("无法读取 OpenCode 运行状态，按年龄删除暂不可用：{message}")
            })?;
            let active = active.into_iter().collect::<HashSet<_>>();
            let eligible = eligible_ids(&records, &active, cutoff_ms);
            if eligible.is_empty() {
                return Err(format!("没有符合 {days} 天条件的 OpenCode 会话。"));
            }
            let parts = build_plan(&records, &eligible);
            if parts.roots.is_empty() {
                return Err("没有可删除的 OpenCode 会话。".into());
            }
            let selected = records
                .iter()
                .filter(|record| eligible.contains(&record.id))
                .cloned()
                .collect();
            Ok(PreparedDeletion {
                plan: DeletionPlan {
                    plan_id,
                    kind: DeletionKind::Age,
                    days: Some(days),
                    cutoff_ms: Some(cutoff_ms),
                    selected,
                    roots: parts.roots,
                    affected: parts.affected,
                },
                selected_ids: Vec::new(),
            })
        }
    }
}

fn prepare_selected(
    records: Vec<OpenCodeSessionRecord>,
    session_ids: Vec<String>,
    plan_id: String,
    kind: DeletionKind,
) -> Result<PreparedDeletion, String> {
    let selected_ids = unique_valid_ids(&session_ids)?;
    let existing = records.iter().map(|record| record.id.as_str()).collect::<HashSet<_>>();
    if let Some(missing) = selected_ids.iter().find(|id| !existing.contains(id.as_str())) {
        return Err(format!("所选 OpenCode 会话「{missing}」已不存在，请刷新后重试。"));
    }
    let parts = build_plan(&records, &selected_ids);
    if parts.roots.is_empty() {
        return Err("所选 OpenCode 会话已不存在，请刷新后重试。".into());
    }
    let selected = records
        .iter()
        .filter(|record| selected_ids.contains(&record.id))
        .cloned()
        .collect();
    Ok(PreparedDeletion {
        plan: DeletionPlan {
            plan_id,
            kind,
            days: None,
            cutoff_ms: None,
            selected,
            roots: parts.roots,
            affected: parts.affected,
        },
        selected_ids,
    })
}

fn commit_plan(
    service: &Service,
    prepared: PreparedDeletion,
    on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
) -> Result<OpenCodeDeletionResult, String> {
    match prepared.plan.kind {
        DeletionKind::One => commit_one(service, &prepared, on_item),
        DeletionKind::Selected => commit_selected(service, &prepared, on_item),
        DeletionKind::Age => commit_age(service, &prepared, on_item),
    }
}

fn commit_one(
    service: &Service,
    prepared: &PreparedDeletion,
    on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
) -> Result<OpenCodeDeletionResult, String> {
    let root = prepared.selected_ids.first().ok_or("OpenCode 会话标识无效，请刷新后重试。")?;
    check_deletable(service, root)?;
    let records = read_records(service)
        .map_err(|message| format!("无法核对当前 OpenCode 会话，未删除任何会话：{message}"))?;
    let parts = build_plan(&records, std::slice::from_ref(root));
    if parts.roots.is_empty() {
        return Err("该 OpenCode 会话已不存在，请刷新会话记录后重试。".into());
    }
    send_delete(service, root)?;
    let item = OpenCodeDeletionItem {
        id: root.clone(),
        status: OpenCodeDeletionStatus::Deleted,
        message: None,
    };
    on_item(&item);
    Ok(OpenCodeDeletionResult {
        preflight_error: None,
        items: vec![item],
        completed_ids: parts.affected.into_iter().map(|record| record.id).collect(),
    })
}

fn commit_selected(
    service: &Service,
    prepared: &PreparedDeletion,
    on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
) -> Result<OpenCodeDeletionResult, String> {
    let records = read_records(service)
        .map_err(|message| format!("无法核对当前 OpenCode 会话，未删除任何会话：{message}"))?;
    let existing = records.iter().map(|record| record.id.as_str()).collect::<HashSet<_>>();
    if let Some(missing) = prepared.selected_ids.iter().find(|id| !existing.contains(id.as_str())) {
        return Ok(preflight(format!(
            "未删除任何会话。「{missing}」已不存在，请刷新后重试。"
        )));
    }
    let parts = build_plan(&records, &prepared.selected_ids);
    if parts.roots.is_empty() {
        return Ok(preflight("未删除任何会话。所选 OpenCode 会话已不存在，请刷新后重试。".into()));
    }
    let roots = parts.roots.iter().map(|record| record.id.clone()).collect::<Vec<_>>();
    let affected = affected_by_root(&records, &parts.roots);
    let mut policy = SelectedPolicy { service, affected };
    Ok(run_roots(&roots, &mut policy, on_item))
}

fn commit_age(
    service: &Service,
    prepared: &PreparedDeletion,
    on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
) -> Result<OpenCodeDeletionResult, String> {
    let roots = prepared.plan.roots.iter().map(|record| record.id.clone()).collect::<Vec<_>>();
    let cutoff_ms = prepared.plan.cutoff_ms.ok_or("按年龄删除计划缺少门槛，请刷新后重试。")?;
    let expected = prepared
        .plan
        .affected
        .iter()
        .map(|record| (record.id.clone(), record.parent_id.clone()))
        .collect::<HashMap<_, _>>();
    let affected = affected_by_root(&prepared.plan.affected, &prepared.plan.roots);
    let mut policy = AgePolicy {
        service,
        cutoff_ms,
        expected,
        affected,
        roots: roots.clone(),
    };
    Ok(run_roots(&roots, &mut policy, on_item))
}

fn preflight(message: String) -> OpenCodeDeletionResult {
    OpenCodeDeletionResult {
        preflight_error: Some(message),
        items: Vec::new(),
        completed_ids: Vec::new(),
    }
}

trait BatchPolicy {
    fn validate(&mut self, index: usize) -> Result<(), String>;
    fn delete(&mut self, root: &str) -> Result<(), String>;
    fn on_deleted(&mut self, root: &str, completed: &mut Vec<String>, seen: &mut HashSet<String>);
}

fn run_roots(
    roots: &[String],
    policy: &mut impl BatchPolicy,
    on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
) -> OpenCodeDeletionResult {
    let mut items = Vec::new();
    let mut completed = Vec::new();
    let mut seen = HashSet::new();
    for (index, root) in roots.iter().enumerate() {
        if let Err(message) = policy.validate(index) {
            if index == 0 {
                return preflight(format!("未删除任何会话：{message}"));
            }
            push_item(&mut items, OpenCodeDeletionItem {
                id: root.clone(),
                status: OpenCodeDeletionStatus::Failed,
                message: Some(message),
            }, on_item);
            for id in &roots[index + 1..] {
                push_item(&mut items, OpenCodeDeletionItem {
                    id: id.clone(),
                    status: OpenCodeDeletionStatus::NotAttempted,
                    message: Some("前一项复核失败，已停止后续删除。".into()),
                }, on_item);
            }
            return OpenCodeDeletionResult {
                preflight_error: None,
                items,
                completed_ids: completed,
            };
        }
        match policy.delete(root) {
            Ok(()) => {
                push_item(&mut items, OpenCodeDeletionItem {
                    id: root.clone(),
                    status: OpenCodeDeletionStatus::Deleted,
                    message: None,
                }, on_item);
                policy.on_deleted(root, &mut completed, &mut seen);
            }
            Err(message) => {
                push_item(&mut items, OpenCodeDeletionItem {
                    id: root.clone(),
                    status: OpenCodeDeletionStatus::Failed,
                    message: Some(message),
                }, on_item);
                for id in &roots[index + 1..] {
                    push_item(&mut items, OpenCodeDeletionItem {
                        id: id.clone(),
                        status: OpenCodeDeletionStatus::NotAttempted,
                        message: Some("前一项删除失败，已停止后续删除。".into()),
                    }, on_item);
                }
                return OpenCodeDeletionResult {
                    preflight_error: None,
                    items,
                    completed_ids: completed,
                };
            }
        }
    }
    OpenCodeDeletionResult {
        preflight_error: None,
        items,
        completed_ids: completed,
    }
}

fn push_item(
    items: &mut Vec<OpenCodeDeletionItem>,
    item: OpenCodeDeletionItem,
    on_item: &mut dyn FnMut(&OpenCodeDeletionItem),
) {
    on_item(&item);
    items.push(item);
}

struct SelectedPolicy<'a> {
    service: &'a Service,
    affected: HashMap<String, Vec<String>>,
}

impl BatchPolicy for SelectedPolicy<'_> {
    fn validate(&mut self, index: usize) -> Result<(), String> {
        if index != 0 {
            return Ok(());
        }
        for (root, ids) in &self.affected {
            for id in ids {
                if let Err(message) = check_deletable(self.service, id) {
                    return Err(format!("「{root}」的级联预检失败：「{id}」{message}"));
                }
            }
        }
        Ok(())
    }

    fn delete(&mut self, root: &str) -> Result<(), String> {
        delete_checked(self.service, root)
    }

    fn on_deleted(&mut self, root: &str, completed: &mut Vec<String>, seen: &mut HashSet<String>) {
        if let Some(ids) = self.affected.get(root) {
            for id in ids {
                if seen.insert(id.clone()) {
                    completed.push(id.clone());
                }
            }
        }
    }
}

struct AgePolicy<'a> {
    service: &'a Service,
    cutoff_ms: i64,
    expected: HashMap<String, Option<String>>,
    affected: HashMap<String, Vec<String>>,
    roots: Vec<String>,
}

impl BatchPolicy for AgePolicy<'_> {
    fn validate(&mut self, index: usize) -> Result<(), String> {
        let remaining_roots = &self.roots[index..];
        let records = read_records(self.service)?;
        let parts = build_plan(&records, remaining_roots);
        let roots = parts.roots.iter().map(|record| record.id.clone()).collect::<Vec<_>>();
        if roots != remaining_roots {
            return Err("会话或父子关系已变化，请刷新后重新确认。".into());
        }
        let affected = parts.affected.iter().map(|record| record.id.as_str()).collect::<HashSet<_>>();
        if affected.len() != self.expected.len()
            || parts.affected.iter().any(|record| match self.expected.get(record.id.as_str()) {
                Some(parent) => parent.as_deref() != record.parent_id.as_deref(),
                None => true,
            })
        {
            return Err("会话或父子关系已变化，请刷新后重新确认。".into());
        }
        if parts.affected.iter().any(|record| record.last_activity_ms >= self.cutoff_ms) {
            return Err("会话的最后活动时间已更新，不再早于确认门槛，请刷新后重新确认。".into());
        }
        let active = running_ids(self.service)?;
        if active.iter().any(|id| affected.contains(id.as_str())) {
            return Err("会话或子会话仍在运行，请在 OpenCode 中结束后刷新并重新确认。".into());
        }
        Ok(())
    }

    fn delete(&mut self, root: &str) -> Result<(), String> {
        send_delete(self.service, root)
    }

    fn on_deleted(&mut self, root: &str, completed: &mut Vec<String>, seen: &mut HashSet<String>) {
        if let Some(ids) = self.affected.get(root) {
            for id in ids {
                if seen.insert(id.clone()) {
                    completed.push(id.clone());
                    self.expected.remove(id);
                }
            }
        }
    }
}

struct PlanParts {
    roots: Vec<OpenCodeSessionRecord>,
    affected: Vec<OpenCodeSessionRecord>,
}

fn build_plan(records: &[OpenCodeSessionRecord], selected_ids: &[String]) -> PlanParts {
    let by_id = records
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect::<HashMap<_, _>>();
    let selected = selected_ids
        .iter()
        .filter(|id| by_id.contains_key(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let selected_set = selected.iter().cloned().collect::<HashSet<_>>();
    let roots = selected
        .iter()
        .filter(|id| {
            let mut visited = HashSet::from([id.as_str()]);
            let mut parent = by_id.get(id.as_str()).and_then(|record| record.parent_id.as_deref());
            while let Some(parent_id) = parent {
                if !visited.insert(parent_id) {
                    break;
                }
                if selected_set.contains(parent_id) {
                    return false;
                }
                parent = by_id.get(parent_id).and_then(|record| record.parent_id.as_deref());
            }
            true
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut affected = roots.iter().cloned().collect::<HashSet<_>>();
    loop {
        let mut changed = false;
        for record in records {
            if record.parent_id.as_ref().is_some_and(|parent| affected.contains(parent)) {
                changed |= affected.insert(record.id.clone());
            }
        }
        if !changed {
            break;
        }
    }
    PlanParts {
        roots: roots
            .iter()
            .filter_map(|id| by_id.get(id.as_str()).map(|record| (*record).clone()))
            .collect(),
        affected: records
            .iter()
            .filter(|record| affected.contains(&record.id))
            .cloned()
            .collect(),
    }
}

fn affected_by_root(
    records: &[OpenCodeSessionRecord],
    roots: &[OpenCodeSessionRecord],
) -> HashMap<String, Vec<String>> {
    let mut affected = HashMap::new();
    for root in roots {
        let mut seen = HashSet::from([root.id.clone()]);
        let mut pending = vec![root.id.clone()];
        while let Some(parent) = pending.pop() {
            for record in records {
                if record.parent_id.as_deref() == Some(parent.as_str()) && seen.insert(record.id.clone()) {
                    pending.push(record.id.clone());
                }
            }
        }
        affected.insert(
            root.id.clone(),
            records
                .iter()
                .filter(|record| seen.contains(&record.id))
                .map(|record| record.id.clone())
                .collect(),
        );
    }
    affected
}

fn unique_valid_ids(session_ids: &[String]) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let unique = session_ids
        .iter()
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect::<Vec<_>>();
    if unique.iter().any(|id| !valid_session_id(id)) {
        return Err("OpenCode 会话标识无效，请刷新后重试。".into());
    }
    Ok(unique)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "opencode_deletion_tests.rs"]
mod tests;
