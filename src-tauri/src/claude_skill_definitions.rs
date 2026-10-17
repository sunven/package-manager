use crate::{
    claude_documents::{local_path, Document},
    claude_plugins,
    codex_skills::files,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Definition {
    pub name: String,
    pub description: String,
    pub path: String,
    pub kind: String,
    pub setting_key: Option<String>,
    pub names: Vec<String>,
    pub plugin_id: Option<String>,
    pub plugin_enabled: Option<bool>,
    pub problem: Option<String>,
    pub disable_model_invocation: bool,
    pub user_invocable: bool,
    #[serde(skip)]
    pub resolved: PathBuf,
    #[serde(skip)]
    pub fingerprint: String,
}

pub(crate) fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

fn metadata(text: &str) -> Result<Value, String> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let Some(rest) = text.strip_prefix("---\n") else {
        return Ok(serde_json::json!({}));
    };
    let end = rest
        .find("\n---")
        .filter(|end| rest[*end + 4..].starts_with('\n') || rest.len() == *end + 4)
        .ok_or("技能 frontmatter 未闭合。")?;
    let value: Value = serde_yaml::from_str(&rest[..end])
        .map_err(|e| format!("技能 frontmatter 无法解析：{e}"))?;
    if !value.is_object() {
        return Err("技能 frontmatter 必须是对象。".into());
    }
    for key in ["name", "description", "argument-hint"] {
        if value.get(key).is_some_and(|v| !v.is_string()) {
            return Err(format!("技能 {key} 不是文本。"));
        }
    }
    for key in ["disable-model-invocation", "user-invocable"] {
        if value.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(format!("技能 {key} 不是布尔值。"));
        }
    }
    Ok(value)
}

pub(crate) fn definition(
    path: &Path,
    key: &str,
    kind: &str,
    plugin: Option<(&str, bool)>,
) -> Definition {
    let mut row = Definition {
        name: key.into(),
        description: String::new(),
        path: path.display().to_string(),
        kind: kind.into(),
        setting_key: matches!(kind, "independent" | "legacy").then(|| key.into()),
        names: vec![key.into()],
        plugin_id: plugin.map(|p| p.0.into()),
        plugin_enabled: plugin.map(|p| p.1),
        problem: None,
        disable_model_invocation: false,
        user_invocable: true,
        resolved: PathBuf::new(),
        fingerprint: String::new(),
    };
    let parsed = (|| -> Result<Value, String> {
        row.resolved = path
            .canonicalize()
            .map_err(|e| format!("定义不可读取：{e}"))?;
        let text = files::read_markdown(path)?;
        let file = fs::metadata(path).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        hash.update(text.as_bytes());
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            hash.update(file.dev().to_le_bytes());
            hash.update(file.ino().to_le_bytes());
        }
        row.fingerprint = format!("{:x}", hash.finalize());
        metadata(&text)
    })();
    match parsed {
        Ok(meta) => {
            if kind != "legacy" {
                if let Some(name) = meta["name"].as_str() {
                    row.name = name.into();
                    if name != key {
                        row.names.push(name.into());
                    }
                }
            }
            row.description = meta["description"].as_str().unwrap_or("").into();
            row.disable_model_invocation =
                meta["disable-model-invocation"].as_bool().unwrap_or(false);
            row.user_invocable = meta["user-invocable"].as_bool().unwrap_or(true);
            if row
                .names
                .iter()
                .any(|name| !name.split(':').all(valid_name))
            {
                row.problem = Some("名称格式尚未验证，仅供查看。".into());
            }
        }
        Err(error) => row.problem = Some(error),
    }
    if let Some((id, _)) = plugin {
        let namespace = id.split('@').next().unwrap_or(id);
        row.name = format!("{namespace}:{}", row.name);
        row.names = row
            .names
            .into_iter()
            .map(|n| format!("{namespace}:{n}"))
            .collect();
    }
    row
}

#[derive(Default)]
pub(crate) struct Inventory {
    pub rows: Vec<Definition>,
    pub warnings: Vec<String>,
}

impl Inventory {
    fn entries(&mut self, path: &Path) -> Vec<PathBuf> {
        match fs::read_dir(path) {
            Ok(entries) => {
                let mut paths = Vec::new();
                for entry in entries.take(2001) {
                    match entry {
                        Ok(e) => paths.push(e.path()),
                        Err(e) => self.warnings.push(e.to_string()),
                    }
                }
                if paths.len() > 2000 {
                    self.warnings
                        .push(format!("{} 条目过多，清单不完整。", path.display()));
                    paths.truncate(2000);
                }
                paths.sort();
                paths
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => {
                self.warnings
                    .push(format!("无法读取 {}：{e}", path.display()));
                vec![]
            }
        }
    }

    fn push(
        &mut self,
        path: &Path,
        key: &str,
        kind: &str,
        plugin: Option<(&str, bool)>,
        boundary: Option<&Path>,
    ) {
        if let Some(boundary) = boundary {
            if path.canonicalize().is_ok_and(|p| !p.starts_with(boundary)) {
                self.warnings.push(format!(
                    "插件定义指向安装目录外，未读取：{}",
                    path.display()
                ));
                return;
            }
        }
        if self.rows.iter().any(|r| Path::new(&r.path) == path) {
            return;
        }
        self.rows.push(definition(path, key, kind, plugin));
    }

    fn skills(
        &mut self,
        root: &Path,
        kind: &str,
        plugin: Option<(&str, bool)>,
        boundary: Option<&Path>,
    ) {
        if fs::symlink_metadata(root.join("SKILL.md")).is_ok() {
            let key = root.file_name().unwrap_or_default().to_string_lossy();
            self.push(&root.join("SKILL.md"), &key, kind, plugin, boundary);
            return;
        }
        for path in self.entries(root) {
            let key = path.file_name().unwrap_or_default().to_string_lossy();
            if key.starts_with('.') {
                continue;
            }
            if kind == "independent" && key == "synced" {
                self.skills(&path, "synced", None, None);
                continue;
            }
            if !path.is_dir()
                && !fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink())
            {
                continue;
            }
            let is_plugin = fs::symlink_metadata(path.join(".claude-plugin/plugin.json")).is_ok();
            if is_plugin && kind == "independent" {
                let id = format!("{key}@skills-dir");
                self.plugin(&path, &id, None);
                continue;
            }
            let definition = path.join("SKILL.md");
            if fs::symlink_metadata(&definition).is_ok() || !path.exists() {
                self.push(&definition, &key, kind, plugin, boundary);
            }
        }
    }

    fn commands(
        &mut self,
        root: &Path,
        path: &Path,
        plugin: Option<(&str, bool)>,
        boundary: Option<&Path>,
        visited: &mut HashSet<PathBuf>,
    ) {
        let resolved = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                let _ = self.entries(path);
                return;
            }
        };
        if boundary.is_some_and(|b| !resolved.starts_with(b)) || !visited.insert(resolved) {
            self.warnings.push(format!(
                "命令目录链接越界或重复，未展开：{}",
                path.display()
            ));
            return;
        }
        if path.strip_prefix(root).unwrap_or(path).components().count() > 16 {
            self.warnings
                .push("旧版命令目录超过 16 层，清单不完整。".into());
            return;
        }
        for child in self.entries(path) {
            if child
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with('.'))
            {
                continue;
            }
            if child.is_dir() {
                self.commands(root, &child, plugin, boundary, visited);
            } else if child.extension().is_some_and(|e| e == "md") {
                let key = child
                    .strip_prefix(root)
                    .unwrap()
                    .with_extension("")
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join(":");
                self.push(
                    &child,
                    &key,
                    if plugin.is_some() { "plugin" } else { "legacy" },
                    plugin,
                    boundary,
                );
            }
        }
    }

    fn plugin(&mut self, root: &Path, id: &str, enabled: Option<bool>) {
        let Ok(root) = root.canonicalize() else {
            self.warnings
                .push(format!("插件 {id} 的安装目录不可读取。"));
            return;
        };
        let plugin = Some((id, enabled.unwrap_or(false)));
        let kind = if id.ends_with("@synced") {
            "synced"
        } else {
            "plugin"
        };
        let start = self.rows.len();
        self.skills(&root.join("skills"), kind, plugin, Some(&root));
        if root.join("SKILL.md").is_file() {
            self.push(
                &root.join("SKILL.md"),
                id.split('@').next().unwrap_or(id),
                kind,
                plugin,
                Some(&root),
            );
        }
        self.commands(
            &root.join("commands"),
            &root.join("commands"),
            plugin,
            Some(&root),
            &mut HashSet::new(),
        );
        match local_path(&root, ".claude-plugin/plugin.json").and_then(|path| Document::read(&path))
        {
            Ok(doc) => {
                for field in ["skills", "commands"] {
                    let values: Vec<&Value> = match doc.value.get(field) {
                        None => vec![],
                        Some(Value::Array(values)) => values.iter().collect(),
                        Some(value) => vec![value],
                    };
                    for value in values {
                        let Some(relative) = value.as_str() else {
                            self.warnings
                                .push(format!("插件 {id} 的 {field} 声明格式不支持。"));
                            continue;
                        };
                        match local_path(&root, relative) {
                            Ok(path) if field == "skills" => {
                                if !path.exists() {
                                    self.warnings
                                        .push(format!("插件 {id} 声明的 {relative} 不可读取。"));
                                }
                                self.skills(&path, kind, plugin, Some(&root));
                            }
                            Ok(path) if path.is_file() => {
                                let key = path.file_stem().unwrap_or_default().to_string_lossy();
                                self.push(&path, &key, kind, plugin, Some(&root));
                            }
                            Ok(path) => self.commands(
                                &path,
                                &path,
                                plugin,
                                Some(&root),
                                &mut HashSet::new(),
                            ),
                            Err(e) => self.warnings.push(format!("插件 {id}：{e}")),
                        }
                    }
                }
            }
            Err(e) => self.warnings.push(e),
        }
        for row in &mut self.rows[start..] {
            row.plugin_enabled = enabled;
            if kind == "synced" {
                row.kind = kind.into();
            }
        }
    }
}

pub(crate) fn read(home: &Path, plugins: Result<&Value, String>) -> Inventory {
    let mut inventory = Inventory::default();
    // Plugin ownership wins even when its installation is inside the user's skills directory.
    match plugins.and_then(|v| claude_plugins::installed(v).map_err(|e| e.to_string())) {
        Ok(rows) => {
            for row in rows.iter().filter(|r| r["scope"] == "user") {
                inventory.plugin(
                    Path::new(row["installPath"].as_str().unwrap()),
                    row["id"].as_str().unwrap(),
                    row["enabled"].as_bool(),
                );
            }
        }
        Err(e) => inventory
            .warnings
            .push(format!("插件技能范围未完整读取：{e}")),
    }
    inventory.skills(&home.join("skills"), "independent", None, None);
    inventory.commands(
        &home.join("commands"),
        &home.join("commands"),
        None,
        None,
        &mut HashSet::new(),
    );
    let source_owned: Vec<_> = inventory
        .rows
        .iter()
        .filter(|row| {
            matches!(row.kind.as_str(), "plugin" | "synced") && !row.resolved.as_os_str().is_empty()
        })
        .cloned()
        .collect();
    for row in &mut inventory.rows {
        if matches!(row.kind.as_str(), "independent" | "legacy") {
            if let Some(owner) = source_owned
                .iter()
                .find(|owner| owner.resolved == row.resolved)
            {
                row.kind = owner.kind.clone();
                row.setting_key = None;
                row.plugin_id = owner.plugin_id.clone();
                row.plugin_enabled = owner.plugin_enabled;
            }
        }
    }
    let mut used = BTreeSet::new();
    let mut duplicates = BTreeSet::new();
    for row in &inventory.rows {
        if matches!(row.kind.as_str(), "independent" | "legacy") {
            for name in &row.names {
                if !used.insert(name) {
                    duplicates.insert(name.clone());
                }
            }
        }
    }
    for row in &mut inventory.rows {
        if row.names.iter().any(|n| duplicates.contains(n))
            && matches!(row.kind.as_str(), "independent" | "legacy")
        {
            row.problem
                .get_or_insert("调用名称与其他定义冲突，仅供查看。".into());
        }
    }
    inventory
        .rows
        .sort_by(|a, b| a.name.cmp(&b.name).then(a.path.cmp(&b.path)));
    inventory
}

pub(crate) fn staged(stage: &files::Staged) -> Result<Definition, String> {
    if !valid_name(&stage.name)
        || matches!(stage.name.as_str(), "synced" | "anthropic-skills")
        || stage.directory.join(".claude-plugin").exists()
    {
        return Err("所选目录是插件、使用保留名称或名称尚未支持，不能作为独立技能安装。".into());
    }
    let row = definition(
        &stage.directory.join("SKILL.md"),
        &stage.name,
        "independent",
        None,
    );
    if let Some(problem) = row.problem {
        return Err(problem);
    }
    if row
        .names
        .iter()
        .any(|name| matches!(name.as_str(), "synced" | "anthropic-skills"))
    {
        return Err("技能使用保留名称，不能安装。".into());
    }
    Ok(row)
}
