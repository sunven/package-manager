import { ArrowClockwise, FolderOpen, Plus } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { Fragment, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { marketplaceSourceLabel, type CodexMarketplace } from "../codexMarketplaces";
import type { CodexExtensions } from "../hooks/useCodexExtensions";
import type { ObservationCoverageItem } from "../observationCoverage";
import { errorToString } from "../utils/format";
import { CodexPluginFeedback, CodexPluginList } from "./CodexPluginList";
import { ObservationState } from "./ObservationState";
import { EmptyState, Panel, PanelHead, SkeletonRows } from "./ui";

export function CodexMarketplacesPage({ workflow, coverage, onShowHooks, focusedPluginId }: {
  workflow: CodexExtensions;
  coverage: { marketplaces: ObservationCoverageItem; plugins: ObservationCoverageItem };
  onShowHooks?: () => void;
  focusedPluginId?: string;
}) {
  const { scan, scanning, current, error, result } = workflow.marketplaces;
  const { plugins } = workflow;
  const confirmation = workflow.operation?.kind === "marketplace" && workflow.operation.intent.operation !== "Add" ? workflow.operation : null;
  const pending = workflow.processing && workflow.operation?.kind === "marketplace";
  const pluginSaving = workflow.processing && workflow.operation?.kind === "plugin";
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sourceKind, setSourceKind] = useState<"git" | "local">("git");
  const [source, setSource] = useState("");
  const [refName, setRefName] = useState("");
  const [sparsePaths, setSparsePaths] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const readButton = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const formWasOpen = useRef(false);
  useEffect(() => {
    if (formWasOpen.current && !adding) addButton.current?.focus();
    formWasOpen.current = adding;
  }, [adding]);
  const reading = scanning || plugins.scanning;
  const busy = reading || workflow.processing || choosing;
  const blocked = busy || Boolean(workflow.operation);
  const disabled = blocked || Boolean(error || scan?.configError) || !current;
  const readError = error ?? (scan?.status !== "Ready" ? scan?.message : scan && !current && !scanning ? "市场清单已过期，请重新读取。" : null);
  const groups = new Map<string, CodexMarketplace | null>(scan?.marketplaces.map((market) => [market.name, market]));
  for (const plugin of plugins.scan?.plugins ?? []) {
    if (!groups.has(plugin.marketplaceName)) groups.set(plugin.marketplaceName, null);
  }
  const focusedMarket = plugins.scan?.plugins.find((plugin) => plugin.pluginId === focusedPluginId)?.marketplaceName;
  useEffect(() => { if (focusedMarket) setExpanded(focusedMarket); }, [focusedMarket, focusedPluginId]);
  const unmatchedLabel = scanning ? "正在核实市场信息"
    : readError || scan?.status !== "Ready" ? "市场信息未能核实" : "未出现在市场清单中";
  const resultTitle = result?.status === "Succeeded" ? "市场操作已完成"
    : result?.status === "AlreadyExists" ? "市场来源已存在"
      : result?.status === "Conflict" ? "来源已变化，请重新确认"
        : result?.status === "Partial" ? "市场操作部分完成" : "市场操作未能完成";

  function closeForm() {
    setAdding(false);
    setFormError(null);
  }

  async function requestChange(market: CodexMarketplace, operation: "Refresh" | "Remove", button: HTMLButtonElement) {
    if (disabled || market.readOnlyReason) return;
    trigger.current = button;
    setRequestError(await workflow.request({ kind: "marketplace", marketplaceId: market.id, operation }));
  }

  return (
    <section className="view-grid" aria-label="Codex 插件市场管理" aria-busy={busy}>
      <Panel>
        <PanelHead title="Codex 插件市场" action={
          <Button ref={readButton} disabled={blocked} onClick={() => void workflow.refresh()} size="sm" type="button" variant="outline">
            <ArrowClockwise aria-hidden="true" className={reading ? "motion-safe:animate-spin" : undefined} data-icon="inline-start" />
            {reading ? "读取中" : "重新读取"}
          </Button>
        } />
        <CardContent className="grid gap-3 p-4">
          <p className="text-sm">展开市场，浏览插件目录、查看详情并管理用户默认启用设置。</p>
          <dl className="meta-list">
            <div className="meta-row">
              <dt>Codex 目录</dt>
              <dd><code>{scan?.directory || plugins.scan?.directory || "尚未读取"}</code></dd>
            </div>
            <div className="meta-row">
              <dt>插件清单</dt>
              <dd><ObservationState item={coverage.plugins} variant="badge" /></dd>
            </div>
          </dl>
          <ObservationState item={coverage.marketplaces} showNote={false} variant="strip" />
          <p className="text-xs text-muted-foreground">
            仅维护当前用户配置中的来源；默认、受管理或归属不明的市场只供查看。插件设置作用于使用此目录的 Codex CLI 和桌面 App；项目设置可能覆盖用户默认值。
          </p>
          <p className="text-xs text-muted-foreground" role="status">
            {pending ? "正在执行并重新核对市场，请稍候…" : pluginSaving ? "正在执行并重新核对插件…" : reading ? "正在读取市场与插件目录，已有内容为上次结果。" : "重新读取查看本机市场与插件清单；同步市场会从 Git 来源同步内容。"}
          </p>
        </CardContent>
      </Panel>

      {result ? <Alert variant={result.status === "Failed" || result.status === "Partial" ? "destructive" : "default"} role="status">
        <AlertTitle>{resultTitle}</AlertTitle><AlertDescription>{result.message}</AlertDescription>
      </Alert> : null}
      {readError ? <Alert variant="destructive">
        <AlertTitle>{result?.status === "Succeeded" || result?.status === "AlreadyExists" ? "操作已完成，但清单读取失败"
          : scan?.status === "MissingCli" ? "需要 Codex CLI" : scan?.status === "Incompatible" ? "Codex CLI 版本不兼容" : "市场清单读取失败"}</AlertTitle>
        <AlertDescription>{readError}{scan?.marketplaces.length ? " 下方市场来源为上次结果，已过期，暂时不能维护来源。" : ""}</AlertDescription>
      </Alert> : null}
      {scan?.configError ? <Alert variant="destructive">
        <AlertTitle>市场来源暂时只读</AlertTitle><AlertDescription>{scan.configError} 解决后请重新读取。</AlertDescription>
      </Alert> : null}
      <CodexPluginFeedback {...plugins} />
      {requestError ? <p className="text-sm text-destructive" role="alert">{requestError}</p> : null}

      <Panel className="overflow-hidden">
        <PanelHead title="市场" action={
          <Button ref={addButton} disabled={disabled || adding || Boolean(confirmation)} onClick={() => { setAdding(true); setSource(""); setRefName(""); setSparsePaths(""); setFormError(null); }} size="sm" type="button">
            <Plus aria-hidden="true" data-icon="inline-start" />添加市场源
          </Button>
        } />
        {adding ? <form aria-label="添加市场源" className="grid gap-4 border-b p-4" onSubmit={async (event) => {
          event.preventDefault();
          if (disabled || !source.trim()) return;
          setFormError(null);
          const error = await workflow.request({ kind: "marketplace", operation: "Add", sourceKind, source: source.trim(),
            ...(sourceKind === "git" && refName.trim() ? { refName: refName.trim() } : {}),
            ...(sourceKind === "git" && sparsePaths.trim() ? { sparsePaths: sparsePaths.split("\n").map((path) => path.trim()).filter(Boolean) } : {}),
          });
          if (error) { setFormError(error); return; }
          // The form's explicit submit confirms the frozen source and options.
          const outcome = await workflow.confirm();
          if (outcome?.status === "Succeeded" || outcome?.status === "AlreadyExists") { setSource(""); closeForm(); }
        }}>
          <fieldset disabled={blocked} className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">来源类型</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(["git", "local"] as const).map((kind) => <label key={kind} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="marketplace-source-kind" value={kind} checked={sourceKind === kind} onChange={() => { setSourceKind(kind); setSource(""); setFormError(null); }} className="accent-primary" />
                {marketplaceSourceLabel(kind)}
              </label>)}
            </div>
          </fieldset>
          <div className="grid gap-2">
            <label htmlFor="marketplace-source" className="text-sm font-medium">{sourceKind === "git" ? "Git 仓库地址" : "市场根目录"}</label>
            <div className="flex flex-wrap gap-2">
              <Input id="marketplace-source" autoFocus className="min-w-0 flex-1 basis-64 font-mono" disabled={blocked} readOnly={sourceKind === "local"} value={source} onChange={(event) => setSource(event.target.value)} placeholder={sourceKind === "git" ? "owner/repo 或 Git URL" : "选择本地市场目录"} aria-describedby="marketplace-source-help" required />
              {sourceKind === "local" ? <Button disabled={blocked} type="button" variant="outline" onClick={async () => {
                setChoosing(true); setFormError(null);
                try { const path = await invoke<string | null>("choose_codex_marketplace_directory"); if (path) setSource(path); }
                catch (caught) { setFormError(errorToString(caught)); }
                finally { setChoosing(false); }
              }}><FolderOpen aria-hidden="true" data-icon="inline-start" />选择目录</Button> : null}
            </div>
            <p id="marketplace-source-help" className="text-xs text-muted-foreground">{sourceKind === "git" ? "支持仓库简写、HTTP(S) 和 SSH Git URL。私有仓库沿用本机 Git 认证，地址中请勿包含令牌。" : "选择包含 .agents/plugins/marketplace.json 或 .claude-plugin/marketplace.json 的目录。原始目录仍由你维护。"}</p>
            {formError ? <p className="text-sm text-destructive" role="alert">{formError}</p> : null}
          </div>
          {sourceKind === "git" ? <details className="text-sm">
            <summary className="cursor-pointer font-medium">Git 高级选项</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1"><label htmlFor="marketplace-ref">分支或标签（可选）</label><Input id="marketplace-ref" disabled={blocked} value={refName} onChange={(event) => setRefName(event.target.value)} placeholder="例如 main 或 v1.0" /></div>
              <div className="grid gap-1"><label htmlFor="marketplace-sparse">稀疏检出目录（每行一个，可选）</label><textarea id="marketplace-sparse" disabled={blocked} value={sparsePaths} onChange={(event) => setSparsePaths(event.target.value)} className="min-h-20 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" placeholder=".agents/plugins" /><p className="text-xs text-muted-foreground">使用仓库内相对路径，包含市场目录及所需插件目录。</p></div>
            </div>
          </details> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button disabled={blocked} onClick={closeForm} type="button" variant="outline">取消添加</Button>
            <Button disabled={disabled || !source.trim()} type="submit">{pending ? "正在添加…" : "确认添加"}</Button>
          </div>
        </form> : null}
        {!groups.size && reading ? <SkeletonRows label="正在读取市场与插件清单" /> : groups.size ? (
          <Table className="min-w-[700px] table-fixed">
            <TableHeader><TableRow>
              <TableHead className="w-[24%]">市场</TableHead><TableHead className="w-[13%]">类型</TableHead>
              <TableHead className="w-[36%]">来源</TableHead><TableHead className="w-[27%] text-right">操作</TableHead>
            </TableRow></TableHeader>
            <TableBody>{Array.from(groups, ([name, market], index) => {
              const open = expanded === name;
              const detailId = `codex-marketplace-detail-${index}`;
              return <Fragment key={name}>
                <TableRow>
                  <TableCell className="whitespace-normal align-top">
                    <button type="button" disabled={blocked} aria-label={`${open ? "收起" : "查看"} ${name} 的插件与详情`} aria-expanded={open} aria-controls={open ? detailId : undefined} className="w-full cursor-pointer break-all text-left font-medium text-primary underline-offset-4 hover:underline disabled:cursor-default disabled:opacity-50" onClick={() => setExpanded(open ? null : name)}>
                      {name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{open ? "收起插件与详情" : "查看插件与详情"}</span>
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top">{market ? marketplaceSourceLabel(market.sourceKind) : "未知"}</TableCell>
                  <TableCell className="whitespace-normal break-all align-top text-xs">{market ? <span className="font-mono">{market.source || "未提供来源信息"}</span> : unmatchedLabel}</TableCell>
                  <TableCell className="whitespace-normal align-top">
                    {!market ? <p className="text-xs text-muted-foreground">仅管理已安装插件</p> : market.readOnlyReason ? <p className="text-xs text-muted-foreground">{market.readOnlyReason}</p> : <div className="flex flex-wrap justify-end gap-1">
                      {market.sourceKind === "git" ? <Button aria-label={`同步市场 ${market.name}`} disabled={disabled} onClick={(event) => requestChange(market, "Refresh", event.currentTarget)} size="sm" type="button" variant="outline">同步市场</Button> : null}
                      <Button aria-label={`移除市场 ${market.name}`} disabled={disabled} onClick={(event) => requestChange(market, "Remove", event.currentTarget)} size="sm" type="button" variant="outline">移除</Button>
                    </div>}
                  </TableCell>
                </TableRow>
                {open ? <TableRow id={detailId}><TableCell className="whitespace-normal bg-muted/30" colSpan={4}>
                  <div className="grid gap-6 py-3">
                  <CodexPluginList workflow={workflow} focusedPluginId={focusedPluginId} onShowHooks={onShowHooks} marketplaceName={name} onRestoreFocus={() => readButton.current?.focus()} />
                  {market ? <div className="border-t pt-4"><dl className="grid gap-3 sm:grid-cols-2">
                    <MarketDetail label={market.sourceKind === "git" ? "市场本地副本" : "实际本地目录"} value={market.root} />
                    <MarketDetail label="用户配置路径" value={scan?.configPath ?? null} />
                    {market.refName ? <MarketDetail label="分支或标签" value={market.refName} /> : null}
                    {market.sparsePaths.length ? <MarketDetail label="稀疏检出目录" value={market.sparsePaths.join("\n")} /> : null}
                  </dl>
                  {market.sourceKind === "local" ? <p className="mt-3 text-xs text-muted-foreground">本地目录无需 Git 同步，修改后可重新读取清单。</p> : null}</div> : null}
                  </div>
                </TableCell></TableRow> : null}
              </Fragment>;
            })}</TableBody>
          </Table>
        ) : <EmptyState message={scan?.status === "Ready" && !error ? "当前没有可见的市场来源。添加 Git 仓库或本地市场目录以开始管理。" : readError ? "市场清单暂不可用，解决上方问题后请重新读取。" : "进入页面后读取市场来源。"} />}
      </Panel>

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && confirmation) workflow.cancel(confirmation.id); }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus(); else readButton.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.intent.operation === "Refresh" ? "确认同步市场" : "确认移除市场源"}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.intent.operation === "Refresh"
              ? "从 Git 来源同步市场。已配置插件可能一并安装或更新，即使已禁用；启用设置不会因此变为启用，请在新会话中验证。"
              : confirmation?.target?.sourceKind === "git"
                ? "移除市场来源及其本地副本。应用不会追加卸载插件、清理插件启用设置或删除原始 Git 仓库。"
                : "移除市场来源。应用不会追加卸载插件、清理插件启用设置或删除原始本地目录。"}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation ? <dl className="grid gap-3 text-sm">
            <MarketDetail label="市场" value={confirmation.target?.name ?? null} />
            <MarketDetail label="来源" value={confirmation.target?.source ?? null} />
            <MarketDetail label="Codex 目录" value={confirmation.directory} />
          </dl> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button disabled={pending} type="button" variant="outline">取消</Button></AlertDialogCancel>
            <AlertDialogAction asChild><Button disabled={pending} onClick={async (event) => {
              event.preventDefault(); if (!confirmation) return;
              await workflow.confirm(confirmation.id);
            }} type="button">{pending ? "正在执行…" : confirmation?.intent.operation === "Refresh" ? "确认同步" : "确认移除"}</Button></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function MarketDetail({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono text-xs">{value || "未知"}</dd></div>;
}
