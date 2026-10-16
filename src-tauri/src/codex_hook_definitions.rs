use super::*;
use std::{collections::BTreeMap, time::Duration};

#[path = "codex_hook_documents.rs"]
mod documents;
pub(crate) use documents::Fields;
use documents::{Definition, Format, Source};

const VERIFIED_CLI: &str = "codex-cli 0.162.1";

#[derive(Default)]
pub(super) struct DefinitionStore {
    observation: Option<DefinitionObservation>,
    plan: Option<Plan>,
}

#[derive(Clone)]
pub(super) struct DefinitionObservation {
    id: String,
    home: PathBuf,
    sources: Vec<Source>,
    native: Vec<HookMetadata>,
    config: ConfigView,
    feature_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionEntry {
    id: String,
    source: Format,
    source_path: String,
    event: String,
    matcher: Option<String>,
    handler: Value,
    native_key: Option<String>,
    enabled: Option<bool>,
    trust_status: String,
    read_only_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionSource {
    format: Format,
    path: String,
    has_definitions: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionScan {
    snapshot_id: Option<String>,
    entries: Vec<DefinitionEntry>,
    sources: Vec<DefinitionSource>,
    default_source: Option<Format>,
    read_only_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DefinitionAction {
    Create,
    Update,
    Delete,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DefinitionRequest {
    snapshot_id: String,
    action: DefinitionAction,
    source: Format,
    id: Option<String>,
    event: Option<String>,
    matcher: Option<String>,
    fields: Option<Fields>,
    enabled: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionImpact {
    event: String,
    operation: String,
    enabled: bool,
    target: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionPreview {
    plan_id: String,
    action: DefinitionAction,
    source_path: String,
    before: Option<Value>,
    after: Option<Value>,
    enabled: Option<bool>,
    impacts: Vec<DefinitionImpact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DefinitionCommitRequest {
    plan_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefinitionResult {
    status: String,
    message: String,
}

impl DefinitionResult {
    fn new(status: &str, message: impl Into<String>) -> Self {
        Self {
            status: status.into(),
            message: message.into(),
        }
    }
}

struct Plan {
    observation: DefinitionObservation,
    preview: DefinitionPreview,
    source: Format,
    definition: Source,
    config: Source,
    affected: HashSet<String>,
    expected: Vec<(String, bool, Option<(String, String)>)>,
}

impl DefinitionStore {
    pub fn register(
        &mut self,
        id: String,
        mut view: DefinitionScan,
        observation: Option<DefinitionObservation>,
    ) -> DefinitionScan {
        self.plan = None;
        self.observation = observation.map(|mut observation| {
            observation.id = id.clone();
            view.snapshot_id = Some(id);
            observation
        });
        view
    }
}

fn native(home: &Path) -> Result<(Vec<HookMetadata>, ConfigView, bool), String> {
    let inventory = load(home).map_err(|e| e.message)?;
    let config = inventory.config?;
    let enabled = inventory
        .feature_enabled
        .ok_or("无法确认 Hooks 总开关，定义当前只读。")?;
    if !inventory.errors.is_empty() {
        return Err(inventory.errors.join("\n"));
    }
    let hooks = if enabled {
        inventory.hooks
    } else {
        let mut server = AppServer::inspect_hooks(home).map_err(|e| e.message)?;
        let (hooks, _, errors) = parse_inventory(
            server
                .request("hooks/list", json!({"cwds":["/"]}))
                .map_err(|e| e.message)?,
        )
        .map_err(|e| e.message)?;
        if !errors.is_empty() {
            return Err(errors.join("\n"));
        }
        hooks
    };
    Ok((hooks, config, enabled))
}

fn verified_version(home: &Path) -> Result<(), String> {
    let version = codex_cli::run(home, &["--version"], Duration::from_secs(5))?;
    if !version.success || version.stdout.trim() != VERIFIED_CLI {
        return Err("当前 CLI 的定义编辑能力尚未验证，暂时只读。已验证版本为 Codex CLI 0.162.1；已有启停能力独立判断。".into());
    }
    Ok(())
}

fn matches_native(definition: &Definition, hook: &HookMetadata) -> bool {
    let event = &definition.location.event;
    let event = event[..1].to_lowercase() + &event[1..];
    let handler_type = match definition.handler["type"].as_str() {
        Some("command") => "command",
        Some("mcp_tool") => "mcpTool",
        _ => return false,
    };
    !hook.is_managed
        && matches!(
            hook.trust_status.as_str(),
            "trusted" | "modified" | "untrusted"
        )
        && hook.event_name == event
        && hook.handler_type == handler_type
        && (matches!(
            definition.location.event.as_str(),
            "Stop" | "Interrupt" | "UserPromptSubmit"
        ) || hook.matcher == definition.matcher)
        && if handler_type == "command" {
            hook.command.as_deref() == definition.handler["command"].as_str()
        } else {
            hook.server.as_deref() == definition.handler["server"].as_str()
                && hook.tool.as_deref() == definition.handler["tool"].as_str()
        }
}

fn bind(sources: &[Source], hooks: &[HookMetadata]) -> Result<(), String> {
    let mut keys = HashSet::new();
    for source in sources {
        for definition in source.definitions()? {
            let key = definition.location.key(&source.file.path)?;
            let hook = hooks
                .iter()
                .find(|h| {
                    h.key == key
                        && h.source == "user"
                        && same_path(&h.source_path, &source.file.path)
                })
                .ok_or("无法将用户定义与 Codex 身份可靠关联，定义当前只读。")?;
            if !matches_native(&definition, hook) {
                return Err("原生定义与文件内容不一致，定义当前只读。".into());
            }
            keys.insert(key);
        }
    }
    if hooks
        .iter()
        .any(|h| h.source == "user" && !keys.contains(&h.key))
    {
        return Err("原生清单包含未识别的用户来源，无法确认变更范围。".into());
    }
    Ok(())
}

pub(super) fn observe(home: &Path) -> (DefinitionScan, Option<DefinitionObservation>) {
    let mut sources = vec![];
    let mut choices = vec![];
    let mut reason = None;
    for format in [Format::Json, Format::Toml] {
        let source = Source::read(home, format).and_then(|source| {
            source.definitions()?;
            Ok(source)
        });
        let error = source.as_ref().err().cloned();
        if reason.is_none() {
            reason = error.clone();
        }
        choices.push(DefinitionSource {
            format,
            path: home.join(format.filename()).display().to_string(),
            has_definitions: source
                .as_ref()
                .is_ok_and(|s| s.definitions().is_ok_and(|d| !d.is_empty())),
            error,
        });
        if let Ok(source) = source {
            sources.push(source);
        }
    }
    let native = native(home);
    if reason.is_none() {
        reason = native.as_ref().err().cloned();
    }
    if reason.is_none() {
        reason = verified_version(home).err();
    }
    if let Ok((hooks, _, _)) = &native {
        if reason.is_none() {
            reason = bind(&sources, hooks).err();
        }
    }
    let mut entries = vec![];
    for source in &sources {
        for definition in source.definitions().unwrap_or_default() {
            let key = definition.location.key(&source.file.path).ok();
            let hook = native.as_ref().ok().and_then(|(hooks, _, _)| {
                hooks
                    .iter()
                    .find(|h| Some(&h.key) == key.as_ref() && h.source == "user")
            });
            entries.push(DefinitionEntry {
                id: definition.location.id(source.format),
                source: source.format,
                source_path: source.file.path.display().to_string(),
                event: definition.location.event,
                matcher: definition.matcher,
                handler: definition.handler,
                native_key: hook.map(|h| h.key.clone()),
                enabled: hook.map(|h| h.enabled),
                trust_status: hook.map_or("unknown".into(), |h| h.trust_status.clone()),
                read_only_reason: reason.clone(),
            });
        }
    }
    let configured: Vec<_> = choices
        .iter()
        .filter(|s| s.has_definitions)
        .map(|s| s.format)
        .collect();
    let default_source = match configured.as_slice() {
        [] => Some(Format::Json),
        [one] => Some(*one),
        _ => None,
    };
    let observation = if reason.is_none() {
        native
            .ok()
            .map(|(native, config, feature_enabled)| DefinitionObservation {
                id: String::new(),
                home: home.into(),
                sources,
                native,
                config,
                feature_enabled,
            })
    } else {
        None
    };
    (
        DefinitionScan {
            snapshot_id: None,
            entries,
            sources: choices,
            default_source,
            read_only_reason: reason,
        },
        observation,
    )
}

impl DefinitionObservation {
    fn fresh(&self) -> Result<(), String> {
        if !self.sources.iter().all(|s| s.file.unchanged()) {
            return Err("定义文件或用户配置已变化，请刷新并重新确认。".into());
        }
        verified_version(&self.home)?;
        let (hooks, config, enabled) = native(&self.home)?;
        if hooks != self.native
            || config.version != self.config.version
            || config.target != self.config.target
            || config.origins != self.config.origins
            || enabled != self.feature_enabled
        {
            return Err("Codex 定义、信任或配置状态已变化，请刷新并重新确认。".into());
        }
        Ok(())
    }
}

fn state_owned(config: &ConfigView, key: &str) -> Result<(), String> {
    for field in ["enabled", "trusted_hash"] {
        if config.states[key][field].is_null() {
            continue;
        }
        let origin = &config.origins[format!("hooks.state.{key}.{field}")];
        if origin["name"]["type"] != "user"
            || !origin["name"]["profile"].is_null()
            || !origin["name"]["file"]
                .as_str()
                .is_some_and(|p| same_path(p, &config.target))
        {
            return Err("受影响状态不完全属于当前用户配置，不能维护此定义。".into());
        }
    }
    Ok(())
}

fn describe(definition: &Definition) -> String {
    definition.handler["command"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| {
            format!(
                "{} / {}",
                definition.handler["server"].as_str().unwrap_or("MCP"),
                definition.handler["tool"].as_str().unwrap_or("")
            )
        })
}

fn raw(definition: &Definition) -> Value {
    json!({"event":definition.location.event, "matcher":definition.matcher, "handler":definition.handler})
}

fn prepare(
    observation: DefinitionObservation,
    request: DefinitionRequest,
    plan_id: String,
) -> Result<Plan, String> {
    let mut source = observation
        .sources
        .iter()
        .find(|s| s.format == request.source)
        .cloned()
        .ok_or("该来源不可维护。")?;
    let mut config = observation
        .sources
        .iter()
        .find(|s| s.format == Format::Toml)
        .cloned()
        .ok_or("用户配置不可维护。")?;
    let old = source.definitions()?;
    let target = if request.action == DefinitionAction::Create {
        if request.id.is_some() {
            return Err("新建请求不能指定现有定义。".into());
        }
        None
    } else {
        Some(
            old.iter()
                .find(|d| Some(d.location.id(source.format)) == request.id)
                .ok_or("所选定义已不存在，请刷新。")?,
        )
    };
    let mut next_location = None;
    let mut removed = false;
    if request.action == DefinitionAction::Delete {
        let target = target.ok_or("未选择定义。")?;
        source.replace_handler(&target.location, None)?;
        removed = true;
    } else {
        let event = request.event.as_deref().ok_or("请选择事件。")?;
        let fields = request.fields.as_ref().ok_or("缺少处理程序字段。")?;
        fields.validate(event, request.matcher.as_deref())?;
        if let Some(target) = target {
            let next = fields.apply(&target.handler);
            if target.location.event == event && target.matcher == request.matcher {
                if target.handler == next {
                    return Err("没有需要保存的定义变更。".into());
                }
                source.replace_handler(&target.location, Some(&next))?;
                next_location = Some(target.location.clone());
            } else {
                if target
                    .group
                    .as_object()
                    .is_some_and(|g| g.keys().any(|key| key != "hooks" && key != "matcher"))
                {
                    return Err(
                        "此匹配组包含未知字段，无法安全拆组；可保留事件和匹配条件后编辑。".into(),
                    );
                }
                source.replace_handler(&target.location, None)?;
                next_location =
                    Some(source.append_group(event, request.matcher.as_deref(), &next)?);
                removed = true;
            }
        } else {
            if request.enabled.is_none() {
                return Err("请选择新 Hook 的启用状态。".into());
            }
            next_location = Some(source.append_group(
                event,
                request.matcher.as_deref(),
                &fields.apply(&json!({})),
            )?);
        }
    }
    let mut affected = HashSet::new();
    let mut desired = BTreeMap::new();
    let mut expected = vec![];
    let mut impacts = vec![];
    for definition in &old {
        let is_target = target.is_some_and(|d| d.location == definition.location);
        let old_key = definition.location.key(&source.file.path)?;
        let hook = observation
            .native
            .iter()
            .find(|h| h.key == old_key)
            .ok_or("原生身份已变化。")?;
        let mut next = Some(definition.location.clone());
        if is_target {
            next = next_location.clone();
        } else if removed
            && target.is_some_and(|t| {
                t.location.event == definition.location.event
                    && t.location.group == definition.location.group
                    && t.location.handler < definition.location.handler
            })
        {
            next.as_mut().unwrap().handler -= 1;
        }
        let new_key = next.map(|l| l.key(&source.file.path)).transpose()?;
        let changed = is_target || new_key.as_ref() != Some(&old_key);
        if changed {
            affected.insert(old_key);
            impacts.push(DefinitionImpact {
                event: definition.location.event.clone(),
                operation: describe(definition),
                enabled: hook.enabled,
                target: is_target,
            });
            if let Some(key) = &new_key {
                affected.insert(key.clone());
                desired.insert(key.clone(), hook.enabled);
            }
        }
        if let Some(key) = new_key {
            expected.push((
                key,
                hook.enabled,
                (!changed).then(|| (hook.current_hash.clone(), hook.trust_status.clone())),
            ));
        }
    }
    if request.action == DefinitionAction::Create {
        let key = next_location.as_ref().unwrap().key(&source.file.path)?;
        affected.insert(key.clone());
        desired.insert(key.clone(), request.enabled.unwrap());
        expected.push((key, request.enabled.unwrap(), None));
    }
    let original_state = config.state()?;
    for key in &affected {
        state_owned(&observation.config, key)?;
        if let Some(state) = original_state.get(key) {
            if !state.is_object()
                || state
                    .as_object()
                    .unwrap()
                    .keys()
                    .any(|key| key != "enabled" && key != "trusted_hash")
            {
                return Err("受影响状态包含未知字段，无法安全维护。".into());
            }
        }
    }
    if source.format == Format::Toml {
        config = source.clone();
    }
    for key in &affected {
        config.set_state(key, None)?;
    }
    for (key, enabled) in &desired {
        config.set_state(key, Some(&json!({"enabled":enabled})))?;
    }
    if source.format == Format::Toml {
        source = config.clone();
    }
    let after = source
        .definitions()?
        .into_iter()
        .find(|d| Some(&d.location) == next_location.as_ref())
        .map(|d| raw(&d));
    Ok(Plan {
        preview: DefinitionPreview {
            plan_id,
            action: request.action,
            source_path: source.file.path.display().to_string(),
            before: target.map(raw),
            after,
            enabled: next_location
                .as_ref()
                .and_then(|l| l.key(&source.file.path).ok())
                .and_then(|k| desired.get(&k).copied()),
            impacts,
        },
        observation,
        source: request.source,
        definition: source,
        config,
        affected,
        expected,
    })
}

#[cfg(test)]
#[path = "codex_hook_definition_tests.rs"]
mod tests;

impl Plan {
    fn validate_candidate(&self) -> Result<(), String> {
        let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
        let candidate = if let Some(source) = &self.definition.toml {
            // Preserve TOML aliases and syntax without copying unrelated user settings.
            let mut candidate = toml_edit::DocumentMut::new();
            if let Some(hooks) = source.get("hooks") {
                candidate.insert("hooks", hooks.clone());
            }
            candidate.to_string()
        } else {
            self.definition.text()?
        };
        std::fs::write(temp.path().join(self.source.filename()), candidate)
            .map_err(|e| e.to_string())?;
        let mut server = AppServer::inspect_hooks(temp.path()).map_err(|e| e.message)?;
        let (hooks, warnings, errors) = parse_inventory(
            server
                .request("hooks/list", json!({"cwds":["/"]}))
                .map_err(|e| e.message)?,
        )
        .map_err(|e| e.message)?;
        let definitions = self.definition.definitions()?;
        if !errors.is_empty() || !warnings.is_empty() || hooks.len() != definitions.len() {
            return Err("Codex 未完整接受待保存定义，请检查事件、处理程序与高级字段。".into());
        }
        let path = std::fs::canonicalize(temp.path())
            .map_err(|e| e.to_string())?
            .join(self.source.filename());
        for definition in definitions {
            let key = definition.location.key(&path)?;
            if !hooks
                .iter()
                .any(|h| h.key == key && matches_native(&definition, h))
            {
                return Err("待保存定义的原生身份无法验证，未写入配置。".into());
            }
        }
        Ok(())
    }

    fn save(&self) -> DefinitionResult {
        self.save_with(&|source, text| source.write(text))
    }

    fn partial(&self, message: String) -> DefinitionResult {
        let mut recovery = format!(" 来源：{}。", self.preview.source_path);
        for impact in &self.preview.impacts {
            recovery.push_str(&format!(
                " {} · {}（操作前{}{}）。",
                impact.event,
                impact.operation,
                if impact.enabled { "启用" } else { "禁用" },
                if impact.target {
                    "，本次操作对象"
                } else {
                    ""
                },
            ));
        }
        if self.preview.action == DefinitionAction::Create {
            recovery.push_str(if self.preview.enabled == Some(true) {
                " 新建条目的确认选择：启用。"
            } else {
                " 新建条目的确认选择：禁用。"
            });
        }
        DefinitionResult::new("Partial", message + &recovery)
    }

    fn save_with(
        &self,
        write: &impl Fn(&Source, &str) -> Result<documents::FileSnapshot, String>,
    ) -> DefinitionResult {
        let failure = |message: String| DefinitionResult::new("Failed", message);
        let partial = |message: String| self.partial(message);
        let definition_text = match self.definition.text() {
            Ok(text) => text,
            Err(e) => return failure(e),
        };
        let config_text = match self.config.text() {
            Ok(text) => text,
            Err(e) => return failure(e),
        };
        if !self.observation.sources.iter().all(|s| s.file.unchanged()) {
            return DefinitionResult::new(
                "Conflict",
                "定义文件或用户配置已变化，请刷新并重新确认。",
            );
        }
        if self.source == Format::Toml {
            if let Err(e) = write(&self.config, &config_text) {
                return failure(e);
            }
        } else {
            let mut paused = self
                .observation
                .sources
                .iter()
                .find(|s| s.format == Format::Toml)
                .unwrap()
                .clone();
            for key in &self.affected {
                if let Err(e) = paused.set_state(key, Some(&json!({"enabled":false}))) {
                    return failure(e);
                }
            }
            let paused_text = match paused.text() {
                Ok(text) => text,
                Err(e) => return failure(e),
            };
            let saved = match write(&paused, &paused_text) {
                Ok(saved) => saved,
                Err(e) => return failure(e),
            };
            if !saved.unchanged() {
                return partial("已准备暂停与重新审查状态，但用户配置随后变化；尚未保存定义。请刷新核对受影响条目。".into());
            }
            if let Err(e) = write(&self.definition, &definition_text) {
                return partial(format!("已暂停受影响身份并撤销旧信任，但定义未保存：{e} 请刷新核对；原有条目需在 Codex 重新审查后恢复启用选择。"));
            }
            let mut final_config = self.config.clone();
            final_config.file = saved;
            if let Err(e) = write(&final_config, &config_text) {
                return partial(format!("定义已保存，但启用选择未能完整恢复：{e} 受影响条目在准备阶段被禁用；请刷新核对，并在 Codex 审查后恢复所需启用选择。"));
            }
        }
        DefinitionResult::new(
            "Saved",
            "定义已保存。新增、修改或身份变化的 Hook 需在 Codex 中审查；请在新会话中验证。",
        )
    }

    fn verify_saved(&self) -> Result<(), String> {
        let (hooks, _, feature) = native(&self.observation.home)?;
        if feature != self.observation.feature_enabled {
            return Err("总开关在保存期间发生变化。".into());
        }
        for (key, enabled, unchanged) in &self.expected {
            let hook = hooks
                .iter()
                .find(|h| &h.key == key)
                .ok_or("保存后未找到预期定义。")?;
            if &hook.enabled != enabled {
                return Err("保存后的启用选择与确认内容不一致。".into());
            }
            if let Some((hash, trust)) = unchanged {
                if &hook.current_hash != hash || &hook.trust_status != trust {
                    return Err("未编辑条目的定义或信任发生变化。".into());
                }
            } else if hook.trust_status != "untrusted" {
                return Err("受影响条目的信任状态未按预期重置。".into());
            }
        }
        let path = self.definition.file.path.display().to_string();
        if hooks
            .iter()
            .filter(|h| h.source == "user" && h.source_path == path)
            .count()
            != self.expected.len()
        {
            return Err("保存后的定义数量与确认内容不一致。".into());
        }
        for old in self
            .observation
            .native
            .iter()
            .filter(|h| h.source_path != path)
        {
            let mut old = old.clone();
            old.display_order = 0;
            if !hooks.iter().any(|h| {
                let mut next = h.clone();
                next.display_order = 0;
                next == old
            }) {
                return Err("其他来源的状态在保存期间发生变化。".into());
            }
        }
        Ok(())
    }
}

impl HooksState {
    pub(crate) fn prepare_definition(
        &self,
        request: DefinitionRequest,
    ) -> Result<DefinitionPreview, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        let mut state = self.0.lock().map_err(|_| "Hooks 状态不可用")?;
        state.definitions.plan = None;
        let observation = state
            .definitions
            .observation
            .as_ref()
            .filter(|o| o.id == request.snapshot_id)
            .cloned()
            .ok_or("清单已过期，请刷新后重试；表单内容已保留。")?;
        if resolve_home()? != observation.home {
            return Err("Codex 目录已变化，请刷新。".into());
        }
        observation.fresh()?;
        state.sequence += 1;
        let plan = prepare(
            observation,
            request,
            format!("hook-definition-plan-{}", state.sequence),
        )?;
        plan.validate_candidate()?;
        let preview = plan.preview.clone();
        state.definitions.plan = Some(plan);
        Ok(preview)
    }

    pub(crate) fn commit_definition(
        &self,
        request: DefinitionCommitRequest,
    ) -> Result<DefinitionResult, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        let mut state = self.0.lock().map_err(|_| "Hooks 状态不可用")?;
        state.observation = None;
        state.definitions.observation = None;
        let Some(plan) = state
            .definitions
            .plan
            .take()
            .filter(|p| p.preview.plan_id == request.plan_id)
        else {
            return Ok(DefinitionResult::new(
                "Conflict",
                "确认已失效，请刷新并重新检查变更。",
            ));
        };
        if resolve_home()? != plan.observation.home {
            return Ok(DefinitionResult::new(
                "Conflict",
                "Codex 目录已变化，请刷新。",
            ));
        }
        if let Err(e) = plan.observation.fresh() {
            return Ok(DefinitionResult::new("Conflict", e));
        }
        let result = plan.save();
        if result.status == "Saved" {
            if let Err(e) = plan.verify_saved() {
                return Ok(plan.partial(format!(
                    "文件已保存，但后续核实未完成：{e} 请刷新核对，避免重复提交。"
                )));
            }
        }
        Ok(result)
    }
}
