//! Bounded local POM inheritance. Values from every declared profile are kept;
//! Maven goals, extensions and profile activation are never executed.
use super::{child_text, interpolate, ModelBudget, ObservedFile, Pom};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

type Properties = BTreeMap<String, BTreeSet<String>>;

const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 4 * 1024 * 1024;

pub(super) struct ArchiveObservation {
    path: PathBuf,
    digest: Vec<u8>,
    metadata: fs::Metadata,
}

impl ArchiveObservation {
    pub fn unchanged(&self) -> bool {
        read_archive(&self.path).is_ok_and(|(bytes, metadata)| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if (metadata.dev(), metadata.ino()) != (self.metadata.dev(), self.metadata.ino()) {
                    return false;
                }
            }
            metadata.permissions() == self.metadata.permissions()
                && Sha256::digest(&bytes).as_slice() == self.digest
        })
    }
}

fn read_archive(path: &Path) -> Result<(Vec<u8>, fs::Metadata), String> {
    check_model_path(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_ARCHIVE_BYTES
    {
        return Err("模型 JAR 不是普通文件或超过 64 MiB 上限".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("模型 JAR 超过 64 MiB 上限".into());
    }
    Ok((bytes, metadata))
}

#[derive(Clone, Default)]
struct RawPom {
    project: bool,
    group: Option<String>,
    artifact: Option<String>,
    version: Option<String>,
    packaging: Option<String>,
    parent: Option<(String, String, String)>,
    relative: Option<String>,
    base: Properties,
    profiles: Properties,
    references: Vec<(String, String)>,
    modules: Vec<String>,
}

pub(super) struct ModelReader<'a> {
    repository: &'a Path,
    pub budget: ModelBudget,
    pub inputs: Vec<ObservedFile>,
    pub archives: Vec<ArchiveObservation>,
    embedded: BTreeMap<PathBuf, (PathBuf, String)>,
    raw: BTreeMap<PathBuf, RawPom>,
    models: BTreeMap<PathBuf, Pom>,
    reading: BTreeSet<PathBuf>,
}

impl<'a> ModelReader<'a> {
    pub fn new(repository: &'a Path, budget: ModelBudget) -> Self {
        Self {
            repository,
            budget,
            inputs: Vec::new(),
            archives: Vec::new(),
            embedded: BTreeMap::new(),
            raw: BTreeMap::new(),
            models: BTreeMap::new(),
            reading: BTreeSet::new(),
        }
    }

    pub fn register_embedded(&mut self, pom: PathBuf, jar: PathBuf, ga: &str) {
        if let Some((group, artifact)) = ga.split_once(':') {
            self.embedded.insert(
                pom,
                (jar, format!("META-INF/maven/{group}/{artifact}/pom.xml")),
            );
        }
    }

    fn raw(&mut self, path: &Path) -> Result<RawPom, String> {
        if let Some(raw) = self.raw.get(path) {
            return Ok(raw.clone());
        }
        check_model_path(path)?;
        let observed = ObservedFile::read(path)
            .map_err(|_| format!("{} 无法读取为普通 XML 文件", path.display()))?;
        let text = if let Some(text) = &observed.text {
            text.clone()
        } else if let Some((jar, entry)) = self.embedded.get(path) {
            let (bytes, metadata) = read_archive(jar)?;
            let observation = ArchiveObservation {
                path: jar.clone(),
                digest: Sha256::digest(&bytes).to_vec(),
                metadata,
            };
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
                .map_err(|error| format!("{}：{error}", jar.display()))?;
            let model = archive
                .by_name(entry)
                .map_err(|_| format!("{} 缺少内嵌 POM", jar.display()))?;
            if model.size() > MAX_XML_BYTES {
                return Err("内嵌 POM 超过 4 MiB 上限".into());
            }
            let mut text = String::new();
            model
                .take(MAX_XML_BYTES + 1)
                .read_to_string(&mut text)
                .map_err(|_| "内嵌 POM 无法读取为 UTF-8 XML")?;
            if text.len() as u64 > MAX_XML_BYTES {
                return Err("内嵌 POM 超过 4 MiB 上限".into());
            }
            self.archives.push(observation);
            text
        } else {
            return Err(format!("{} 不存在", path.display()));
        };
        self.budget.before_read("POM 模型分析")?;
        let raw = parse(&text).map_err(|error| format!("{}：{error}", path.display()))?;
        self.inputs.push(observed);
        self.raw.insert(path.into(), raw.clone());
        Ok(raw)
    }

    pub fn read(&mut self, path: &Path) -> Result<Pom, String> {
        check_model_path(path)?;
        let path = if self.embedded.contains_key(path) {
            path.into()
        } else {
            path.canonicalize()
                .map_err(|_| format!("{} 不存在", path.display()))?
        };
        if let Some(pom) = self.models.get(&path) {
            return Ok(pom.clone());
        }
        if self.reading.len() >= 20 || !self.reading.insert(path.clone()) {
            return Err(format!("{} 的父 POM 递归或深度超过上限", path.display()));
        }
        let result = self
            .assemble(&path)
            .map_err(|error| format!("{}：{error}", path.display()));
        self.reading.remove(&path);
        if let Ok(pom) = &result {
            self.models.insert(path, pom.clone());
        }
        result
    }

    fn assemble(&mut self, path: &Path) -> Result<Pom, String> {
        let raw = self.raw(path)?;
        let mut local = raw.base.clone();
        merge(&mut local, &raw.profiles);
        aliases(&mut local, &raw);
        let parent = if let Some((group, artifact, version)) = &raw.parent {
            let mut matched = None;
            if let Some(relative) = &raw.relative {
                if !relative.is_empty() {
                    if relative.contains("${") {
                        return Err("本地父 POM 路径包含无法确认的属性".into());
                    }
                    let candidate = path.parent().unwrap().join(relative);
                    check_model_path(&candidate)?;
                    let candidate = if candidate.is_dir() {
                        candidate.join("pom.xml")
                    } else {
                        candidate
                    };
                    let observation = ObservedFile::read(&candidate)
                        .map_err(|_| format!("{} 的本地父 POM 无法确认", candidate.display()))?;
                    if observation.text.is_some() {
                        let candidate = candidate
                            .canonicalize()
                            .map_err(|error| error.to_string())?;
                        let model = self.read(&candidate)?;
                        let mut declaration = model.properties.clone();
                        declaration.extend(raw.base.clone());
                        merge(&mut declaration, &raw.profiles);
                        aliases(&mut declaration, &raw);
                        let expected = format!(
                            "{}:{}",
                            single(group, &declaration)?,
                            single(artifact, &declaration)?
                        );
                        let expected_version = single(version, &declaration)?;
                        if model.ga.as_deref() == Some(&expected)
                            && model.version.as_deref() == Some(&expected_version)
                        {
                            matched = Some((candidate, model));
                        }
                    }
                    self.inputs.push(observation);
                }
            }
            let (parent_path, model) = match matched {
                Some(parent) => parent,
                None => {
                    let group = single(group, &local)?;
                    let artifact = single(artifact, &local)?;
                    let version = single(version, &local)?;
                    let expected = format!("{group}:{artifact}");
                    let parent_path = self
                        .repository
                        .join(group.replace('.', "/"))
                        .join(&artifact)
                        .join(&version)
                        .join(format!("{artifact}-{version}.pom"));
                    let model = self.read(&parent_path)?;
                    if model.ga.as_deref() != Some(&expected)
                        || model.version.as_deref() != Some(&version)
                    {
                        return Err(format!("{} 的父 POM 坐标与声明不一致", path.display()));
                    }
                    (parent_path, model)
                }
            };
            Some((parent_path, model))
        } else {
            None
        };
        let mut properties = parent
            .as_ref()
            .map(|(_, pom)| pom.properties.clone())
            .unwrap_or_default();
        // Child base values replace parent values; profile-only declarations also
        // retain the inherited base for the case where that profile is inactive.
        properties.extend(raw.base.clone());
        merge(&mut properties, &raw.profiles);
        aliases(&mut properties, &raw);
        let mut pom = Pom {
            properties,
            ..Pom::default()
        };
        if raw.project {
            pom.ga = Some(format!(
                "{}:{}",
                single(
                    raw.group.as_deref().ok_or("项目缺少 groupId")?,
                    &pom.properties
                )?,
                single(
                    raw.artifact.as_deref().ok_or("项目缺少 artifactId")?,
                    &pom.properties
                )?
            ));
            pom.version = raw
                .version
                .as_deref()
                .map(|value| single(value, &pom.properties))
                .transpose()?;
            pom.plugin = raw
                .packaging
                .as_deref()
                .map(|value| interpolate(value, &pom.properties))
                .transpose()?
                .is_some_and(|values| values.contains("maven-plugin"));
        }
        if let Some((parent_path, parent)) = parent {
            pom.parent_path = Some(parent_path);
            pom.raw_references.extend(parent.raw_references);
        }
        pom.raw_references.extend(raw.references);
        for (group, artifact) in &pom.raw_references {
            let groups = interpolate(group, &pom.properties)
                .map_err(|error| format!("{}：{error}", path.display()))?;
            let artifacts = interpolate(artifact, &pom.properties)
                .map_err(|error| format!("{}：{error}", path.display()))?;
            if groups.len().saturating_mul(artifacts.len()) > 64 {
                return Err("引用坐标组合超过 64 个上限".into());
            }
            for group in &groups {
                for artifact in &artifacts {
                    pom.references.insert(format!("{group}:{artifact}"));
                }
            }
        }
        if path.file_name().is_some_and(|name| name == "pom.xml") {
            for relative in raw.modules {
                if relative.is_empty() || relative.contains("${") {
                    return Err(format!("{} 的模块路径无法确认", path.display()));
                }
                let module = path.parent().unwrap().join(relative);
                check_model_path(&module)?;
                pom.modules.push(if module.is_dir() {
                    module.join("pom.xml")
                } else {
                    module
                });
            }
        }
        Ok(pom)
    }
}

fn parse(text: &str) -> Result<RawPom, String> {
    let normalized;
    let document = match roxmltree::Document::parse(text) {
        Ok(document) => document,
        Err(error) => {
            // Maven's default entity map includes HTML Latin-1 names used in
            // older POM metadata. Only our fixed, numeric declarations are
            // enabled; a document-supplied DTD remains rejected.
            if text.contains("<!DOCTYPE") {
                return Err(error.to_string());
            }
            normalized = with_latin1_entities(text);
            roxmltree::Document::parse_with_options(
                &normalized,
                roxmltree::ParsingOptions {
                    allow_dtd: true,
                    nodes_limit: 500_000,
                },
            )
            .map_err(|error| error.to_string())?
        }
    };
    let root = document.root_element();
    if !matches!(root.tag_name().name(), "project" | "extensions") {
        return Err("不是 Maven 项目或扩展定义".into());
    }
    let parent = root.children().find(|node| node.has_tag_name("parent"));
    let mut raw = RawPom {
        project: root.has_tag_name("project"),
        group: child_text(root, "groupId")
            .or_else(|| parent.and_then(|node| child_text(node, "groupId")))
            .map(str::to_string),
        version: child_text(root, "version")
            .or_else(|| parent.and_then(|node| child_text(node, "version")))
            .map(str::to_string),
        artifact: child_text(root, "artifactId").map(str::to_string),
        packaging: child_text(root, "packaging").map(str::to_string),
        ..RawPom::default()
    };
    if let Some(parent) = parent {
        raw.parent = Some((
            child_text(parent, "groupId")
                .ok_or("父 POM 缺少 groupId")?
                .into(),
            child_text(parent, "artifactId")
                .ok_or("父 POM 缺少 artifactId")?
                .into(),
            child_text(parent, "version")
                .ok_or("父 POM 缺少 version")?
                .into(),
        ));
        raw.relative = Some(
            parent
                .children()
                .find(|node| node.has_tag_name("relativePath"))
                .map(|node| node.text().unwrap_or("").trim())
                .unwrap_or("../pom.xml")
                .into(),
        );
    }
    for node in root.descendants().filter(|node| {
        node.is_element()
            && !node
                .ancestors()
                .any(|ancestor| ancestor.has_tag_name("configuration"))
    }) {
        let Some(container) = node.parent() else {
            continue;
        };
        if node.has_tag_name("properties")
            && (container == root || container.has_tag_name("profile"))
        {
            let target = if container == root {
                &mut raw.base
            } else {
                &mut raw.profiles
            };
            for property in node.children().filter(|node| node.is_element()) {
                target
                    .entry(property.tag_name().name().into())
                    .or_default()
                    .insert(property.text().unwrap_or("").trim().into());
            }
        }
        let reference = match node.tag_name().name() {
            "parent" => container == root,
            "dependency" => container.has_tag_name("dependencies"),
            "plugin" => container.has_tag_name("plugins"),
            "extension" => container.has_tag_name("extensions"),
            _ => false,
        };
        if reference {
            let group = child_text(node, "groupId")
                .or_else(|| {
                    node.has_tag_name("plugin")
                        .then_some("org.apache.maven.plugins")
                })
                .ok_or("引用缺少 groupId")?;
            let artifact = child_text(node, "artifactId").ok_or("引用缺少 artifactId")?;
            raw.references.push((group.into(), artifact.into()));
        }
        if node.has_tag_name("module") && container.has_tag_name("modules") {
            raw.modules.push(node.text().unwrap_or("").trim().into());
        }
    }
    Ok(raw)
}

fn with_latin1_entities(text: &str) -> String {
    // Standard ISO-8859-1 entity names, in U+00A0 through U+00FF order.
    // Maven reader reference: .scratch/maven-unused-dependencies/RESEARCH.md.
    const NAMES: &str = "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
    let bom = if text.starts_with('\u{feff}') {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    let offset = if text[bom..].starts_with("<?xml") {
        text.find("?>").map(|end| end + 2).unwrap_or(bom)
    } else {
        bom
    };
    let mut result = text[..offset].to_string();
    result.push_str("<!DOCTYPE project [");
    for (index, name) in NAMES.split_whitespace().enumerate() {
        if text.contains(&format!("&{name};")) {
            result.push_str(&format!("<!ENTITY {name} \"&#{};\">", 160 + index));
        }
    }
    result.push_str("]>");
    result.push_str(&text[offset..]);
    result
}

fn merge(target: &mut Properties, values: &Properties) {
    for (key, values) in values {
        target
            .entry(key.clone())
            .or_default()
            .extend(values.iter().cloned());
    }
}

fn aliases(properties: &mut Properties, raw: &RawPom) {
    // Replace aliases inherited from the parent with the current model's values.
    for (name, value) in [
        ("groupId", &raw.group),
        ("artifactId", &raw.artifact),
        ("version", &raw.version),
    ] {
        for prefix in ["project", "pom"] {
            properties.remove(&format!("{prefix}.{name}"));
            properties.remove(&format!("{prefix}.parent.{name}"));
            if let Some(value) = value {
                properties.insert(format!("{prefix}.{name}"), BTreeSet::from([value.clone()]));
            }
            if let Some((group, artifact, version)) = &raw.parent {
                let value = match name {
                    "groupId" => group,
                    "artifactId" => artifact,
                    _ => version,
                };
                properties.insert(
                    format!("{prefix}.parent.{name}"),
                    BTreeSet::from([value.clone()]),
                );
            }
        }
    }
}

fn single(value: &str, properties: &Properties) -> Result<String, String> {
    let values = interpolate(value, properties)?;
    if values.len() != 1 {
        return Err("项目或父 POM 坐标有多个可能值".into());
    }
    Ok(values.into_iter().next().unwrap())
}

fn check_model_path(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                current.pop();
            }
            Component::CurDir => continue,
            _ => current.push(component),
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "{} 是符号链接，无法确认模型来源",
                    current.display()
                ))
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("{} 无法读取", current.display()))
            }
            _ => {}
        }
    }
    Ok(())
}
