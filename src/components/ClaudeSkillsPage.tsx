import { ArrowClockwise, FolderOpen, Plus } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { Fragment, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { skillOperationLabel, skillSourceLabel, skillModeLabel, type SkillMode, type ClaudeSkill, type SkillIntent, type SkillSource } from "../claudeSkills";
import type { ClaudeSkills } from "../hooks/useClaudeSkills";
import { errorToString } from "../utils/format";
import { EmptyState, Panel, PanelHead, SkeletonRows } from "./ui";

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const githubSource: SkillSource = { kind: "github", repo: "", subdirectory: "", reference: "", referenceKind: "branch" };

export function ClaudeSkillsPage({ workflow, onShowPlugins }: { workflow: ClaudeSkills; onShowPlugins: (pluginId?: string) => void }) {
  const { scan, current, scanning, busy, phase, preview, error, result } = workflow;
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [enableFilter, setEnableFilter] = useState("all");
  const [installing, setInstalling] = useState(false);
  const [source, setSource] = useState<SkillSource>(githubSource);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<{ text?: string; error?: string; loading?: boolean }>({});
  const detailRequest = useRef(0);
  const trigger = useRef<HTMLButtonElement | HTMLSelectElement | null>(null);
  const refresh = useRef<HTMLButtonElement | null>(null);
  const installButton = useRef<HTMLButtonElement | null>(null);
  const formTitle = useRef<HTMLHeadingElement | null>(null);
  const blocked = busy || !current;
  const rows = (scan?.skills ?? []).filter((skill) => {
    const origin = skill.kind !== "independent" ? skill.kind : skill.managed ? "managed" : "existing";
    return (sourceFilter === "all" || origin === sourceFilter) && (enableFilter === "all" || (skill.settingKey ? skill.modeUnknown ? "unknown" : skill.mode ?? "inherit" : "unavailable") === enableFilter)
      && `${skill.name} ${skill.description} ${skill.path} ${skill.sourceLabel ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  useEffect(() => { detailRequest.current += 1; setExpanded(null); setMarkdown({}); }, [workflow.revision]);
  useEffect(() => { if (installing) formTitle.current?.focus(); }, [installing]);

  async function request(intent: SkillIntent, button: HTMLButtonElement | HTMLSelectElement) {
    trigger.current = button; setRequestError(null); setRequestError(await workflow.request(intent));
  }
  async function expand(skill: ClaudeSkill) {
    const epoch = ++detailRequest.current;
    if (expanded === skill.path) { setExpanded(null); return; }
    setExpanded(skill.path); setMarkdown({ loading: true });
    try { const text = await workflow.details(skill.path); if (epoch === detailRequest.current) setMarkdown({ text }); }
    catch (caught) { if (epoch === detailRequest.current) setMarkdown({ error: errorToString(caught) }); }
  }

  return <section className="view-grid" aria-label="Claude Code Skills 管理" aria-busy={scanning || phase === "preparing" || phase === "executing"}>
    <Panel>
      <PanelHead title="Claude Code Skills" action={<div className="flex flex-wrap gap-2">
        <Button ref={refresh} size="sm" variant="outline" disabled={busy} onClick={() => void workflow.refresh()}><ArrowClockwise aria-hidden="true" className={scanning ? "motion-safe:animate-spin" : undefined} />{scanning ? "读取中" : "刷新"}</Button>
        <Button ref={installButton} size="sm" disabled={blocked || Boolean(scan?.installBlocked)} onClick={() => { setInstalling(true); setRequestError(null); }}><Plus aria-hidden="true" />安装技能</Button>
      </div>} />
      <CardContent className="grid gap-2 p-4">
        <p className="text-sm">查看当前用户的技能定义，调整调用设置，维护本应用安装的副本。</p>
        <p className="text-xs text-muted-foreground">Claude 用户目录 <code className="ml-2 break-all text-foreground">{scan?.directory || "尚未读取"}</code></p>
        <p className="text-xs text-muted-foreground">包含禁用项、插件和旧版命令；定义存在不代表当前会话已加载。 <button type="button" disabled={busy} onClick={() => onShowPlugins()} className="cursor-pointer text-primary underline underline-offset-4 disabled:opacity-50">前往插件市场</button></p>
        <p role="status" className="text-xs text-muted-foreground">{phase === "preparing" ? "正在取得来源并核对技能，尚未执行维护…" : phase === "executing" ? "正在执行并重新核对清单…" : scanning ? "正在读取，已有内容暂为上次结果。" : "调用设置按名称影响用户默认行为，项目或更高层配置仍可覆盖；修改后请在新会话核对。"}</p>
      </CardContent>
    </Panel>
    {requestError ? <Alert variant="destructive"><AlertTitle>暂时无法准备操作</AlertTitle><AlertDescription className="break-words">{requestError}</AlertDescription></Alert> : null}
    {result ? <Alert role="status" variant={result.status === "Failed" || result.status === "Partial" ? "destructive" : "default"}>
      <AlertTitle>{({ Succeeded: "操作已完成", Saved: "用户调用设置已保存", Unchanged: "来源没有新内容", Partial: "操作未完整确认，请核对", Conflict: "目标已变化，请重新确认", Failed: "操作未完成" })[result.status]}</AlertTitle><AlertDescription className="break-words">{result.message}</AlertDescription>
    </Alert> : null}
    {error ? <Alert variant="destructive"><AlertTitle>{result && ["Succeeded", "Saved"].includes(result.status) ? "操作已完成，但清单刷新失败" : "技能清单读取失败"}</AlertTitle><AlertDescription>{error} {scan?.skills.length ? "下方为已过期的上次结果，暂时不能维护。" : ""}</AlertDescription></Alert> : null}
    {scan?.warnings.length ? <Alert><AlertTitle>需要核对的内容</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-4">{scan.warnings.map((warning, i) => <li className="break-all" key={i}>{warning}</li>)}</ul></AlertDescription></Alert> : null}

    {installing ? <Panel><PanelHead title="安装独立技能" /><CardContent className="p-4">
      <h3 ref={formTitle} tabIndex={-1} className="sr-only">填写技能安装来源</h3>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); const button = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]'); if (button) void request({ operation: "Install", source }, button); }}>
        <p className="text-sm text-muted-foreground">检查后确认一个技能的来源和安装位置。本地导入会复制一份，原目录保持不变。</p>
        <label className="grid gap-1 text-sm">来源类型<select className={selectClass + " w-fit"} disabled={busy} value={source.kind} onChange={(event) => setSource(event.target.value === "local" ? { kind: "local", path: "" } : githubSource)}><option value="github">GitHub 仓库</option><option value="local">本地目录</option></select></label>
        {source.kind === "local" ? <div className="grid gap-1"><label className="text-sm" htmlFor="skill-local-path">技能目录</label><div className="flex gap-2"><Input id="skill-local-path" required disabled={busy} value={source.path} placeholder="/Users/you/skills/my-skill" onChange={(event) => setSource({ ...source, path: event.target.value })} /><Button type="button" variant="outline" disabled={busy} aria-label="选择技能目录" onClick={async () => { try { const path = await invoke<string | null>("choose_codex_marketplace_directory"); if (path) setSource({ kind: "local", path }); } catch (caught) { setRequestError(errorToString(caught)); } }}><FolderOpen aria-hidden="true" /></Button></div></div>
          : <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">GitHub 仓库<Input required disabled={busy} value={source.repo} placeholder="owner/repo 或 GitHub 仓库地址" onChange={(event) => setSource({ ...source, repo: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">技能子目录<Input disabled={busy} value={source.subdirectory} placeholder="skills/my-skill；根目录可留空" onChange={(event) => setSource({ ...source, subdirectory: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">版本类型<select className={selectClass} disabled={busy} value={source.referenceKind} onChange={(event) => setSource({ ...source, referenceKind: event.target.value as "branch" | "tag" })}><option value="branch">分支（更新跟随新提交）</option><option value="tag">标签（固定版本）</option></select></label>
            <label className="grid gap-1 text-sm">{source.referenceKind === "tag" ? "标签名称" : "分支名称"}<Input required={source.referenceKind === "tag"} disabled={busy} value={source.reference} placeholder={source.referenceKind === "tag" ? "例如 v1.0.0" : "留空使用仓库默认分支"} onChange={(event) => setSource({ ...source, reference: event.target.value })} /></label>
          </div>}
        <div className="flex gap-2"><Button type="submit" disabled={blocked || Boolean(scan?.installBlocked)}>{phase === "preparing" ? "正在检查…" : "检查并预览"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setInstalling(false); installButton.current?.focus(); }}>收起</Button></div>
        {scan?.installBlocked ? <p className="text-sm text-muted-foreground">{scan.installBlocked}</p> : null}
      </form>
    </CardContent></Panel> : null}

    <Panel className="overflow-hidden"><PanelHead title="技能清单" action={<span className="text-xs text-muted-foreground">{current ? `${rows.length} / ${scan?.skills.length ?? 0} 项` : "清单待核对"}</span>} />
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="grid min-w-48 flex-1 gap-1 text-xs text-muted-foreground">搜索技能<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、说明或路径" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">来源<select className={selectClass} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">全部来源</option><option value="managed">本应用安装</option><option value="existing">已有独立技能</option><option value="plugin">插件技能</option><option value="legacy">旧版命令</option><option value="synced">同步技能</option></select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">用户调用设置<select className={selectClass} value={enableFilter} onChange={(event) => setEnableFilter(event.target.value)}><option value="all">全部状态</option><option value="inherit">未设置用户覆盖</option>{Object.entries(skillModeLabel).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}<option value="unavailable">由所属来源管理</option><option value="unknown">无法识别用户设置</option></select></label>
      </div>
      {!scan && scanning ? <SkeletonRows label="正在读取技能" /> : rows.length ? <Table className="min-w-[780px] table-fixed">
        <TableHeader><TableRow><TableHead className="w-[33%]">技能</TableHead><TableHead className="w-[24%]">来源与维护范围</TableHead><TableHead className="w-[24%]">用户调用设置</TableHead><TableHead className="w-[19%] text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((skill, index) => <Fragment key={skill.path}>
          <TableRow>
            <TableCell className="whitespace-normal align-top"><button type="button" disabled={!current} className="cursor-pointer break-all text-left font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50" aria-expanded={expanded === skill.path} aria-controls={expanded === skill.path ? `skill-detail-${index}` : undefined} onClick={() => void expand(skill)}>{skill.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{expanded === skill.path ? "收起技能说明" : "查看技能说明"}</span></button><code className="mt-2 block break-all text-xs text-muted-foreground">{skill.path}</code><p className="mt-2 line-clamp-2 break-words text-xs text-muted-foreground">{skill.description}</p></TableCell>
            <TableCell className="whitespace-normal align-top"><p className="text-sm">{skillSourceLabel(skill)}</p>{skill.pluginId ? <button type="button" disabled={busy} className="mt-1 cursor-pointer break-all text-left text-xs text-primary underline underline-offset-4" onClick={() => onShowPlugins(skill.pluginId!)}>{skill.pluginId}</button> : <p className="mt-1 break-all text-xs text-muted-foreground">{skill.sourceLabel ?? "文件维护请回原来源"}</p>}{skill.updateBlocked && skill.managed ? <p className="mt-2 break-words text-xs text-muted-foreground">{skill.updateBlocked}</p> : null}</TableCell>
            <TableCell className="whitespace-normal align-top">
              {skill.settingKey ? <><label className="sr-only" htmlFor={`claude-mode-${index}`}>调用设置 {skill.name}</label><select id={`claude-mode-${index}`} className={selectClass + " w-full px-2"} value={skill.modeUnknown ? "unknown" : skill.mode ?? "inherit"} disabled={blocked || Boolean(skill.settingBlocked)} onChange={(event) => void request({ operation: "SetMode", path: skill.path, mode: event.target.value === "inherit" ? null : event.target.value as SkillMode }, event.currentTarget)}>{skill.modeUnknown ? <option value="unknown">无法识别用户设置</option> : null}<option value="inherit">{skill.mode ? "移除用户覆盖" : "未设置用户覆盖"}</option>{Object.entries(skillModeLabel).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select><code className="mt-2 block break-all text-xs text-muted-foreground">设置名称：{skill.settingKey}</code></> : <p className="text-sm">{skill.kind === "synced" ? "由同步来源管理" : skill.pluginEnabled === null ? "插件状态未知" : skill.pluginEnabled ? "所属插件已启用" : "所属插件已禁用"}</p>}
              {skill.settingBlocked ? <p className="mt-2 break-words text-xs text-muted-foreground">{skill.settingBlocked}</p> : null}
              {skill.problem ? <p className="mt-2 break-words text-xs text-destructive">{skill.problem}</p> : null}
            </TableCell>
            <TableCell className="align-top"><div className="flex flex-wrap justify-end gap-1">
              {skill.managed ? <><Button size="sm" variant="outline" disabled={blocked || Boolean(skill.updateBlocked)} aria-label={`更新 ${skill.name}`} onClick={(event) => void request({ operation: "Update", path: skill.path }, event.currentTarget)}>更新</Button><Button size="sm" variant="ghost" className="text-destructive" disabled={blocked || Boolean(skill.uninstallBlocked)} aria-label={`卸载 ${skill.name}`} onClick={(event) => void request({ operation: "Uninstall", path: skill.path }, event.currentTarget)}>卸载</Button></> : <span className="text-xs text-muted-foreground">{skill.kind === "plugin" ? "在插件页维护" : "文件由原来源维护"}</span>}
              {skill.uninstallBlocked && skill.managed ? <p className="text-xs text-muted-foreground">{skill.uninstallBlocked}</p> : null}
            </div></TableCell>
          </TableRow>
          {expanded === skill.path ? <TableRow id={`skill-detail-${index}`}><TableCell colSpan={4} className="whitespace-normal bg-muted/30"><dl className="grid gap-3 py-2"><Detail label="技能路径" value={skill.path} /><Detail label="作者调用声明" value={`${skill.disableModelInvocation ? "不允许模型自行调用" : "未限制模型自行调用"}；${skill.userInvocable ? "允许用户调用" : "不允许用户直接调用"}`} />{skill.revision ? <Detail label="已安装版本／内容基准" value={skill.revision} /> : null}<div><dt className="text-xs text-muted-foreground">技能定义（只读）</dt><dd>{markdown.loading ? <p className="mt-2 text-sm" role="status">正在读取说明…</p> : markdown.error ? <p className="mt-2 text-sm text-destructive" role="alert">{markdown.error}</p> : <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{markdown.text}</pre>}</dd></div></dl></TableCell></TableRow> : null}
        </Fragment>)}</TableBody>
      </Table> : <EmptyState message={!current ? "清单暂不可用，请查看上方状态并刷新。" : scan?.skills.length ? "没有符合筛选条件的技能，请调整搜索或筛选。" : "当前用户范围未读到技能定义。可从 GitHub 或本地目录安装一个技能。"} />}
    </Panel>
    <AlertDialog open={preview !== null} onOpenChange={(open) => { if (!open && phase === "confirming") workflow.cancel(); }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus(); else refresh.current?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>{preview?.operation === "SetMode" ? "确认调整技能调用设置" : `确认${preview ? skillOperationLabel[preview.operation] : "维护"}技能`}</AlertDialogTitle><AlertDialogDescription>{preview?.message}</AlertDialogDescription></AlertDialogHeader>
        {preview ? <dl className="grid gap-3"><Detail label="技能" value={preview.name} /><Detail label="目标路径" value={preview.path} />{preview.sourceLabel ? <Detail label="来源" value={preview.sourceLabel} /> : null}{preview.revision ? <Detail label="本次取得的版本／内容基准" value={preview.revision} /> : null}{preview.settingKey ? <Detail label="实际设置名称（用户范围）" value={preview.settingKey} /> : null}{preview.operation === "SetMode" ? <Detail label="当前用户选择" value={preview.previousMode ? skillModeLabel[preview.previousMode] : "未设置用户覆盖"} /> : null}<Detail label={preview.operation === "SetMode" ? "保存后的用户选择" : "保留的用户调用设置"} value={preview.mode ? skillModeLabel[preview.mode] : "未设置用户覆盖"} /></dl> : null}
        <AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={phase === "executing"}>取消</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant={preview?.operation === "Uninstall" ? "destructive" : "default"} disabled={phase !== "confirming"} onClick={async (event) => { event.preventDefault(); const outcome = await workflow.confirm(); if (outcome && ["Succeeded", "Partial", "Unchanged"].includes(outcome.status)) setInstalling(false); }}>{phase === "executing" ? "正在执行并核对…" : `确认${preview ? skillOperationLabel[preview.operation] : "维护"}`}</Button></AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono text-xs">{value}</dd></div>;
}
