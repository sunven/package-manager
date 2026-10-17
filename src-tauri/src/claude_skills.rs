use crate::{
    claude_cli::{self, Runner},
    claude_documents::Document,
    claude_plugins, skill_installation_copy as files,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[path = "claude_skill_definitions.rs"]
mod definitions;
use definitions::{Definition, Inventory};
use files::{CopyResult, CopySuccess, CopyWorkspace, PreparedCopyChange, Source};

const VERIFIED_VERSION: &str = "2.1.302";
const MODES: &[&str] = &["on", "name-only", "user-invocable-only", "off"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    #[serde(flatten)]
    definition: Definition,
    mode: Option<String>,
    mode_unknown: bool,
    managed: bool,
    source_label: Option<String>,
    revision: Option<String>,
    setting_blocked: Option<String>,
    update_blocked: Option<String>,
    uninstall_blocked: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Scan {
    snapshot_id: String,
    directory: String,
    version: Option<String>,
    skills: Vec<Entry>,
    warnings: Vec<String>,
    write_blocked: Option<String>,
    install_blocked: Option<String>,
}

struct Snapshot {
    id: String,
    home: PathBuf,
    skills: BTreeMap<String, Definition>,
    config: Option<Document>,
    copies: CopyWorkspace,
    blocked: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) enum Operation {
    Install,
    SetMode,
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
    mode: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    plan_id: String,
    operation: Operation,
    name: String,
    path: String,
    setting_key: Option<String>,
    previous_mode: Option<String>,
    mode: Option<String>,
    source_label: Option<String>,
    revision: Option<String>,
    message: String,
}

struct Plan {
    view: Preview,
    snapshot_id: String,
    skill: Option<Definition>,
    change: Option<PreparedCopyChange>,
}

#[derive(Debug, Serialize)]
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

fn conflict() -> String {
    "技能、来源记录或用户配置已变化，请刷新并重新确认。".into()
}
fn inventory(home: &Path, runner: &Runner) -> Inventory {
    let plugins = claude_plugins::list(home, &["plugin", "list", "--json"], runner);
    definitions::read(home, plugins.as_ref().map_err(Clone::clone))
}
fn version_blocked(home: &Path, runner: &Runner) -> (Option<String>, Option<String>) {
    match claude_cli::version(home, runner) {
        Ok(version) => {
            let blocked = (version != VERIFIED_VERSION).then(|| format!("当前 Claude CLI {version} 的技能写入尚未验证；已验证 {VERIFIED_VERSION}，当前仅供查看。"));
            (Some(version), blocked)
        }
        Err(e) => (None, Some(e)),
    }
}
fn mode(config: &Document, key: &str) -> Result<Option<String>, String> {
    let Some(overrides) = config.value.get("skillOverrides") else {
        return Ok(None);
    };
    let map = overrides
        .as_object()
        .ok_or("用户 skillOverrides 不是对象，写入暂停。")?;
    match map.get(key) {
        None => Ok(None),
        Some(Value::String(value)) if MODES.contains(&value.as_str()) => Ok(Some(value.clone())),
        Some(_) => Err("该名称的用户调用设置未知，仅供查看。".into()),
    }
}
fn check_names(
    next: &Definition,
    rows: impl Iterator<Item = Definition>,
    excluding: Option<&str>,
) -> Result<(), String> {
    if rows
        .filter(|r| excluding != Some(r.path.as_str()))
        .any(|r| r.names.iter().any(|n| next.names.contains(n)))
    {
        return Err("当前用户清单中已有相同调用名称或别名，不会覆盖或自动重命名。".into());
    }
    Ok(())
}
impl SkillsState {
    pub fn scan(&self) -> Result<Scan, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作状态不可用")?;
        self.scan_with(claude_cli::resolve_home()?, &claude_cli::run)
    }

    fn scan_with(&self, home: PathBuf, runner: &Runner) -> Result<Scan, String> {
        let mut state = self.0.lock().map_err(|_| "技能状态不可用")?;
        state.plan = None;
        state.snapshot = None;
        state.sequence += 1;
        let id = format!("claude-skills-{}", state.sequence);
        let (version, cli_blocked) = version_blocked(&home, runner);
        let mut inventory = inventory(&home, runner);
        let config = Document::read(&home.join("settings.json"));
        let copies =
            CopyWorkspace::observe(&home, &home.join(".package-manager-claude-skills.json"));
        let blocked = cli_blocked
            .or_else(|| config.as_ref().err().cloned())
            .or_else(|| config.as_ref().ok().and_then(|c| mode(c, "").err()))
            .or_else(|| {
                (!inventory.warnings.is_empty())
                    .then(|| "部分技能来源无法核实，请处理读取问题后再维护。".into())
            });
        let file_blocked = blocked
            .clone()
            .or_else(|| copies.ledger_error().map(str::to_string))
            .or_else(|| copies.root_error().map(str::to_string));
        if let Some(reason) = &file_blocked {
            inventory.warnings.push(reason.clone());
        }
        let mut entries = Vec::new();
        let mut skills = BTreeMap::new();
        for row in inventory.rows {
            let selected = config
                .as_ref()
                .ok()
                .and_then(|c| row.setting_key.as_ref().map(|k| mode(c, k)));
            let setting_blocked = blocked
                .clone()
                .or_else(|| row.problem.clone())
                .or_else(|| selected.as_ref().and_then(|r| r.as_ref().err().cloned()))
                .or_else(|| {
                    row.setting_key
                        .is_none()
                        .then(|| "插件与同步技能请回所属来源维护。".into())
                });
            let observation = copies.inspect(&row.path);
            let record = observation.installation.as_ref();
            let independent = row.kind == "independent";
            let managed = independent && record.is_some();
            let own_reason = file_blocked
                .clone()
                .or_else(|| row.problem.clone())
                .or_else(|| (!independent).then(|| "该来源不作为本应用的独立安装副本维护。".into()))
                .or_else(|| observation.uninstall_blocked.clone())
                .or_else(|| {
                    (!observation.installation.is_some())
                        .then(|| "非本应用安装；更新和卸载请回原来源。".into())
                });
            let update_blocked = own_reason.clone().or(observation.update_blocked);
            entries.push(Entry {
                definition: row.clone(),
                mode_unknown: row.setting_key.is_some()
                    && selected.as_ref().is_none_or(|value| value.is_err()),
                mode: selected.and_then(Result::ok).flatten(),
                managed,
                source_label: record.filter(|_| independent).map(|r| r.source.label()),
                revision: record.filter(|_| independent).map(|r| r.revision.clone()),
                setting_blocked,
                update_blocked,
                uninstall_blocked: own_reason,
            });
            skills.insert(row.path.clone(), row);
        }
        for path in copies.recorded_paths().filter(|p| !skills.contains_key(*p)) {
            inventory.warnings.push(format!(
                "安装记录对应的定义不可读取：{path}。请核对原目录。"
            ));
        }
        let scan = Scan {
            snapshot_id: id.clone(),
            directory: home.display().to_string(),
            version,
            skills: entries,
            warnings: inventory.warnings,
            write_blocked: blocked.clone(),
            install_blocked: file_blocked,
        };
        state.snapshot = Some(Snapshot {
            id,
            home,
            skills,
            config: config.ok(),
            copies,
            blocked,
        });
        Ok(scan)
    }

    fn check_current(snapshot: &Snapshot, home: &Path, runner: &Runner) -> Result<(), String> {
        if snapshot.home != home || snapshot.blocked.is_some() {
            return Err(snapshot.blocked.clone().unwrap_or_else(conflict));
        }
        if let Some(reason) = version_blocked(home, runner).1 {
            return Err(reason);
        }
        if !snapshot.config.as_ref().is_some_and(Document::unchanged) {
            return Err(conflict());
        }
        let current = inventory(home, runner);
        let rows: BTreeMap<_, _> = current
            .rows
            .into_iter()
            .map(|r| (r.path.clone(), r))
            .collect();
        if !current.warnings.is_empty() || rows != snapshot.skills {
            return Err(conflict());
        }
        Ok(())
    }

    fn check_files(snapshot: &Snapshot) -> Result<(), String> {
        snapshot.copies.check_current().map_err(|_| conflict())
    }

    pub fn prepare(&self, request: Request) -> Result<Preview, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作状态不可用")?;
        self.prepare_with(request, &claude_cli::resolve_home()?, &claude_cli::run)
    }

    fn prepare_with(
        &self,
        request: Request,
        home: &Path,
        runner: &Runner,
    ) -> Result<Preview, String> {
        let mut state = self.0.lock().map_err(|_| "技能状态不可用")?;
        state.plan = None;
        state.sequence += 1;
        let plan_id = format!("claude-skill-plan-{}", state.sequence);
        let snapshot = state
            .snapshot
            .as_ref()
            .filter(|s| s.id == request.snapshot_id)
            .ok_or_else(conflict)?;
        Self::check_current(snapshot, home, runner)?;
        let config = snapshot.config.as_ref().unwrap();
        let mut change = None;
        let row;
        let previous;
        let message;
        if request.operation == Operation::Install {
            Self::check_files(snapshot)?;
            if home.canonicalize().map_err(|e| e.to_string())? != home {
                return Err(conflict());
            }
            let candidate = snapshot
                .copies
                .prepare_install(request.source.as_ref().ok_or("请选择安装来源。")?)?;
            row = definitions::staged(candidate.staged().unwrap())?;
            check_names(&row, snapshot.skills.values().cloned(), None)?;
            if fs::symlink_metadata(candidate.target_path().unwrap().parent().unwrap()).is_ok() {
                return Err("目标目录已存在，不会覆盖。".into());
            }
            previous = mode(config, row.setting_key.as_ref().unwrap())?;
            change = Some(candidate);
            message = "安装独立副本，保留原始来源及现有用户调用设置；不会调用技能或运行脚本。";
        } else {
            row = snapshot
                .skills
                .get(request.path.as_deref().ok_or("未选择技能。")?)
                .ok_or_else(conflict)?
                .clone();
            if let Some(problem) = &row.problem {
                return Err(problem.clone());
            }
            let key = row
                .setting_key
                .as_ref()
                .ok_or("插件与同步技能请回所属来源维护。")?;
            previous = mode(config, key)?;
            if request.operation == Operation::SetMode {
                if request
                    .mode
                    .as_ref()
                    .is_some_and(|v| !MODES.contains(&v.as_str()))
                {
                    return Err("不支持的技能调用设置。".into());
                }
                message = "只修改此名称的用户默认调用设置，可能影响其他项目中的同名技能；项目或更高层配置仍可覆盖。技能文件保持不变。";
            } else {
                if row.kind != "independent" {
                    return Err("旧版命令不作为本应用的安装副本维护。".into());
                }
                Self::check_files(snapshot)?;
                let candidate = if request.operation == Operation::Update {
                    let candidate = snapshot.copies.prepare_update(&row.path)?;
                    let next = definitions::staged(candidate.staged().unwrap())?;
                    if next.setting_key != row.setting_key || next.names != row.names {
                        return Err("来源的调用名称或别名已变化，停止更新以保留原调用设置。".into());
                    }
                    check_names(&next, snapshot.skills.values().cloned(), Some(&row.path))?;
                    candidate
                } else {
                    snapshot.copies.prepare_uninstall(&row.path)?
                };
                change = Some(candidate);
                message = if request.operation == Operation::Update {
                    "按已记录来源更新，保留用户调用设置；本地修改或调用名称变化会阻止更新。"
                } else {
                    "整份安装副本（包括本地修改）移入废纸篓，保留原始来源和按名称的用户调用设置。清空废纸篓前可找回。"
                };
            }
        }
        let path = if request.operation == Operation::Install {
            change
                .as_ref()
                .unwrap()
                .target_path()
                .unwrap()
                .display()
                .to_string()
        } else {
            row.path.clone()
        };
        let source_label = change.as_ref().and_then(PreparedCopyChange::source_label);
        let revision = change
            .as_ref()
            .and_then(PreparedCopyChange::revision)
            .map(str::to_string);
        let view = Preview {
            plan_id,
            operation: request.operation,
            name: row.name.clone(),
            path,
            setting_key: row.setting_key.clone(),
            previous_mode: previous.clone(),
            mode: if request.operation == Operation::SetMode {
                request.mode
            } else {
                previous
            },
            source_label,
            revision,
            message: message.into(),
        };
        state.plan = Some(Plan {
            view: view.clone(),
            snapshot_id: snapshot.id.clone(),
            skill: (request.operation != Operation::Install).then_some(row),
            change,
        });
        Ok(view)
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
            .filter(|s| {
                s.id == snapshot_id && s.home == claude_cli::resolve_home().unwrap_or_default()
            })
            .ok_or_else(conflict)?;
        let row = snapshot.skills.get(path).ok_or_else(conflict)?;
        if Path::new(path).canonicalize().ok().as_ref() != Some(&row.resolved) {
            return Err(conflict());
        }
        files::read_markdown(Path::new(path))
    }

    pub fn commit(&self, plan_id: &str) -> Result<Outcome, String> {
        let _operation = claude_cli::OPERATIONS
            .lock()
            .map_err(|_| "Claude 操作状态不可用")?;
        self.commit_with(
            plan_id,
            &claude_cli::resolve_home()?,
            &claude_cli::run,
            &crate::session_records::move_path_to_trash,
        )
    }

    fn commit_with(
        &self,
        plan_id: &str,
        home: &Path,
        runner: &Runner,
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
        let Some(snapshot) = state.snapshot.take().filter(|s| s.id == plan.snapshot_id) else {
            return Ok(Outcome::new("Conflict", conflict()));
        };
        let checked = (|| -> Result<(), String> {
            Self::check_current(&snapshot, home, runner)?;
            if plan.view.operation != Operation::SetMode {
                let change = plan.change.as_ref().ok_or("文件维护计划未准备。")?;
                change.check_before_commit()?;
                if let Some(staged) = change.staged() {
                    let next = definitions::staged(staged)?;
                    check_names(
                        &next,
                        snapshot.skills.values().cloned(),
                        plan.skill.as_ref().map(|s| s.path.as_str()),
                    )?;
                }
            }
            if !snapshot.config.as_ref().unwrap().unchanged() {
                return Err(conflict());
            }
            Ok(())
        })();
        if let Err(error) = checked {
            return Ok(Outcome::new("Conflict", error));
        }
        if plan.view.operation == Operation::SetMode {
            let config = snapshot.config.as_ref().unwrap();
            let mut next = config.value.clone();
            let map = next
                .as_object_mut()
                .unwrap()
                .entry("skillOverrides")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .ok_or("用户 skillOverrides 不是对象。")?;
            let key = plan.view.setting_key.as_ref().unwrap();
            if let Some(mode) = &plan.view.mode {
                map.insert(key.clone(), Value::String(mode.clone()));
            } else {
                map.remove(key);
            }
            return Ok(match config.write_skill_overrides(&next) {
                Ok(()) => Outcome::new(
                    "Saved",
                    "用户调用设置已保存；请在新会话中核对，项目或更高优先级设置仍可能覆盖。",
                ),
                Err(e) => Outcome::new("Failed", e),
            });
        }
        let result = plan
            .change
            .take()
            .ok_or("文件维护计划未准备。")?
            .commit(&snapshot.config.as_ref().unwrap().file, trash);
        Ok(match result {
            CopyResult::Conflict(error) => Outcome::new("Conflict", error),
            CopyResult::Failed(error) => Outcome::new("Failed", error),
            CopyResult::Partial(error) => Outcome::new("Partial", error),
            CopyResult::Succeeded(CopySuccess::Unchanged) => Outcome::new(
                "Unchanged",
                "已记录来源没有新内容，副本和调用设置保持不变。",
            ),
            CopyResult::Succeeded(CopySuccess::Uninstalled) => Outcome::new(
                "Succeeded",
                "安装副本已移入废纸篓，原始来源保持不变；按名称的用户调用设置保留，再安装时仍沿用原选择。",
            ),
            CopyResult::Succeeded(CopySuccess::Installed) => Outcome::new(
                "Succeeded",
                "技能副本已安装，原始来源及用户调用设置保持不变。请在新会话中核对。",
            ),
            CopyResult::Succeeded(CopySuccess::Updated) => Outcome::new(
                "Succeeded",
                "技能副本已更新，用户调用设置保持不变。请在新会话中核对。",
            ),
        })
    }
}

#[cfg(test)]
#[path = "claude_skill_tests.rs"]
mod tests;
