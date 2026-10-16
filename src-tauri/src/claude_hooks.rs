use crate::claude_cli::{self, Runner};
use crate::claude_documents::Document;
use crate::claude_plugin_details;
use crate::claude_plugins::{self, ChangeResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub(crate) struct HooksState(Arc<Mutex<State>>);
#[derive(Default)]
struct State {
    sequence: u64,
    observation: Option<Observation>,
    preview: Option<Prepared>,
}
#[derive(Clone)]
struct Observation {
    id: String,
    home: PathBuf,
    document: Document,
    version: String,
    rows: Vec<Hook>,
}
struct Prepared {
    id: String,
    observation: Observation,
    next: Value,
}

const ALL_TYPES: &[&str] = &["command", "http", "mcp_tool", "prompt", "agent"];
const TOOL_EVENTS: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
];
const EVENTS: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
    "UserPromptSubmit",
    "UserPromptExpansion",
    "Stop",
    "SubagentStop",
    "TaskCreated",
    "TaskCompleted",
    "TeammateIdle",
    "PostToolBatch",
    "SessionStart",
    "Setup",
    "SessionEnd",
    "SubagentStart",
    "Notification",
    "PreCompact",
    "PostCompact",
    "PreModelSwitch",
    "PostModelSwitch",
    "ConfigChange",
    "CwdChanged",
    "DirectoryAdded",
    "FileChanged",
    "InstructionsLoaded",
    "MessageDisplay",
    "StopFailure",
    "Elicitation",
    "ElicitationResult",
    "WorktreeCreate",
    "WorktreeRemove",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventSchema {
    name: String,
    types: Vec<String>,
    matcher: bool,
    condition: bool,
    failure: bool,
}

fn schema(event: &str) -> Option<EventSchema> {
    if !EVENTS.contains(&event) {
        return None;
    }
    let types: &[&str] = if matches!(event, "SessionStart" | "Setup") {
        &["command", "mcp_tool"]
    } else if event == "PermissionRequest" {
        &["command", "http", "mcp_tool", "prompt"]
    } else if matches!(
        event,
        "PermissionDenied"
            | "PostToolBatch"
            | "PostToolUse"
            | "PostToolUseFailure"
            | "PreToolUse"
            | "Stop"
            | "SubagentStop"
            | "TaskCompleted"
            | "TaskCreated"
            | "TeammateIdle"
            | "UserPromptExpansion"
            | "UserPromptSubmit"
    ) {
        ALL_TYPES
    } else {
        &["command", "http", "mcp_tool"]
    };
    Some(EventSchema {
        name: event.into(),
        types: types.iter().map(|v| (*v).into()).collect(),
        matcher: !matches!(
            event,
            "CwdChanged"
                | "UserPromptSubmit"
                | "PostToolBatch"
                | "Stop"
                | "TeammateIdle"
                | "TaskCreated"
                | "TaskCompleted"
                | "WorktreeCreate"
                | "WorktreeRemove"
                | "MessageDisplay"
        ),
        condition: TOOL_EVENTS.contains(&event),
        failure: !matches!(
            event,
            "Stop" | "SubagentStop" | "TaskCompleted" | "TeammateIdle"
        ),
    })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hook {
    pub id: String,
    pub event: String,
    pub matcher: Option<String>,
    pub handler: Value,
    pub source: String,
    pub plugin_id: Option<String>,
    pub plugin_enabled: Option<bool>,
    pub read_only_reason: Option<String>,
    #[serde(skip)]
    group: usize,
    #[serde(skip)]
    index: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookScan {
    snapshot_id: Option<String>,
    directory: String,
    config_path: String,
    version: Option<String>,
    write_blocked_reason: Option<String>,
    disable_all_hooks: Option<bool>,
    hooks: Vec<Hook>,
    events: Vec<EventSchema>,
    messages: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Draft {
    event: String,
    matcher: Option<String>,
    handler: Value,
}

#[derive(Clone, Deserialize, PartialEq)]
pub(crate) enum Action {
    Create,
    Edit,
    Delete,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionRequest {
    snapshot_id: String,
    action: Action,
    hook_id: Option<String>,
    draft: Option<Draft>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    preview_id: String,
    source: String,
    before: Option<Value>,
    after: Option<Value>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitRequest {
    preview_id: String,
}

fn flatten(
    events: &Value,
    source: &str,
    prefix: &str,
    plugin: Option<(&str, bool)>,
    messages: &mut Vec<String>,
) -> Vec<Hook> {
    let Some(events) = events.as_object() else {
        messages.push(format!("{source} 的 hooks 不是事件对象。"));
        return vec![];
    };
    let mut rows = vec![];
    for (event, groups) in events {
        let Some(groups) = groups.as_array() else {
            messages.push(format!("{event} 的匹配组格式不支持，未展开。"));
            continue;
        };
        for (group, entry) in groups.iter().enumerate() {
            let Some(handlers) = entry["hooks"].as_array() else {
                messages.push(format!("{event} 第 {} 组缺少处理程序数组。", group + 1));
                continue;
            };
            for (index, handler) in handlers.iter().enumerate() {
                let read_only_reason = if plugin.is_some() {
                    Some("插件声明仅供查看；随整个插件启停。".into())
                } else if entry.get("matcher").is_some_and(|m| !m.is_string())
                    || !handler.is_object()
                {
                    Some("此定义结构不支持编辑，原文保留。".into())
                } else if schema(event).is_none()
                    || !handler["type"]
                        .as_str()
                        .is_some_and(|t| ALL_TYPES.contains(&t))
                {
                    Some("当前事件或类型尚未支持，原文保留。".into())
                } else {
                    None
                };
                rows.push(Hook {
                    id: format!("{prefix}:{event}:{group}:{index}"),
                    event: event.clone(),
                    matcher: entry["matcher"].as_str().map(str::to_string),
                    handler: handler.clone(),
                    source: source.into(),
                    plugin_id: plugin.map(|(id, _)| id.into()),
                    plugin_enabled: plugin.map(|(_, enabled)| enabled),
                    read_only_reason,
                    group,
                    index,
                });
            }
        }
    }
    rows
}

const KNOWN_FIELDS: &[&str] = &[
    "type",
    "command",
    "args",
    "shell",
    "async",
    "asyncRewake",
    "url",
    "headers",
    "allowedEnvVars",
    "server",
    "tool",
    "input",
    "prompt",
    "model",
    "continueOnBlock",
    "timeout",
    "statusMessage",
    "if",
    "onFailure",
];

fn validate(draft: &Draft, original: Option<&Hook>) -> Result<(), String> {
    let event = schema(&draft.event).ok_or("当前事件尚未支持。")?;
    let fields = draft.handler.as_object().ok_or("处理程序必须是对象。")?;
    let kind = draft.handler["type"].as_str().ok_or("请选择 Hook 类型。")?;
    if !event.types.iter().any(|t| t == kind) {
        return Err("此事件不支持所选 Hook 类型。".into());
    }
    if draft.matcher.is_some() && !event.matcher {
        return Err("此事件不支持匹配条件，请移除 matcher。".into());
    }
    for (key, value) in fields {
        if !KNOWN_FIELDS.contains(&key.as_str())
            && original.and_then(|o| o.handler.get(key)) != Some(value)
        {
            return Err(format!("不支持修改字段 {key}，已有未知字段必须保留。"));
        }
    }
    if let Some(original) = original {
        for (key, value) in original.handler.as_object().into_iter().flatten() {
            if !KNOWN_FIELDS.contains(&key.as_str()) && fields.get(key) != Some(value) {
                return Err(format!("必须保留未知字段 {key}。"));
            }
        }
    }
    let required: &[&str] = match kind {
        "command" => &["command"],
        "http" => &["url"],
        "mcp_tool" => &["server", "tool"],
        _ => &["prompt"],
    };
    for key in required {
        if !draft.handler[key]
            .as_str()
            .is_some_and(|v| !v.trim().is_empty())
        {
            return Err(format!("请填写 {key}。"));
        }
    }
    let specific: &[&str] = match kind {
        "command" => &[
            "command",
            "args",
            "shell",
            "async",
            "asyncRewake",
            "onFailure",
        ],
        "http" => &["url", "headers", "allowedEnvVars", "onFailure"],
        "mcp_tool" => &["server", "tool", "input"],
        "prompt" => &["prompt", "model", "continueOnBlock"],
        _ => &["prompt", "model"],
    };
    for (key, value) in fields {
        if KNOWN_FIELDS.contains(&key.as_str())
            && !["type", "timeout", "statusMessage", "if"].contains(&key.as_str())
            && !specific.contains(&key.as_str())
        {
            return Err(format!("{kind} 不支持字段 {key}。"));
        }
        match key.as_str() {
            "timeout" if !value.as_f64().is_some_and(|n| n.is_finite() && n > 0.0) => {
                return Err("超时必须是正数。".into())
            }
            "async" | "asyncRewake" | "continueOnBlock" if !value.is_boolean() => {
                return Err(format!("{key} 必须是布尔值。"))
            }
            "args" | "allowedEnvVars"
                if !value
                    .as_array()
                    .is_some_and(|a| a.iter().all(Value::is_string)) =>
            {
                return Err(format!("{key} 必须是字符串数组。"))
            }
            "headers"
                if !value
                    .as_object()
                    .is_some_and(|o| o.values().all(Value::is_string)) =>
            {
                return Err("headers 必须是字符串键值对象。".into())
            }
            "input" if !value.is_object() => return Err("MCP input 必须是 JSON 对象。".into()),
            "type" | "command" | "url" | "server" | "tool" | "prompt" | "model"
            | "statusMessage" | "if"
                if !value.is_string() =>
            {
                return Err(format!("{key} 必须是文本。"))
            }
            "shell" if !matches!(value.as_str(), Some("bash" | "powershell")) => {
                return Err("shell 仅支持 bash 或 powershell。".into())
            }
            "onFailure" if !matches!(value.as_str(), Some("continue" | "block")) => {
                return Err("onFailure 仅支持 continue 或 block。".into())
            }
            _ => (),
        }
    }
    if fields.contains_key("if") && !event.condition {
        return Err("此事件不会执行带 if 的 Hook，请移除该条件。".into());
    }
    let background = draft.handler["async"] == true || draft.handler["asyncRewake"] == true;
    if fields.contains_key("onFailure") && (!event.failure || background) {
        return Err("此事件或后台模式不会采用 onFailure，请移除该字段。".into());
    }
    if fields.contains_key("timeout") && background {
        return Err("后台命令不采用 timeout，请移除该字段。".into());
    }
    if fields.contains_key("shell") && fields.contains_key("args") {
        return Err("直接执行模式不采用 shell，请移除 shell 或 args。".into());
    }
    if kind == "http"
        && !draft.handler["url"]
            .as_str()
            .is_some_and(|u| u.starts_with("https://") || u.starts_with("http://"))
    {
        return Err("HTTP Hook URL 必须使用 http:// 或 https://。".into());
    }
    Ok(())
}

fn updated(
    document: &Value,
    action: &Action,
    original: Option<&Hook>,
    draft: Option<&Draft>,
) -> Result<Value, String> {
    let mut next = document.clone();
    if *action != Action::Delete {
        validate(draft.ok_or("缺少 Hook 定义。")?, original)?;
    }
    if let Some(hooks) = next.get("hooks") {
        if !hooks.is_object() {
            return Err("用户 hooks 结构不支持维护。".into());
        }
    } else {
        next["hooks"] = json!({});
    }
    let mut template = json!({});
    if let Some(original) = original {
        let groups = next["hooks"][&original.event]
            .as_array_mut()
            .ok_or("定义已变化。")?;
        let group = groups.get_mut(original.group).ok_or("匹配组已变化。")?;
        template = group.clone();
        let handlers = group["hooks"].as_array_mut().ok_or("处理程序已变化。")?;
        if handlers.get(original.index) != Some(&original.handler) {
            return Err("处理程序已变化。".into());
        }
        if *action == Action::Edit
            && draft.is_some_and(|d| d.event == original.event && d.matcher == original.matcher)
        {
            handlers[original.index] = draft.unwrap().handler.clone();
            return Ok(next);
        }
        handlers.remove(original.index);
        if handlers.is_empty() {
            groups.remove(original.group);
        }
        if groups.is_empty() {
            next["hooks"]
                .as_object_mut()
                .unwrap()
                .remove(&original.event);
        }
    }
    if *action != Action::Delete {
        let draft = draft.unwrap();
        let group = template.as_object_mut().ok_or("匹配组格式不支持。")?;
        group.remove("matcher");
        if let Some(matcher) = &draft.matcher {
            group.insert("matcher".into(), Value::String(matcher.clone()));
        }
        group.insert("hooks".into(), json!([draft.handler]));
        let groups = next["hooks"]
            .as_object_mut()
            .unwrap()
            .entry(draft.event.clone())
            .or_insert_with(|| json!([]));
        groups
            .as_array_mut()
            .ok_or("目标事件已有不支持的结构。")?
            .push(template);
    }
    Ok(next)
}

impl HooksState {
    pub(crate) fn scan(&self) -> Result<HookScan, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.scan_with(claude_cli::resolve_home()?, &claude_cli::run)
    }

    fn scan_with(&self, home: PathBuf, runner: &Runner) -> Result<HookScan, String> {
        let mut state = self.0.lock().map_err(|_| "Hooks 状态不可用。")?;
        state.observation = None;
        state.preview = None;
        let path = home.join("settings.json");
        let mut messages = vec![];
        let version = claude_cli::version(&home, runner);
        let mut blocked = version.as_ref().err().cloned().or_else(|| {
            version
                .as_ref()
                .ok()
                .and_then(|v| claude_cli::write_blocked(v))
        });
        let document = Document::read(&path);
        if let Err(e) = &document {
            messages.push(e.clone());
            blocked = Some(e.clone());
        }
        let mut rows = vec![];
        let mut disabled = None;
        if let Ok(doc) = &document {
            disabled = doc.value["disableAllHooks"].as_bool();
            if let Some(events) = doc.value.get("hooks") {
                if !events.is_object() {
                    blocked = Some("用户 hooks 不是事件对象，当前仅供查看。".into());
                }
                rows.extend(flatten(
                    events,
                    &path.display().to_string(),
                    "user",
                    None,
                    &mut messages,
                ));
            }
        }
        let user_rows = rows.clone();
        if version.is_ok() {
            match claude_plugins::list(&home, &["plugin", "list", "--json"], runner)
                .and_then(|v| claude_plugins::installed(&v).cloned())
            {
                Ok(records) => {
                    for record in records.iter().filter(|r| r["scope"] == "user") {
                        let id = record["id"].as_str().unwrap();
                        if claude_plugins::market_id(id).is_none() {
                            continue;
                        }
                        let root = Path::new(
                            record["readFromFolder"]
                                .as_str()
                                .or_else(|| record["installPath"].as_str())
                                .unwrap(),
                        );
                        let (details, sources) = claude_plugin_details::read(root, "installed");
                        messages.extend(details.messages.into_iter().map(|m| format!("{id}：{m}")));
                        for (index, source) in sources.into_iter().enumerate() {
                            rows.extend(flatten(
                                &source.events,
                                &source.path,
                                &format!("plugin:{id}:{index}"),
                                Some((id, record["enabled"].as_bool().unwrap())),
                                &mut messages,
                            ));
                        }
                    }
                }
                Err(e) => {
                    messages.push(format!("插件定义读取失败：{e}"));
                    blocked = Some("插件安装清单不可用，请重新读取后再维护。".into());
                }
            }
        }
        let mut snapshot_id = None;
        if let (Ok(document), Ok(version)) = (document, &version) {
            if blocked.is_none() {
                state.sequence += 1;
                let id = format!("claude-hooks-{}", state.sequence);
                snapshot_id = Some(id.clone());
                state.observation = Some(Observation {
                    id,
                    home: home.clone(),
                    document,
                    version: version.clone(),
                    rows: user_rows,
                });
            }
        }
        Ok(HookScan {
            snapshot_id,
            directory: home.display().to_string(),
            config_path: path.display().to_string(),
            version: version.ok(),
            write_blocked_reason: blocked,
            disable_all_hooks: disabled,
            hooks: rows,
            events: EVENTS.iter().filter_map(|e| schema(e)).collect(),
            messages,
        })
    }

    pub(crate) fn prepare(&self, request: DefinitionRequest) -> Result<Preview, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.prepare_with(request, claude_cli::resolve_home()?)
    }

    fn prepare_with(&self, request: DefinitionRequest, home: PathBuf) -> Result<Preview, String> {
        let mut state = self.0.lock().map_err(|_| "Hooks 状态不可用。")?;
        state.preview = None;
        let observation = state
            .observation
            .as_ref()
            .ok_or("定义清单已过期，请重新读取。")?;
        if observation.id != request.snapshot_id
            || observation.home != home
            || !observation.document.unchanged()
        {
            return Err("定义或用户目录已被修改，请重新读取并确认；表单内容会保留。".into());
        }
        let original = if request.action == Action::Create {
            None
        } else {
            let hook = observation
                .rows
                .iter()
                .find(|r| Some(r.id.as_str()) == request.hook_id.as_deref())
                .ok_or("未找到可编辑的用户定义。")?;
            if let Some(reason) = &hook.read_only_reason {
                return Err(reason.clone());
            }
            Some(hook)
        };
        let next = updated(
            &observation.document.value,
            &request.action,
            original,
            request.draft.as_ref(),
        )?;
        let before =
            original.map(|h| json!({"event":h.event,"matcher":h.matcher,"handler":h.handler}));
        let after = if request.action == Action::Delete {
            None
        } else {
            request
                .draft
                .as_ref()
                .map(|d| json!({"event":d.event,"matcher":d.matcher,"handler":d.handler}))
        };
        let source = observation.document.file.path.display().to_string();
        let observation = state.observation.as_ref().unwrap().clone();
        state.sequence += 1;
        let preview_id = format!("claude-hook-preview-{}", state.sequence);
        state.preview = Some(Prepared {
            id: preview_id.clone(),
            observation,
            next,
        });
        Ok(Preview { preview_id, source, before, after, message: "仅保存所选用户定义，保留其他配置和用户总开关。不会执行 Hook，也不会删除引用的脚本。".into() })
    }

    pub(crate) fn commit(&self, request: CommitRequest) -> Result<ChangeResult, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作锁不可用。")?;
        self.commit_with(request, claude_cli::resolve_home()?, &claude_cli::run)
    }

    fn commit_with(
        &self,
        request: CommitRequest,
        home: PathBuf,
        runner: &Runner,
    ) -> Result<ChangeResult, String> {
        let mut state = self.0.lock().map_err(|_| "Hooks 状态不可用。")?;
        let prepared = state.preview.take().ok_or("确认已失效，请重新预览。")?;
        state.observation = None;
        if prepared.id != request.preview_id
            || prepared.observation.home != home
            || !prepared.observation.document.unchanged()
        {
            return Ok(ChangeResult::new(
                "Conflict",
                "定义或用户目录已被外部修改，请重新读取并预览。",
                false,
            ));
        }
        let version = claude_cli::version(&home, runner)?;
        if version != prepared.observation.version || claude_cli::write_blocked(&version).is_some()
        {
            return Ok(ChangeResult::new(
                "Conflict",
                "Claude CLI 版本已变化，请重新读取。",
                false,
            ));
        }
        prepared.observation.document.write(&prepared.next)?;
        Ok(ChangeResult::new(
            "Succeeded",
            "用户 Hook 定义已保存；请在 Claude 会话中核对加载结果。",
            true,
        ))
    }
}

#[cfg(test)]
#[path = "claude_hook_tests.rs"]
mod tests;
