use crate::{
    claude_cli::{self, Runner},
    claude_documents::Document,
    claude_plugins,
    codex_skills::files,
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
use files::{Identity, Installation, Ledger, Source, Staged};

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
    ledger: Option<Ledger>,
    root: Option<Identity>,
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
    installation: Option<Installation>,
    staged: Option<Staged>,
    content_hash: Option<String>,
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
fn root_identity(home: &Path) -> Result<Option<Identity>, String> {
    let root = home.join("skills");
    match fs::symlink_metadata(&root) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => {
            let identity = files::directory_identity(&root)?;
            if root.canonicalize().map_err(|e| e.to_string())? != root {
                return Err("技能安装根目录是链接，文件维护暂停。".into());
            }
            Ok(Some(identity))
        }
    }
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
fn owned_skill(home: &Path, path: &str, entry: &Installation) -> Result<(), String> {
    if entry.directory.join("SKILL.md") != Path::new(path) {
        return Err("技能路径与安装记录不一致。".into());
    }
    files::owned(home, entry)
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
        let ledger = Ledger::read_at(&home.join(".package-manager-claude-skills.json"));
        let root = root_identity(&home);
        let blocked = cli_blocked
            .or_else(|| config.as_ref().err().cloned())
            .or_else(|| config.as_ref().ok().and_then(|c| mode(c, "").err()))
            .or_else(|| {
                (!inventory.warnings.is_empty())
                    .then(|| "部分技能来源无法核实，请处理读取问题后再维护。".into())
            });
        let file_blocked = blocked
            .clone()
            .or_else(|| ledger.as_ref().err().cloned())
            .or_else(|| root.as_ref().err().cloned());
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
            let record = ledger
                .as_ref()
                .ok()
                .and_then(|l| l.records.installations.get(&row.path));
            let independent = row.kind == "independent";
            let managed = independent && record.is_some();
            let own_reason = file_blocked
                .clone()
                .or_else(|| row.problem.clone())
                .or_else(|| (!independent).then(|| "该来源不作为本应用的独立安装副本维护。".into()))
                .or_else(|| match record {
                    Some(record) => owned_skill(&home, &row.path, record).err(),
                    None => Some("非本应用安装；更新和卸载请回原来源。".into()),
                });
            let update_blocked = own_reason.clone().or_else(|| {
                record.and_then(|record| match files::fingerprint(&record.directory) {
                    Ok(hash) if hash == record.hash => None,
                    Ok(_) => Some("安装副本有本地修改，更新已暂停。".into()),
                    Err(e) => Some(e),
                })
            });
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
        if let Ok(ledger) = &ledger {
            for path in ledger
                .records
                .installations
                .keys()
                .filter(|p| !skills.contains_key(*p))
            {
                inventory.warnings.push(format!(
                    "安装记录对应的定义不可读取：{path}。请核对原目录。"
                ));
            }
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
            ledger: ledger.ok(),
            root: root.ok().flatten(),
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
        let ledger = snapshot.ledger.as_ref().ok_or("本应用的安装记录不可用。")?;
        if !ledger.file.unchanged() || root_identity(&snapshot.home)? != snapshot.root {
            return Err(conflict());
        }
        Ok(())
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
        let mut installation = None;
        let mut staged = None;
        let mut content_hash = None;
        let row;
        let previous;
        let message;
        if request.operation == Operation::Install {
            Self::check_files(snapshot)?;
            fs::create_dir_all(home).map_err(|e| e.to_string())?;
            if home.canonicalize().map_err(|e| e.to_string())? != home {
                return Err(conflict());
            }
            let candidate = files::stage(
                home,
                request.source.as_ref().ok_or("请选择安装来源。")?,
                None,
            )?;
            row = definitions::staged(&candidate)?;
            check_names(&row, snapshot.skills.values().cloned(), None)?;
            if fs::symlink_metadata(home.join("skills").join(&candidate.name)).is_ok() {
                return Err("目标目录已存在，不会覆盖。".into());
            }
            previous = mode(config, row.setting_key.as_ref().unwrap())?;
            staged = Some(candidate);
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
                let record = snapshot
                    .ledger
                    .as_ref()
                    .unwrap()
                    .records
                    .installations
                    .get(&row.path)
                    .ok_or("非本应用安装，不能更新或卸载。")?;
                owned_skill(home, &row.path, record)?;
                let hash = files::fingerprint(&record.directory)?;
                if request.operation == Operation::Update {
                    if hash != record.hash {
                        return Err("安装副本有本地修改，更新已停止。".into());
                    }
                    let pinned = matches!(&record.source, Source::Github {reference_kind, ..} if reference_kind == "tag").then_some(record.revision.as_str());
                    let candidate = files::stage(home, &record.source, pinned)?;
                    let next = definitions::staged(&candidate)?;
                    if next.setting_key != row.setting_key || next.names != row.names {
                        return Err("来源的调用名称或别名已变化，停止更新以保留原调用设置。".into());
                    }
                    check_names(&next, snapshot.skills.values().cloned(), Some(&row.path))?;
                    staged = Some(candidate);
                }
                installation = Some(record.clone());
                content_hash = Some(hash);
                message = if request.operation == Operation::Update {
                    "按已记录来源更新，保留用户调用设置；本地修改或调用名称变化会阻止更新。"
                } else {
                    "整份安装副本（包括本地修改）移入废纸篓，保留原始来源和按名称的用户调用设置。清空废纸篓前可找回。"
                };
            }
        }
        let view = Preview {
            plan_id,
            operation: request.operation,
            name: row.name.clone(),
            path: if request.operation == Operation::Install {
                home.join("skills")
                    .join(&staged.as_ref().unwrap().name)
                    .join("SKILL.md")
                    .display()
                    .to_string()
            } else {
                row.path.clone()
            },
            setting_key: row.setting_key.clone(),
            previous_mode: previous.clone(),
            mode: if request.operation == Operation::SetMode {
                request.mode
            } else {
                previous
            },
            source_label: staged
                .as_ref()
                .map(|s| s.source.label())
                .or_else(|| installation.as_ref().map(|i| i.source.label())),
            revision: staged
                .as_ref()
                .map(|s| s.revision.clone())
                .or_else(|| installation.as_ref().map(|i| i.revision.clone())),
            message: message.into(),
        };
        state.plan = Some(Plan {
            view: view.clone(),
            snapshot_id: snapshot.id.clone(),
            skill: (request.operation != Operation::Install).then_some(row),
            installation,
            staged,
            content_hash,
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
        let plan = state.plan.take().unwrap();
        let Some(snapshot) = state.snapshot.take().filter(|s| s.id == plan.snapshot_id) else {
            return Ok(Outcome::new("Conflict", conflict()));
        };
        let checked = (|| -> Result<(), String> {
            Self::check_current(&snapshot, home, runner)?;
            if plan.view.operation != Operation::SetMode {
                Self::check_files(&snapshot)?;
                if let Some(record) = &plan.installation {
                    owned_skill(home, &plan.view.path, record)?;
                    if Some(files::fingerprint(&record.directory)?) != plan.content_hash {
                        return Err(conflict());
                    }
                }
            }
            if let Some(candidate) = &plan.staged {
                if files::fingerprint(&candidate.directory)? != candidate.hash {
                    return Err("准备的副本已变化，请重新检查。".into());
                }
                let next = definitions::staged(candidate)?;
                check_names(
                    &next,
                    snapshot.skills.values().cloned(),
                    plan.skill.as_ref().map(|s| s.path.as_str()),
                )?;
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
        // File maintenance below uses the same identity, staging and recovery rules as Codex.
        Self::commit_files(home, snapshot, plan, trash)
    }

    fn commit_files(
        home: &Path,
        snapshot: Snapshot,
        mut plan: Plan,
        trash: &dyn Fn(&Path) -> Result<(), String>,
    ) -> Result<Outcome, String> {
        let mut ledger = snapshot.ledger.unwrap();
        let target = Path::new(&plan.view.path)
            .parent()
            .ok_or("安装路径无效。")?;
        if plan.view.operation == Operation::Uninstall {
            let holding = tempfile::Builder::new()
                .prefix(".package-manager-uninstall-")
                .tempdir_in(home)
                .map_err(|e| e.to_string())?;
            let isolated = holding
                .path()
                .join(target.file_name().ok_or("安装路径无效。")?);
            if let Err(e) = files::rename_new(target, &isolated) {
                return Ok(Outcome::new("Conflict", e));
            }
            let entry = plan.installation.as_ref().unwrap();
            let checked = files::directory_identity(&isolated) == Ok(entry.identity.clone())
                && files::fingerprint(&isolated).ok() == plan.content_hash;
            let result = if checked {
                trash(&isolated)
            } else {
                Err(conflict())
            };
            if let Err(e) = result {
                if files::rename_new(&isolated, target).is_ok() {
                    return Ok(Outcome::new(if checked { "Failed" } else { "Conflict" }, e));
                }
                let recovery = holding.keep();
                return Ok(Outcome::new(
                    "Partial",
                    format!(
                        "{e}；移除未完整确认，请核对原目录、废纸篓及 {}。",
                        recovery.display()
                    ),
                ));
            }
            ledger.records.installations.remove(&plan.view.path);
            return Ok(match ledger.save() {
                Ok(()) => Outcome::new("Succeeded", "安装副本已移入废纸篓，原始来源保持不变；按名称的用户调用设置保留，再安装时仍沿用原选择。"),
                Err(e) => Outcome::new("Partial", format!("副本已移入废纸篓，但{e}。请核对安装记录。")),
            });
        }
        let candidate = plan.staged.take().ok_or("安装副本未准备。")?;
        if plan.view.operation == Operation::Update
            && plan
                .installation
                .as_ref()
                .is_some_and(|i| i.hash == candidate.hash && i.revision == candidate.revision)
        {
            return Ok(Outcome::new(
                "Unchanged",
                "已记录来源没有新内容，副本和调用设置保持不变。",
            ));
        }
        if snapshot.root.is_none() {
            if let Err(e) = fs::create_dir(home.join("skills")) {
                return Ok(Outcome::new("Conflict", format!("无法创建安装目录：{e}")));
            }
        }
        let backup = candidate.temp.path().join("previous-installation");
        if plan.view.operation == Operation::Update {
            if let Err(e) = files::rename_new(target, &backup) {
                return Ok(Outcome::new("Failed", e));
            }
            let entry = plan.installation.as_ref().unwrap();
            if files::directory_identity(&backup) != Ok(entry.identity.clone())
                || files::fingerprint(&backup).ok() != plan.content_hash
            {
                if files::rename_new(&backup, target).is_ok() {
                    return Ok(Outcome::new("Conflict", conflict()));
                }
                let recovery = candidate.temp.keep();
                return Ok(Outcome::new(
                    "Partial",
                    format!(
                        "目录在操作期间变化，原对象保留在 {}，请核对恢复。",
                        recovery.display()
                    ),
                ));
            }
        }
        if let Err(e) = files::rename_new(&candidate.directory, target) {
            if backup.exists() && files::rename_new(&backup, target).is_err() {
                let recovery = candidate.temp.keep();
                return Ok(Outcome::new(
                    "Partial",
                    format!("{e}；旧副本保留在 {}，请核对恢复。", recovery.display()),
                ));
            }
            return Ok(Outcome::new("Failed", e));
        }
        let identity = match files::directory_identity(target) {
            Ok(value) => value,
            Err(error) => {
                let recovery = candidate.temp.keep();
                return Ok(Outcome::new(
                    "Partial",
                    format!("副本已变更，但{error}；恢复资料在 {}。", recovery.display()),
                ));
            }
        };
        let record = Installation {
            directory: target.to_path_buf(),
            identity,
            source: candidate.source,
            revision: candidate.revision,
            hash: candidate.hash,
        };
        ledger
            .records
            .installations
            .insert(plan.view.path.clone(), record.clone());
        if let Err(e) = ledger.save() {
            // Roll back only the exact, still-unmodified copy just published by this operation.
            let rollback = files::directory_identity(target) == Ok(record.identity.clone())
                && files::fingerprint(target) == Ok(record.hash.clone())
                && files::rename_new(target, &candidate.directory).is_ok()
                && (!backup.exists() || files::rename_new(&backup, target).is_ok());
            if rollback {
                return Ok(Outcome::new("Failed", format!("{e}；文件变更已撤回。")));
            }
            let recovery = candidate.temp.keep();
            return Ok(Outcome::new(
                "Partial",
                format!(
                    "副本已变更，但{e}；恢复资料保留在 {}，请核对。",
                    recovery.display()
                ),
            ));
        }
        Ok(Outcome::new(
            "Succeeded",
            if plan.view.operation == Operation::Install {
                "技能副本已安装，原始来源及用户调用设置保持不变。请在新会话中核对。"
            } else {
                "技能副本已更新，用户调用设置保持不变。请在新会话中核对。"
            },
        ))
    }
}

#[cfg(test)]
#[path = "claude_skill_tests.rs"]
mod tests;
