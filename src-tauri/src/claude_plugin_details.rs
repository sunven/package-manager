use crate::claude_documents::{local_path, Document};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Details {
    pub origin: Option<String>,
    pub root: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub skills: Vec<String>,
    pub agents: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub hooks: Vec<String>,
    pub messages: Vec<String>,
}

pub(crate) struct HookSource {
    pub path: String,
    pub events: Value,
}

fn strings(value: &Value) -> Vec<String> {
    if let Some(s) = value.as_str() {
        vec![s.into()]
    } else {
        value
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn names(root: &Path, directory: &str, skills: bool, messages: &mut Vec<String>) -> Vec<String> {
    let path = match local_path(root, directory) {
        Ok(path) => path,
        Err(message) => {
            messages.push(message);
            return vec![];
        }
    };
    if !path.exists() {
        return vec![];
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        messages.push(format!("无法读取 {directory}，组件信息可能不完整。"));
        return vec![];
    };
    let mut result = Vec::new();
    for entry in entries.take(501).flatten() {
        if result.len() == 500 {
            messages.push("组件条目过多，仅展示前 500 项。".into());
            break;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if (skills && kind.is_dir() && entry.path().join("SKILL.md").is_file())
            || (!skills && kind.is_file() && entry.path().extension().is_some_and(|e| e == "md"))
        {
            result.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    result.sort();
    result
}

fn hook_file(
    root: &Path,
    relative: &str,
    required: bool,
    sources: &mut Vec<HookSource>,
    messages: &mut Vec<String>,
) {
    let path = match local_path(root, relative) {
        Ok(path) => path,
        Err(e) => {
            messages.push(e);
            return;
        }
    };
    match Document::read(&path) {
        Ok(doc) if doc.file.text.is_none() && !required => (),
        Ok(doc) if doc.file.text.is_some() && doc.value["hooks"].is_object() => {
            sources.push(HookSource {
                path: path.display().to_string(),
                events: doc.value["hooks"].clone(),
            });
        }
        Ok(_) => messages.push(format!("{relative} 缺失或没有有效 hooks 对象。")),
        Err(e) => messages.push(e),
    }
}

fn declared_hooks(
    root: &Path,
    value: &Value,
    sources: &mut Vec<HookSource>,
    messages: &mut Vec<String>,
) {
    match value {
        Value::String(path) => hook_file(root, path, true, sources, messages),
        Value::Array(values) => {
            for value in values {
                declared_hooks(root, value, sources, messages);
            }
        }
        Value::Object(_) => sources.push(HookSource {
            path: root
                .join(".claude-plugin/plugin.json")
                .display()
                .to_string(),
            events: value.clone(),
        }),
        _ => messages.push("插件 hooks 声明格式不支持，无法完整读取。".into()),
    }
}

pub(crate) fn read(root: &Path, origin: &str) -> (Details, Vec<HookSource>) {
    let mut details = Details {
        origin: Some(origin.into()),
        root: Some(root.display().to_string()),
        ..Default::default()
    };
    if !root.is_dir() {
        details
            .messages
            .push("本地插件目录不可访问，组件信息未知。".into());
        return (details, vec![]);
    }
    let manifest =
        local_path(root, ".claude-plugin/plugin.json").and_then(|path| Document::read(&path));
    let manifest = match manifest {
        Ok(doc) if doc.file.text.is_some() => doc.value,
        Ok(_) => {
            details
                .messages
                .push("插件未提供本地 manifest，元数据可能不完整。".into());
            Value::Null
        }
        Err(e) => {
            details.messages.push(e);
            Value::Null
        }
    };
    details.description = manifest["description"].as_str().map(str::to_string);
    details.author = manifest["author"]
        .as_str()
        .or_else(|| manifest["author"]["name"].as_str())
        .map(str::to_string);
    details.skills = names(root, "skills", true, &mut details.messages);
    details.skills.extend(strings(&manifest["skills"]));
    details.agents = names(root, "agents", false, &mut details.messages);
    details.agents.extend(strings(&manifest["agents"]));
    let mut mcp = vec![Value::String(".mcp.json".into())];
    if let Some(value) = manifest.get("mcpServers") {
        if let Some(values) = value.as_array() {
            mcp.extend(values.clone());
        } else {
            mcp.push(value.clone());
        }
    }
    for item in mcp {
        let servers = if let Some(relative) = item.as_str() {
            match local_path(root, relative).and_then(|path| Document::read(&path)) {
                Ok(doc) if doc.file.text.is_some() => doc.value,
                Ok(_) => {
                    if relative != ".mcp.json" {
                        details
                            .messages
                            .push(format!("MCP 声明 {relative} 不可读取。"));
                    }
                    continue;
                }
                Err(e) => {
                    details.messages.push(e);
                    continue;
                }
            }
        } else {
            item
        };
        if let Some(map) = servers.get("mcpServers").unwrap_or(&servers).as_object() {
            details.mcp_servers.extend(map.keys().cloned());
        } else {
            details.messages.push("MCP 声明格式不支持。".into());
        }
    }
    let mut sources = vec![];
    hook_file(
        root,
        "hooks/hooks.json",
        false,
        &mut sources,
        &mut details.messages,
    );
    if let Some(value) = manifest.get("hooks") {
        declared_hooks(root, value, &mut sources, &mut details.messages);
    }
    details.hooks = sources
        .iter()
        .flat_map(|source| {
            source
                .events
                .as_object()
                .into_iter()
                .flat_map(|map| map.keys().cloned())
        })
        .collect();
    (details, sources)
}
