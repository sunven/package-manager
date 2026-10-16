pub(super) use crate::observed_file::ObservedFile as FileSnapshot;
use crate::observed_file::{ReadError, WriteError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use toml_edit::{Array, ArrayOfTables, DocumentMut, Item, Table};

pub(super) const EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "session_start"),
    ("SessionEnd", "session_end"),
    ("SubagentStart", "subagent_start"),
    ("SubagentStop", "subagent_stop"),
    ("UserPromptSubmit", "user_prompt_submit"),
    ("PreToolUse", "pre_tool_use"),
    ("PermissionRequest", "permission_request"),
    ("PostToolUse", "post_tool_use"),
    ("PreCompact", "pre_compact"),
    ("PostCompact", "post_compact"),
    ("Stop", "stop"),
    ("Interrupt", "interrupt"),
];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Format {
    Json,
    Toml,
}

impl Format {
    pub(super) fn filename(self) -> &'static str {
        match self {
            Self::Json => "hooks.json",
            Self::Toml => "config.toml",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Location {
    pub event: String,
    pub group: usize,
    pub handler: usize,
}

impl Location {
    // This adapter is gated to the experimentally verified CLI version AND checked against
    // every native user entry. This is deliberately not treated as a stable Codex protocol.
    pub fn key(&self, path: &Path) -> Result<String, String> {
        let event = EVENTS
            .iter()
            .find(|e| e.0 == self.event)
            .ok_or("当前事件尚未验证，不能维护。")?
            .1;
        Ok(format!(
            "{}:{event}:{}:{}",
            path.display(),
            self.group,
            self.handler
        ))
    }
    pub fn id(&self, format: Format) -> String {
        format!(
            "{}:{}:{}:{}",
            format.filename(),
            self.event,
            self.group,
            self.handler
        )
    }
}

#[derive(Clone)]
pub(super) struct Definition {
    pub location: Location,
    pub matcher: Option<String>,
    pub handler: Value,
    pub group: Value,
}

#[derive(Clone)]
pub(super) struct Source {
    pub format: Format,
    pub file: FileSnapshot,
    pub value: Value,
    pub toml: Option<DocumentMut>,
}

impl Source {
    pub fn read(home: &Path, format: Format) -> Result<Self, String> {
        let path = home.join(format.filename());
        let file = FileSnapshot::read(&path).map_err(|error| match error {
            ReadError::NotRegularFile => {
                format!("{} 不是普通文件，定义维护仅供查看。", path.display())
            }
            ReadError::TooLarge => "配置文件超过 4 MiB，当前仅供查看。".into(),
            ReadError::Metadata(error) => format!("无法读取 {}：{error}", path.display()),
            ReadError::Utf8 => format!("无法读取 {} 的 UTF-8 内容。", path.display()),
        })?;
        let (value, toml) = match format {
            Format::Json => (
                file.text
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()
                    .map_err(|_| "hooks.json 无法解析，请在文件中修复 JSON 语法后刷新。")?
                    .unwrap_or_else(|| json!({"hooks":{}})),
                None,
            ),
            Format::Toml => {
                let text = file.text.as_deref().unwrap_or("");
                let document = text
                    .parse::<DocumentMut>()
                    .map_err(|_| "config.toml 无法解析，请修复后刷新。")?;
                let value = toml_edit::de::from_str::<Value>(text)
                    .map_err(|_| "无法读取 TOML 定义结构。")?;
                (value, Some(document))
            }
        };
        if !value.is_object() {
            return Err("Hook 配置根节点必须是对象。".into());
        }
        Ok(Self {
            format,
            file,
            value,
            toml,
        })
    }

    pub fn write(&self, text: &str) -> Result<FileSnapshot, String> {
        self.file.write(text).map_err(|error| match error {
            WriteError::NoParent => "无法确定配置目录。".into(),
            WriteError::Prepare(error) => format!("无法准备保存：{error}"),
            WriteError::Io(error) => error.to_string(),
            WriteError::Conflict => "配置文件已被外部修改，请刷新并重新确认。".into(),
            WriteError::Persist(error) => format!("配置保存失败：{error}"),
        })
    }

    pub fn definitions(&self) -> Result<Vec<Definition>, String> {
        let Some(hooks) = self.value.get("hooks") else {
            return Ok(vec![]);
        };
        let hooks = hooks.as_object().ok_or("hooks 必须是对象。")?;
        let mut definitions = vec![];
        for (event, groups) in hooks {
            if self.format == Format::Toml && event == "state" {
                continue;
            }
            let groups = groups
                .as_array()
                .ok_or_else(|| format!("{event} 的定义结构无法维护。"))?;
            for (group_index, group) in groups.iter().enumerate() {
                let matcher = match group.get("matcher") {
                    None => None,
                    Some(Value::String(s)) => Some(s.clone()),
                    _ => return Err(format!("{event} 的匹配条件必须是字符串。")),
                };
                let handlers = group
                    .get("hooks")
                    .and_then(Value::as_array)
                    .ok_or("匹配组必须包含 hooks 数组。")?;
                for (handler_index, handler) in handlers.iter().enumerate() {
                    if !handler.is_object() {
                        return Err("处理程序必须是对象。".into());
                    }
                    definitions.push(Definition {
                        location: Location {
                            event: event.clone(),
                            group: group_index,
                            handler: handler_index,
                        },
                        matcher: matcher.clone(),
                        handler: handler.clone(),
                        group: group.clone(),
                    });
                }
            }
        }
        Ok(definitions)
    }

    pub fn text(&self) -> Result<String, String> {
        match &self.toml {
            Some(doc) => Ok(doc.to_string()),
            None => serde_json::to_string_pretty(&self.value)
                .map(|s| s + "\n")
                .map_err(|e| e.to_string()),
        }
    }

    pub fn replace_handler(&mut self, loc: &Location, next: Option<&Value>) -> Result<(), String> {
        let before = self.value["hooks"][&loc.event][loc.group]["hooks"][loc.handler].clone();
        let handlers = self.value["hooks"][&loc.event][loc.group]["hooks"]
            .as_array_mut()
            .ok_or("定义已变化。")?;
        if let Some(next) = next {
            handlers[loc.handler] = next.clone();
        } else {
            handlers.remove(loc.handler);
        }
        if let Some(doc) = &mut self.toml {
            let events = doc
                .get_mut("hooks")
                .and_then(Item::as_table_like_mut)
                .ok_or("无法维护 TOML hooks。")?;
            let event = events.get_mut(&loc.event).ok_or("事件已变化。")?;
            let mut groups = table_array(event)?;
            let group = groups[loc.group]
                .as_table_like_mut()
                .ok_or("无法维护 TOML 匹配组。")?;
            let array = group.get("hooks").ok_or("处理程序已变化。")?;
            let mut handlers = table_array(array)?;
            if let Some(next) = next {
                patch_table(&mut handlers[loc.handler], &before, next)?;
            } else {
                handlers.remove(loc.handler);
            }
            let updated = rebuild_array(array, handlers)?;
            group.insert("hooks", updated);
            *event = rebuild_array(event, groups)?;
        }
        Ok(())
    }

    pub fn append_group(
        &mut self,
        event: &str,
        matcher: Option<&str>,
        handler: &Value,
    ) -> Result<Location, String> {
        let mut group = json!({"hooks":[handler]});
        if let Some(matcher) = matcher {
            group["matcher"] = matcher.into();
        }
        let root = self.value.as_object_mut().ok_or("配置无效。")?;
        let events = root
            .entry("hooks")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("hooks 无效。")?;
        let groups = events
            .entry(event)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or("事件结构无效。")?;
        let index = groups.len();
        groups.push(group.clone());
        if let Some(doc) = &mut self.toml {
            let events = doc
                .entry("hooks")
                .or_insert(Item::Table(Table::new()))
                .as_table_like_mut()
                .ok_or("hooks 无效。")?;
            let array = events
                .entry(event)
                .or_insert(Item::ArrayOfTables(ArrayOfTables::new()));
            let mut groups = table_array(array)?;
            groups.push(json_item(&group)?);
            *array = rebuild_array(array, groups)?;
        }
        Ok(Location {
            event: event.into(),
            group: index,
            handler: 0,
        })
    }

    pub fn state(&self) -> Result<Value, String> {
        match self.value.pointer("/hooks/state") {
            None => Ok(json!({})),
            Some(value) if value.is_object() => Ok(value.clone()),
            _ => Err("hooks.state 格式无法安全维护。".into()),
        }
    }

    pub fn set_state(&mut self, key: &str, value: Option<&Value>) -> Result<(), String> {
        let doc = self.toml.as_mut().ok_or("状态只能保存在用户 TOML 中。")?;
        let hooks = doc
            .entry("hooks")
            .or_insert(Item::Table(Table::new()))
            .as_table_like_mut()
            .ok_or("hooks 格式无效。")?;
        let state = hooks
            .entry("state")
            .or_insert(Item::Table(Table::new()))
            .as_table_like_mut()
            .ok_or("hooks.state 格式无效。")?;
        match value {
            Some(value) => {
                let old = self.value["hooks"]["state"][key].clone();
                if let Some(item) = state.get_mut(key) {
                    patch_table(item, &old, value)?;
                } else {
                    state.insert(key, json_item(value)?);
                }
            }
            None => {
                state.remove(key);
            }
        }
        self.value = toml_edit::de::from_str(&doc.to_string()).map_err(|_| "状态无法序列化。")?;
        Ok(())
    }
}

fn json_item(value: &Value) -> Result<Item, String> {
    let mut doc = toml_edit::ser::to_document(&json!({"value":value}))
        .map_err(|_| "该值无法保存为 TOML（例如 null）。")?;
    doc.remove("value").ok_or("值无法保存。".into())
}

fn patch_table(item: &mut Item, old: &Value, next: &Value) -> Result<(), String> {
    let table = item
        .as_table_like_mut()
        .ok_or("无法无损维护该 TOML 结构。")?;
    let next = next.as_object().ok_or("配置字段必须是对象。")?;
    let remove: Vec<String> = table
        .iter()
        .filter(|(key, _)| !next.contains_key(*key))
        .map(|(key, _)| key.into())
        .collect();
    for key in remove {
        table.remove(&key);
    }
    for (key, value) in next {
        if old.get(key) == Some(value) {
            continue;
        }
        let mut item = json_item(value)?;
        if let (Some(previous), Some(new)) =
            (table.get(key).and_then(Item::as_value), item.as_value_mut())
        {
            *new.decor_mut() = previous.decor().clone();
        }
        table.insert(key, item);
    }
    Ok(())
}

fn table_array(item: &Item) -> Result<Vec<Item>, String> {
    if let Some(array) = item.as_array_of_tables() {
        return Ok(array.iter().cloned().map(Item::Table).collect());
    }
    if let Some(array) = item.as_array() {
        if array.iter().all(|item| item.is_inline_table()) {
            return Ok(array.iter().cloned().map(Item::Value).collect());
        }
    }
    Err("此 TOML 数组结构无法无损维护。".into())
}

fn rebuild_array(template: &Item, items: Vec<Item>) -> Result<Item, String> {
    if template.is_array_of_tables() && !items.is_empty() {
        let mut array = ArrayOfTables::new();
        for item in items {
            array.push(item.into_table().map_err(|_| "分组无法转换。")?);
        }
        Ok(Item::ArrayOfTables(array))
    } else {
        let mut array = Array::new();
        if let Some(old) = template.as_array() {
            *array.decor_mut() = old.decor().clone();
        }
        for item in items {
            array.push(item.into_value().map_err(|_| "处理程序无法转换。")?);
        }
        Ok(Item::Value(toml_edit::Value::Array(array)))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Fields {
    pub kind: String,
    pub command: Option<String>,
    pub command_windows: Option<String>,
    pub server: Option<String>,
    pub tool: Option<String>,
    pub input: Option<Value>,
    pub timeout: Option<u64>,
    pub status_message: Option<String>,
    #[serde(rename = "async")]
    pub is_async: Option<bool>,
    pub additional_context_limit: Option<u64>,
}

impl Fields {
    pub fn validate(&self, event: &str, matcher: Option<&str>) -> Result<(), String> {
        if !EVENTS.iter().any(|e| e.0 == event) {
            return Err("请选择受支持的事件。".into());
        }
        if let Some(matcher) = matcher {
            if matches!(event, "Stop" | "Interrupt" | "UserPromptSubmit") {
                return Err("此事件不使用匹配条件。".into());
            }
            regex::Regex::new(matcher).map_err(|_| "匹配条件不是有效的正则表达式。")?;
        }
        if self.timeout == Some(0)
            || (matches!(event, "SessionEnd" | "Interrupt") && self.timeout.is_some_and(|v| v > 3))
        {
            return Err("超时必须大于 0；SessionEnd 与 Interrupt 最多 3 秒。".into());
        }
        match self.kind.as_str() {
            "command"
                if self
                    .command
                    .as_deref()
                    .is_some_and(|v| !v.trim().is_empty()) =>
            {
                if self.server.is_some() || self.tool.is_some() || self.input.is_some() {
                    return Err("命令不能包含 MCP 字段。".into());
                }
            }
            "mcp_tool"
                if self.server.as_deref().is_some_and(|v| !v.trim().is_empty())
                    && self.tool.as_deref().is_some_and(|v| !v.trim().is_empty()) =>
            {
                if event == "SessionEnd" {
                    return Err("SessionEnd 不支持 MCP Hook。".into());
                }
                if self.input.as_ref().is_some_and(|v| !v.is_object()) {
                    return Err("MCP input 必须是 JSON 对象。".into());
                }
                if self.command.is_some()
                    || self.command_windows.is_some()
                    || self.is_async.is_some()
                    || self.additional_context_limit.is_some()
                {
                    return Err("MCP Hook 不支持命令或异步字段。".into());
                }
            }
            _ => return Err("请填写命令，或 MCP 服务和工具名称。".into()),
        }
        Ok(())
    }

    pub fn apply(&self, previous: &Value) -> Value {
        let mut next = previous.as_object().cloned().unwrap_or_default();
        next.insert("type".into(), self.kind.clone().into());
        for (key, alias, value) in [
            (
                "command",
                "command",
                self.command.clone().map(Value::String),
            ),
            (
                "commandWindows",
                "command_windows",
                self.command_windows.clone().map(Value::String),
            ),
            ("server", "server", self.server.clone().map(Value::String)),
            ("tool", "tool", self.tool.clone().map(Value::String)),
            ("input", "input", self.input.clone()),
            ("timeout", "timeout", self.timeout.map(Value::from)),
            (
                "statusMessage",
                "statusMessage",
                self.status_message.clone().map(Value::String),
            ),
            ("async", "async", self.is_async.map(Value::Bool)),
            (
                "additionalContextLimit",
                "additionalContextLimit",
                self.additional_context_limit.map(Value::from),
            ),
        ] {
            let chosen = if key != alias && next.contains_key(alias) && !next.contains_key(key) {
                alias
            } else {
                key
            };
            next.remove(if chosen == key { alias } else { key });
            if let Some(value) = value {
                next.insert(chosen.into(), value);
            } else {
                next.remove(chosen);
            }
        }
        Value::Object(next)
    }
}
