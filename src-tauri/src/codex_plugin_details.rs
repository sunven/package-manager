use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginDetails {
    origin: Option<String>,
    root: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    author: Option<String>,
    category: Option<String>,
    skills: Option<Vec<String>>,
    mcp_servers: Option<Vec<String>>,
    hooks: Option<Vec<String>>,
    messages: Vec<String>,
}

fn segment(value: &str) -> bool {
    !value.is_empty()
        && Path::new(value).components().count() == 1
        && matches!(
            Path::new(value).components().next(),
            Some(Component::Normal(_))
        )
}

fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|p| matches!(p, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("组件路径超出插件目录，未读取。".into());
    }
    let resolved =
        fs::canonicalize(root.join(path)).map_err(|_| format!("无法读取组件 {relative}。"))?;
    if !resolved.starts_with(root) {
        return Err("组件链接指向插件目录之外，未读取。".into());
    }
    Ok(resolved)
}

fn json(root: &Path, path: &str) -> Result<Value, String> {
    let path = inside(root, path)?;
    let meta = fs::metadata(&path).map_err(|_| "无法读取插件说明。")?;
    if !meta.is_file() || meta.len() > 1024 * 1024 {
        return Err("插件说明过大或不是普通文件，未读取。".into());
    }
    let content = fs::read(&path).map_err(|_| "无法读取插件说明。")?;
    serde_json::from_slice(&content).map_err(|_| "插件说明不是有效的 JSON。".into())
}

fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
}

// Cache paths locate metadata only. The caller has already obtained installation facts from Codex.
#[allow(clippy::too_many_arguments)]
pub(crate) fn read(
    home: &Path,
    name: &str,
    market: &str,
    installed: bool,
    version: Option<&str>,
    installed_path: Option<&Path>,
    source: &Value,
) -> PluginDetails {
    let mut details = PluginDetails::default();
    let cached = installed
        .then(|| {
            installed_path.map(Path::to_path_buf).or_else(|| {
                version
                    .filter(|v| segment(v))
                    .filter(|_| segment(name) && segment(market))
                    .map(|v| home.join("plugins/cache").join(market).join(name).join(v))
            })
        })
        .flatten()
        .filter(|p| p.is_absolute() && p.is_dir());
    let local = (source["source"] == "local")
        .then(|| source["path"].as_str().map(PathBuf::from))
        .flatten()
        .filter(|p| p.is_absolute() && p.is_dir());
    let origin = if cached.is_some() {
        "installed"
    } else {
        "source"
    };
    let Some(root) = cached.or(local).and_then(|p| fs::canonicalize(p).ok()) else {
        details.messages.push(
            "详情尚不可读取。未下载的远程插件仅展示目录信息；本地文件可读后可查看组件。".into(),
        );
        return details;
    };
    details.origin = Some(origin.into());
    details.root = Some(root.display().to_string());
    let portable = root.join("plugin.json").is_file();
    let manifest_path = if portable {
        "plugin.json"
    } else if root.join(".codex-plugin/plugin.json").is_file() {
        ".codex-plugin/plugin.json"
    } else {
        ".claude-plugin/plugin.json"
    };
    let manifest = match json(&root, manifest_path) {
        Ok(value) if value.is_object() => value,
        _ => {
            details
                .messages
                .push("插件 manifest 缺失或无法解析，基础安装信息仍可查看。".into());
            return details;
        }
    };
    let overlay = if portable {
        if manifest["extensions"]["com.openai"].is_object() {
            manifest["extensions"]["com.openai"].clone()
        } else if root.join(".codex-plugin/plugin.json").exists() {
            match json(&root, ".codex-plugin/plugin.json") {
                Ok(value) => value,
                Err(error) => {
                    details.messages.push(error);
                    Value::Null
                }
            }
        } else {
            Value::Null
        }
    } else {
        manifest.clone()
    };
    let interface = &overlay["interface"];
    details.display_name = text(&interface["displayName"]);
    details.description = text(&interface["longDescription"])
        .or_else(|| text(&interface["shortDescription"]))
        .or_else(|| text(&manifest["description"]));
    details.author = text(&manifest["author"]["name"])
        .or_else(|| text(&manifest["author"]))
        .or_else(|| text(&interface["developerName"]));
    details.category = text(&interface["category"]);
    let skills = if portable {
        Value::Null
    } else {
        manifest["skills"].clone()
    };
    details.skills = collect_skills(&root, &skills)
        .map_err(|e| details.messages.push(e))
        .ok();
    let mcp = if portable {
        Value::String("./mcp.json".into())
    } else {
        overlay
            .get("mcpServers")
            .cloned()
            .unwrap_or(Value::String("./.mcp.json".into()))
    };
    details.mcp_servers = collect_configs(
        &root,
        &mcp,
        "mcpServers",
        !portable && overlay.get("mcpServers").is_some(),
        true,
    )
    .map_err(|e| details.messages.push(e))
    .ok();
    let hooks = overlay
        .get("hooks")
        .cloned()
        .unwrap_or(Value::String("./hooks/hooks.json".into()));
    details.hooks = collect_configs(
        &root,
        &hooks,
        "hooks",
        overlay.get("hooks").is_some(),
        false,
    )
    .map_err(|e| details.messages.push(e))
    .ok();
    details
}

fn collect_skills(root: &Path, declaration: &Value) -> Result<Vec<String>, String> {
    let paths: Vec<&str> = match declaration {
        Value::Null => vec!["./skills"],
        Value::String(path) => vec![path],
        Value::Array(paths) => paths
            .iter()
            .map(|p| p.as_str().ok_or("技能路径格式无法识别。".into()))
            .collect::<Result<_, String>>()?,
        _ => return Err("技能路径格式无法识别。".into()),
    };
    let mut names = Vec::new();
    for path in paths {
        if declaration.is_null() && !root.join(path).exists() {
            continue;
        }
        let directory = inside(root, path)?;
        if directory.is_file() || directory.join("SKILL.md").is_file() {
            let skill = if directory.is_file() {
                directory.parent().unwrap()
            } else {
                &directory
            };
            names.push(
                skill
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            );
            continue;
        }
        for entry in fs::read_dir(&directory).map_err(|_| "无法读取技能目录。")? {
            let entry = entry.map_err(|_| "技能目录读取不完整。")?;
            if entry.path().join("SKILL.md").is_file() {
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| "技能目录越界。")?
                    .to_path_buf();
                inside(root, &relative.to_string_lossy())?;
                names.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

fn collect_configs(
    root: &Path,
    declaration: &Value,
    field: &str,
    explicit: bool,
    allow_bare: bool,
) -> Result<Vec<String>, String> {
    if let Value::Array(values) = declaration {
        let mut all = Vec::new();
        for value in values {
            all.extend(collect_configs(root, value, field, true, allow_bare)?);
        }
        all.sort();
        all.dedup();
        return Ok(all);
    }
    let value = if let Some(path) = declaration.as_str() {
        if !explicit && !root.join(path).exists() {
            return Ok(Vec::new());
        }
        json(root, path)?
    } else {
        declaration.clone()
    };
    let object = value
        .get(field)
        .or_else(|| allow_bare.then_some(&value))
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{field} 声明无法解析，组件清单未知。"))?;
    let mut names = object
        .keys()
        .filter(|key| key.as_str() != "$schema")
        .cloned()
        .collect::<Vec<_>>();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn write(root: &Path, path: &str, value: Value) {
        let target = root.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, value.to_string()).unwrap();
    }
    #[test]
    fn portable_identity_and_inline_extension_replace_compatibility_overlay() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        write(
            &root,
            "plugin.json",
            json!({"name":"test", "author":{"name":"Root author"}, "extensions":{"com.openai":{"interface":{"displayName":"Portable"},"hooks":{"hooks":{"SessionStart":[]}}}}}),
        );
        write(
            &root,
            ".codex-plugin/plugin.json",
            json!({"interface":{"displayName":"Old"},"hooks":{"hooks":{"Stop":[]}}}),
        );
        write(
            &root,
            "mcp.json",
            json!({"mcpServers":{"docs":{"type":"streamable-http","url":"https://example.com"}}}),
        );
        fs::create_dir_all(root.join("skills/hello")).unwrap();
        fs::write(root.join("skills/hello/SKILL.md"), "hello").unwrap();
        let details = read(
            &root,
            "test",
            "market",
            false,
            None,
            None,
            &json!({"source":"local","path":root}),
        );
        assert_eq!(details.display_name.as_deref(), Some("Portable"));
        assert_eq!(details.author.as_deref(), Some("Root author"));
        assert_eq!(details.hooks.unwrap(), vec!["SessionStart"]);
        assert_eq!(details.mcp_servers.unwrap(), vec!["docs"]);
        assert_eq!(details.skills.unwrap(), vec!["hello"]);
    }
    #[test]
    fn remote_unknown_and_broken_components_are_not_reported_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let remote = read(
            &root,
            "test",
            "market",
            false,
            None,
            None,
            &json!({"source":"git"}),
        );
        assert!(remote.skills.is_none());
        write(
            &root,
            ".codex-plugin/plugin.json",
            json!({"hooks":"../outside.json", "mcpServers":"./missing.json"}),
        );
        let local = read(
            &root,
            "test",
            "market",
            false,
            None,
            None,
            &json!({"source":"local","path":root}),
        );
        assert!(local.hooks.is_none());
        assert!(local.mcp_servers.is_none());
        assert_eq!(local.messages.len(), 2);
    }
    #[test]
    fn installed_metadata_uses_the_installed_version_instead_of_changed_source() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        write(
            &root,
            "plugins/cache/market/test/1.0/plugin.json",
            json!({"description":"Installed"}),
        );
        write(
            &root,
            "source/plugin.json",
            json!({"description":"Source changed"}),
        );
        let details = read(
            &root,
            "test",
            "market",
            true,
            Some("1.0"),
            None,
            &json!({"source":"local","path":root.join("source")}),
        );
        assert_eq!(details.description.as_deref(), Some("Installed"));
        assert_eq!(details.origin.as_deref(), Some("installed"));
    }
}
