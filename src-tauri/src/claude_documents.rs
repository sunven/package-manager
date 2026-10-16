use crate::observed_file::{ObservedFile, ReadError, WriteError};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub(crate) struct Document {
    pub file: ObservedFile,
    pub value: Value,
}

impl Document {
    pub(crate) fn read(path: &Path) -> Result<Self, String> {
        let file = ObservedFile::read(path).map_err(|error| match error {
            ReadError::NotRegularFile => format!("{} 不是普通文件，仅供查看。", path.display()),
            ReadError::TooLarge => format!("{} 超过 4 MiB，不能安全读取。", path.display()),
            ReadError::Metadata(_) => format!("无法读取 {}。", path.display()),
            ReadError::Utf8 => format!("无法读取 {} 的 UTF-8 内容。", path.display()),
        })?;
        let value = file
            .text
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
        Ok(Self { file, value })
    }

    pub(crate) fn unchanged(&self) -> bool {
        self.file.unchanged()
    }

    pub(crate) fn write(&self, value: &Value) -> Result<(), String> {
        let text = hook_text(self.file.text.as_deref(), &self.value, value)?;
        let parent = self.file.path.parent().ok_or("无法确定配置目录。")?;
        fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
        self.file
            .write(&text)
            .map(|_| ())
            .map_err(|error| match error {
                WriteError::NoParent => "无法确定配置目录。".into(),
                WriteError::Prepare(error) | WriteError::Io(error) => error.to_string(),
                WriteError::Conflict => "配置文件已被外部修改，请重新读取并确认。".into(),
                WriteError::Persist(error) => format!("配置保存失败：{error}"),
            })
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
