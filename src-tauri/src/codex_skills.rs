use crate::{
    codex_cli::{self, AppServer, RpcError, RpcErrorKind},
    codex_plugins::resolve_home,
    observed_file::ObservedFile,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use crate::skill_installation_copy as files;
use files::{CopyResult, CopySuccess, CopyWorkspace, PreparedCopyChange, Source, StagedView};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Skill {
    name: String,
    description: String,
    path: String,
    scope: String,
    enabled: bool,
    // A CLI that omits ownership cannot safely distinguish user-scope plugin skills.
    #[serde(deserialize_with = "Option::deserialize")]
    plugin_id: Option<String>,
}

struct Inventory {
    skills: Vec<Skill>,
    errors: Vec<String>,
}

trait Native {
    fn list(&self, home: &Path) -> Result<Inventory, RpcError>;
    fn enabled(&self, home: &Path, path: &str, enabled: bool) -> Result<(), String>;
}

struct Codex;
impl Native for Codex {
    fn list(&self, home: &Path) -> Result<Inventory, RpcError> {
        let params = json!({"cwds":["/"], "forceReload":true});
        let response = AppServer::start(home)?.request("skills/list", params)?;
        let data = response["data"]
            .as_array()
            .and_then(|v| v.iter().find(|v| v["cwd"] == "/"))
            .ok_or_else(RpcError::incompatible)?;
        let skills: Vec<Skill> =
            serde_json::from_value(data["skills"].clone()).map_err(|_| RpcError::incompatible())?;
        if skills.iter().any(|s| {
            !Path::new(&s.path).is_absolute()
                || Path::new(&s.path)
                    .file_name()
                    .is_none_or(|v| v != "SKILL.md")
        }) {
            return Err(RpcError::incompatible());
        }
        let errors = data["errors"]
            .as_array()
            .ok_or_else(RpcError::incompatible)?
            .iter()
            .map(|v| {
                v["message"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| v.to_string())
            })
            .collect();
        Ok(Inventory { skills, errors })
    }
    fn enabled(&self, home: &Path, path: &str, enabled: bool) -> Result<(), String> {
        let result = AppServer::start(home)
            .map_err(|e| e.message)?
            .request(
                "skills/config/write",
                json!({"path":path,"enabled":enabled}),
            )
            .map_err(|e| e.message)?;
        if result["effectiveEnabled"].as_bool() != Some(enabled) {
            return Err("Codex 未确认目标启用状态，请刷新核对配置。".into());
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    #[serde(flatten)]
    skill: Skill,
    managed: bool,
    source_label: Option<String>,
    revision: Option<String>,
    toggle_blocked: Option<String>,
    update_blocked: Option<String>,
    uninstall_blocked: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Scan {
    snapshot_id: Option<String>,
    directory: String,
    status: String,
    skills: Vec<Entry>,
    warnings: Vec<String>,
    message: Option<String>,
    install_blocked: Option<String>,
}

struct Snapshot {
    id: String,
    home: PathBuf,
    skills: BTreeMap<String, Skill>,
    config: ObservedFile,
    copies: CopyWorkspace,
    writable: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) enum Operation {
    Install,
    Enable,
    Disable,
    Update,
    Uninstall,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    snapshot_id: String,
    operation: Operation,
    path: Option<String>,
    source: Option<Source>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    plan_id: String,
    operation: Operation,
    name: String,
    path: String,
    source_label: Option<String>,
    revision: Option<String>,
    enabled: bool,
    message: String,
}

struct Plan {
    view: Preview,
    snapshot_id: String,
    skill: Option<Skill>,
    change: Option<PreparedCopyChange>,
}

#[derive(Serialize)]
pub(crate) struct Outcome {
    status: &'static str,
    message: String,
}
impl Outcome {
    fn new(status: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

#[derive(Default)]
struct State {
    sequence: u64,
    snapshot: Option<Snapshot>,
    plan: Option<Plan>,
}
#[derive(Clone, Default)]
pub(crate) struct SkillsState(Arc<Mutex<State>>);

fn independent(skill: &Skill) -> bool {
    skill.scope == "user" && skill.plugin_id.is_none()
}
fn conflict() -> String {
    "技能、安装记录或配置已变化，请刷新并重新确认。".into()
}
impl SkillsState {
    pub fn scan(&self) -> Result<Scan, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.scan_with(resolve_home()?, &Codex)
    }

    fn scan_with(&self, home: PathBuf, native: &impl Native) -> Result<Scan, String> {
        let mut state = self.0.lock().map_err(|_| "技能状态不可用")?;
        state.plan = None;
        state.snapshot = None;
        state.sequence += 1;
        let mut scan = Scan {
            snapshot_id: None,
            directory: home.display().to_string(),
            status: "Failed".into(),
            skills: vec![],
            warnings: vec![],
            message: None,
            install_blocked: None,
        };
        let inventory = match native.list(&home) {
            Ok(value) => value,
            Err(error) => {
                scan.status = match error.kind {
                    RpcErrorKind::MissingCli => "MissingCli",
                    RpcErrorKind::Incompatible => "Incompatible",
                    _ => "Failed",
                }
                .into();
                scan.message = Some(error.message);
                return Ok(scan);
            }
        };
        scan.status = "Ready".into();
        scan.warnings = inventory.errors.clone();
        let config = ObservedFile::read(&home.join("config.toml"));
        let copies = CopyWorkspace::observe(&home, &home.join(".package-manager-skills.json"));
        let global = if !inventory.errors.is_empty() {
            Some("原生清单不完整，请先处理读取错误。".to_string())
        } else {
            config
                .as_ref()
                .err()
                .map(|e| format!("用户配置无法核实：{e:?}"))
        };
        let file_blocked = global
            .clone()
            .or_else(|| copies.ledger_error().map(str::to_string))
            .or_else(|| copies.root_error().map(str::to_string));
        scan.install_blocked = file_blocked.clone();
        if let Some(reason) = &file_blocked {
            scan.warnings.push(reason.clone());
        }
        let mut skills = BTreeMap::new();
        for skill in inventory.skills {
            if skill.scope == "repo" {
                continue;
            }
            // Distinct names never confer identity; the native path is the operation key.
            if skills.contains_key(&skill.path) {
                continue;
            }
            let observation = copies.inspect(&skill.path);
            let record = observation.installation.as_ref();
            let toggle_blocked = global
                .clone()
                .or_else(|| (!independent(&skill)).then(|| "插件、内置及非用户来源只读。".into()));
            let managed = record.is_some();
            let own_reason = file_blocked
                .clone()
                .or_else(|| toggle_blocked.clone())
                .or_else(|| observation.uninstall_blocked.clone())
                .or_else(|| {
                    (!observation.installation.is_some())
                        .then(|| "非本应用安装，仅可查看和启停；文件维护请回原来源。".into())
                });
            let update_blocked = own_reason.clone().or(observation.update_blocked);
            scan.skills.push(Entry {
                skill: skill.clone(),
                managed,
                source_label: record.map(|r| r.source.label()),
                revision: record.map(|r| r.revision.clone()),
                toggle_blocked,
                update_blocked,
                uninstall_blocked: own_reason,
            });
            skills.insert(skill.path.clone(), skill);
        }
        for path in copies.recorded_paths().filter(|p| !skills.contains_key(*p)) {
            scan.warnings.push(format!(
                "本应用记录的副本未被 Codex 识别，未作为原生技能列出：{path}。请核对该目录后刷新。"
            ));
        }
        if let Ok(config) = config {
            let id = format!("skills-{}", state.sequence);
            scan.snapshot_id = Some(id.clone());
            state.snapshot = Some(Snapshot {
                id,
                home,
                skills,
                config,
                copies,
                writable: global.is_none(),
            });
        }
        Ok(scan)
    }

    pub fn prepare(&self, request: Request) -> Result<Preview, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.prepare_with(request, &resolve_home()?, &Codex)
    }

    fn prepare_with(
        &self,
        request: Request,
        home: &Path,
        native: &impl Native,
    ) -> Result<Preview, String> {
        let mut state = self.0.lock().map_err(|_| "技能状态不可用")?;
        state.plan = None;
        state.sequence += 1;
        let plan_id = format!("skill-plan-{}", state.sequence);
        let snapshot = state
            .snapshot
            .as_ref()
            .filter(|s| s.id == request.snapshot_id && s.home == home && s.writable)
            .ok_or_else(conflict)?;
        if !snapshot.config.unchanged() {
            return Err(conflict());
        }
        let inventory = native.list(home).map_err(|e| e.message)?;
        if !inventory.errors.is_empty() {
            return Err("原生技能清单不完整，暂时不能维护。".into());
        }
        let mut skill = None;
        let mut change = None;
        let (name, path, enabled, message) = if request.operation == Operation::Install {
            Self::check_files(snapshot)?;
            let source = request.source.as_ref().ok_or("请选择安装来源。")?;
            let candidate = snapshot.copies.prepare_install(source)?;
            let target = candidate.target_path().unwrap();
            if fs::symlink_metadata(target.parent().unwrap()).is_ok() {
                return Err("目标目录已存在，不会覆盖。请选择其他技能或维护已有副本。".into());
            }
            let next = validate_stage(candidate.staged().unwrap(), native)?;
            let name = next.name;
            let path = target.display().to_string();
            change = Some(candidate);
            (
                name,
                path,
                true,
                "安装独立副本并启用，保留原始来源；不会运行技能脚本。".into(),
            )
        } else {
            let path = request.path.as_ref().ok_or("未选择技能。")?;
            let previous = snapshot.skills.get(path).ok_or_else(conflict)?;
            let current = inventory
                .skills
                .iter()
                .find(|s| s.path == *path)
                .ok_or_else(conflict)?;
            if previous != current || !independent(current) {
                return Err(conflict());
            }
            skill = Some(current.clone());
            if matches!(request.operation, Operation::Update | Operation::Uninstall) {
                Self::check_files(snapshot)?;
                let candidate = if request.operation == Operation::Update {
                    snapshot.copies.prepare_update(path)?
                } else {
                    snapshot.copies.prepare_uninstall(path)?
                };
                if request.operation == Operation::Update {
                    validate_stage(candidate.staged().unwrap(), native)?;
                }
                change = Some(candidate);
            }
            let enabled = match request.operation {
                Operation::Enable => true,
                Operation::Disable => false,
                _ => current.enabled,
            };
            let message = match request.operation {
                Operation::Enable | Operation::Disable => {
                    "只修改 Codex 的技能启用设置，保留技能文件；请在新会话中验证。"
                }
                Operation::Update => "按已记录来源更新副本，保留当前启停选择；本地修改会阻止更新。",
                _ => "整份安装副本（包括本地修改）移入废纸篓，保留原始来源。清空废纸篓前可找回。",
            };
            (current.name.clone(), path.clone(), enabled, message.into())
        };
        let source_label = change.as_ref().and_then(PreparedCopyChange::source_label);
        let revision = change
            .as_ref()
            .and_then(PreparedCopyChange::revision)
            .map(str::to_string);
        let view = Preview {
            plan_id,
            operation: request.operation,
            name,
            path,
            source_label,
            revision,
            enabled,
            message,
        };
        let plan = Plan {
            view: view.clone(),
            snapshot_id: snapshot.id.clone(),
            skill,
            change,
        };
        state.plan = Some(plan);
        Ok(view)
    }

    fn check_files(snapshot: &Snapshot) -> Result<(), String> {
        snapshot.copies.check_current().map_err(|_| conflict())
    }

    pub fn cancel(&self, plan_id: &str) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "技能状态不可用")?;
        if state
            .plan
            .as_ref()
            .is_some_and(|p| p.view.plan_id == plan_id)
        {
            state.plan = None;
        }
        Ok(())
    }

    pub fn details(&self, snapshot_id: &str, path: &str) -> Result<String, String> {
        let state = self.0.lock().map_err(|_| "技能状态不可用")?;
        let snapshot = state
            .snapshot
            .as_ref()
            .filter(|s| s.id == snapshot_id && s.home == resolve_home().unwrap_or_default())
            .ok_or_else(conflict)?;
        if !snapshot.skills.contains_key(path) {
            return Err(conflict());
        }
        files::read_markdown(Path::new(path))
    }

    pub fn commit(&self, plan_id: &str) -> Result<Outcome, String> {
        let _operation = codex_cli::OPERATIONS
            .lock()
            .map_err(|_| "Codex 操作状态不可用")?;
        self.commit_with(
            plan_id,
            &resolve_home()?,
            &Codex,
            &crate::session_records::move_path_to_trash,
        )
    }

    fn commit_with(
        &self,
        plan_id: &str,
        home: &Path,
        native: &impl Native,
        trash: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<Outcome, String> {
        let mut state = self.0.lock().map_err(|_| "技能状态不可用")?;
        if state
            .plan
            .as_ref()
            .is_none_or(|p| p.view.plan_id != plan_id)
        {
            return Ok(Outcome::new("Conflict", "确认已过期，请重新检查。"));
        }
        let mut plan = state.plan.take().unwrap();
        let Some(snapshot) = state
            .snapshot
            .take()
            .filter(|s| s.id == plan.snapshot_id && s.home == home)
        else {
            return Ok(Outcome::new("Conflict", conflict()));
        };
        let checked = (|| -> Result<(), String> {
            if !snapshot.config.unchanged() {
                return Err(conflict());
            }
            let current = native.list(home).map_err(|e| e.message)?;
            if !current.errors.is_empty() {
                return Err("原生清单不完整，请核对后重试。".into());
            }
            if let Some(skill) = &plan.skill {
                if !current.skills.iter().any(|s| s == skill) {
                    return Err(conflict());
                }
            }
            if matches!(
                plan.view.operation,
                Operation::Install | Operation::Update | Operation::Uninstall
            ) {
                plan.change
                    .as_ref()
                    .ok_or("文件维护计划未准备。")?
                    .check_before_commit()?;
            }
            if !snapshot.config.unchanged() {
                return Err(conflict());
            }
            Ok(())
        })();
        if let Err(error) = checked {
            return Ok(Outcome::new("Conflict", error));
        }
        if matches!(plan.view.operation, Operation::Enable | Operation::Disable) {
            return Ok(
                match native.enabled(home, &plan.view.path, plan.view.enabled) {
                    Ok(()) => Outcome::new("Saved", "启用设置已保存，请在新会话中验证。"),
                    Err(e) => Outcome::new(
                        "Partial",
                        format!("未能完整确认设置结果：{e}。请刷新后核对，勿直接重复操作。"),
                    ),
                },
            );
        }
        let result = plan
            .change
            .take()
            .ok_or("文件维护计划未准备。")?
            .commit(&snapshot.config, trash);
        Ok(match result {
            CopyResult::Conflict(error) => Outcome::new("Conflict", error),
            CopyResult::Failed(error) => Outcome::new("Failed", error),
            CopyResult::Partial(error) => Outcome::new("Partial", error),
            CopyResult::Succeeded(CopySuccess::Unchanged) => Outcome::new(
                "Unchanged",
                "已记录来源没有新内容，副本和启停设置保持不变。",
            ),
            CopyResult::Succeeded(CopySuccess::Uninstalled) => Outcome::new(
                "Succeeded",
                "安装副本已移入废纸篓，原始来源保持不变；Codex 路径启停配置保留，再安装时会启用。",
            ),
            CopyResult::Succeeded(CopySuccess::Installed) => {
                if let Err(error) = native.enabled(home, &plan.view.path, true) {
                    Outcome::new(
                        "Partial",
                        format!("副本和来源记录已安装，但启用未完整确认：{error}。请刷新后核对。"),
                    )
                } else {
                    Outcome::new(
                        "Succeeded",
                        "技能已安装并启用，原始来源保持不变。请在新会话中验证。",
                    )
                }
            }
            CopyResult::Succeeded(CopySuccess::Updated) => Outcome::new(
                "Succeeded",
                "安装副本已更新，原启停选择保持不变。请在新会话中验证。",
            ),
        })
    }
}

fn validate_stage(staged: StagedView<'_>, native: &impl Native) -> Result<Skill, String> {
    let expected = staged
        .directory
        .join("SKILL.md")
        .canonicalize()
        .map_err(|_| "所选目录没有可读的 SKILL.md。")?;
    let inventory = native.list(staged.temp_home).map_err(|e| e.message)?;
    inventory
        .skills
        .into_iter()
        .find(|s| Path::new(&s.path) == expected && independent(s))
        .ok_or_else(|| {
            format!(
                "Codex 未识别此技能，请检查 SKILL.md 的名称、说明和格式。{}",
                inventory.errors.join("；")
            )
        })
}

#[cfg(test)]
#[path = "codex_skill_tests.rs"]
mod tests;
