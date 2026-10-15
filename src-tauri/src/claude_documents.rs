use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub(crate) struct Document {
    pub path: PathBuf,
    pub text: Option<String>,
    pub value: Value,
    identity: Option<(u64, u64)>,
    permissions: Option<fs::Permissions>,
}

impl Document {
    pub(crate) fn read(path: &Path) -> Result<Self, String> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Some(meta),
            Ok(_) => return Err(format!("{} 不是普通文件，仅供查看。", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(format!("无法读取 {}。", path.display())),
        };
        if metadata.as_ref().is_some_and(|m| m.len() > 4 * 1024 * 1024) {
            return Err(format!("{} 超过 4 MiB，不能安全读取。", path.display()));
        }
        let text = metadata
            .as_ref()
            .map(|_| {
                fs::read_to_string(path)
                    .map_err(|_| format!("无法读取 {} 的 UTF-8 内容。", path.display()))
            })
            .transpose()?;
        let value = text
            .as_ref()
            .map(|text| {
                serde_json::from_str::<Value>(text)
                    .map_err(|_| format!("{} 不是有效 JSON，请先修复原文件。", path.display()))
            })
            .transpose()?
            .unwrap_or_else(|| json!({}));
        if !value.is_object() {
            return Err(format!("{} 顶层不是 JSON 对象。", path.display()));
        }
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            metadata.as_ref().map(|m| (m.dev(), m.ino()))
        };
        #[cfg(not(unix))]
        let identity = metadata.as_ref().map(|m| (m.len(), 0));
        Ok(Self {
            path: path.into(),
            text,
            value,
            identity,
            permissions: metadata.map(|m| m.permissions()),
        })
    }

    pub(crate) fn unchanged(&self) -> bool {
        Self::read(&self.path).is_ok_and(|next| {
            next.text == self.text
                && next.identity == self.identity
                && next.permissions == self.permissions
        })
    }

    pub(crate) fn write(&self, value: &Value) -> Result<(), String> {
        let text = hook_text(self.text.as_deref(), &self.value, value)?;
        let parent = self.path.parent().ok_or("无法确定配置目录。")?;
        fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        if let Some(permissions) = &self.permissions {
            temp.as_file()
                .set_permissions(permissions.clone())
                .map_err(|e| e.to_string())?;
        }
        temp.write_all(text.as_bytes())
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        if !self.unchanged() {
            return Err("配置文件已被外部修改，请重新读取并确认。".into());
        }
        if self.text.is_none() {
            temp.persist_noclobber(&self.path)
        } else {
            temp.persist(&self.path)
        }
        .map_err(|e| format!("配置保存失败：{}", e.error))?;
        Ok(())
    }
}

// Replace only the top-level hooks value. Unrelated settings keep their exact bytes.
fn hook_text(text: Option<&str>, previous: &Value, next: &Value) -> Result<String, String> {
    let without_hooks = |value: &Value| {
        let mut value = value.clone();
        if let Some(object) = value.as_object_mut() {
            object.remove("hooks");
        }
        value
    };
    if without_hooks(previous) != without_hooks(next) || !next["hooks"].is_object() {
        return Err("此入口仅可修改用户 hooks 定义。".into());
    }
    let Some(text) = text else {
        return Ok(format!(
            "{}\n",
            serde_json::to_string_pretty(next).map_err(|e| e.to_string())?
        ));
    };
    let rendered = serde_json::to_string_pretty(&next["hooks"])
        .map_err(|e| e.to_string())?
        .replace('\n', "\n  ");
    let mut cursor = text.find('{').ok_or("配置顶层不是对象。")? + 1;
    let mut target = None;
    let mut entries = 0;
    loop {
        while text
            .as_bytes()
            .get(cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            cursor += 1;
        }
        if text.as_bytes().get(cursor) == Some(&b'}') {
            break;
        }
        let mut key = serde_json::Deserializer::from_str(&text[cursor..]).into_iter::<String>();
        let name = key
            .next()
            .ok_or("配置键缺失。")?
            .map_err(|e| e.to_string())?;
        cursor += key.byte_offset();
        while text
            .as_bytes()
            .get(cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            cursor += 1;
        }
        if text.as_bytes().get(cursor) != Some(&b':') {
            return Err("配置键值结构不支持。".into());
        }
        cursor += 1;
        while text
            .as_bytes()
            .get(cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            cursor += 1;
        }
        let start = cursor;
        let mut value = serde_json::Deserializer::from_str(&text[cursor..]).into_iter::<Value>();
        value
            .next()
            .ok_or("配置值缺失。")?
            .map_err(|e| e.to_string())?;
        cursor += value.byte_offset();
        if name == "hooks" {
            if target.is_some() {
                return Err("配置中有重复 hooks 键，请先修复原文件。".into());
            }
            target = Some(start..cursor);
        }
        entries += 1;
        while text
            .as_bytes()
            .get(cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            cursor += 1;
        }
        if text.as_bytes().get(cursor) == Some(&b',') {
            cursor += 1;
        } else if text.as_bytes().get(cursor) != Some(&b'}') {
            return Err("配置结构不支持。".into());
        }
    }
    if let Some(range) = target {
        let mut result = text.to_string();
        result.replace_range(range, &rendered);
        Ok(result)
    } else {
        let insertion = format!(
            "{}\n  \"hooks\": {rendered}\n",
            if entries > 0 { "," } else { "" }
        );
        let mut result = text.to_string();
        result.insert_str(cursor, &insertion);
        Ok(result)
    }
}

pub(crate) fn local_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("声明路径超出插件目录，仅展示声明。".into());
    }
    let root = root.canonicalize().map_err(|_| "本地插件目录不可访问。")?;
    let candidate = root.join(path);
    if let Ok(resolved) = candidate.canonicalize() {
        if !resolved.starts_with(&root) {
            return Err("声明路径指向插件目录之外，仅展示声明。".into());
        }
        return Ok(resolved);
    }
    Ok(candidate)
}
