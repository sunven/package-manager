import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import type { MavenUnusedWorkflow } from "../hooks/useMavenUnused";
import type { ProjectCleanupPreset } from "../types";
import { formatHomePath } from "../utils/format";

export function MavenUnusedPanel({ workflow, homeDirectory, presets, disabled, onRemoved }: {
  workflow: MavenUnusedWorkflow;
  homeDirectory: string | null;
  presets: ProjectCleanupPreset[];
  disabled: boolean;
  onRemoved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();
  const { scan, selected, busy, phase, roots } = workflow;
  const candidates = useMemo(() => scan?.candidates.filter((candidate) =>
    `${candidate.coordinate} ${candidate.version}`.toLowerCase().includes(deferredQuery)) ?? [],
  [scan, deferredQuery]);
  const selection = scan?.candidates.filter((candidate) => selected.has(candidate.id)) ?? [];
  const selectedBytes = selection.reduce((total, candidate) => total + candidate.bytes, 0);
  const visibleSelected = candidates.filter((candidate) => selected.has(candidate.id)).length;
  const clearVisible = visibleSelected > 0 && (visibleSelected === candidates.length || selected.size >= 200);
  const locked = busy || disabled;

  return <section className="min-w-0 border-t" data-ui="maven-unused" aria-labelledby="maven-unused-title">
    <div className="grid gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="maven-unused-title" className="text-sm font-medium">Maven 未引用构件</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={locked || roots.length >= 20} onClick={() => void workflow.chooseRoot()}>添加项目目录</Button>
          <Button variant="outline" size="sm" disabled={locked || !roots.length} onClick={() => void workflow.refresh()}>
            {phase === "scanning" ? "正在检查引用…" : "检查引用"}
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        检查所选目录及子目录的 POM 引用。被引用的构件保留所有版本，本地安装、来源不明和插件构件保留。
        此范围不包含其他项目，也无法覆盖插件动态加载的构件。
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        自动发现跳过 Git、构建产物、依赖、Flutter SDK 和代理工具目录；POM 显式声明的模块仍会检查。
      </p>
      <label className="flex items-start gap-2 text-xs leading-relaxed">
        <Checkbox checked={workflow.referenceMode === "available"} disabled={locked}
          onCheckedChange={(checked) => workflow.changeReferenceMode(checked === true ? "available" : "complete")} />
        <span>仅检查本地已有 POM<span className="block text-muted-foreground">允许缺失尚未下载的引用模型；无法完整确认传递依赖。切换后需要重新检查引用。</span></span>
      </label>
      {presets.some((preset) => !roots.includes(preset.path)) ? <label className="flex flex-wrap items-center gap-2 text-xs">
        使用项目清理目录
        <select className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2" value="" disabled={locked || roots.length >= 20}
          onChange={(event) => { if (event.target.value) workflow.changeRoots([...roots, event.target.value]); }}>
          <option value="">选择已保存目录</option>
          {presets.filter((preset) => !roots.includes(preset.path)).map((preset) =>
            <option key={preset.id} value={preset.path}>{formatHomePath(preset.path, homeDirectory)}</option>)}
        </select>
      </label> : null}
      {roots.length ? <ul className="grid gap-1">
        {roots.map((root) => <li key={root} className="flex min-w-0 items-center justify-between gap-2 text-xs">
          <span className="break-all">{formatHomePath(root, homeDirectory)}</span>
          <Button size="sm" variant="ghost" disabled={locked} aria-label={`移除扫描目录 ${root}`}
            onClick={() => workflow.changeRoots(roots.filter((path) => path !== root))}>移除</Button>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">添加需要保护依赖的 Maven 项目目录，再检查引用。</p>}
      {workflow.error ? <Alert variant="destructive"><AlertTitle>引用检查或清理未完成</AlertTitle><AlertDescription>{workflow.error}</AlertDescription></Alert> : null}
      {phase === "scanning" || phase === "removing" ? <p role="status" className="text-sm">
        {phase === "scanning" ? "正在读取项目与本地仓库的 POM…" : "正在重新核对引用并移入废纸篓…"}
      </p> : null}
      {workflow.outcome ? <div role="status" className="grid gap-1 text-sm">
        <p>已移入废纸篓 {workflow.outcome.moved} 个 · 跳过 {workflow.outcome.skipped} 个 · 失败 {workflow.outcome.failed} 个</p>
        <p className="text-xs text-muted-foreground">清空废纸篓后才释放空间。继续清理前请重新检查引用。</p>
        {workflow.outcome.historyWarning ? <p className="break-all text-xs text-muted-foreground">维护历史未保存：{workflow.outcome.historyWarning}</p> : null}
        {workflow.outcome.items.filter((item) => item.message).map((item) => <p key={item.id} className="break-all text-xs text-muted-foreground">{item.id}：{item.message}</p>)}
      </div> : null}
      {scan ? <>
        <p className="break-all text-xs text-muted-foreground">本地仓库：{formatHomePath(scan.repository, homeDirectory)}</p>
        <p className="text-xs text-muted-foreground">检查于 {new Date(scan.scannedAt).toLocaleString()}</p>
        <p className="text-sm tabular-nums">发现 {scan.projects} 个项目 · {scan.versions} 个构件版本 · 引用保护 {scan.protectedVersions} 个 · 来源保护 {scan.excludedVersions} 个</p>
        {scan.referenceMode === "available" ? <Alert><AlertTitle>检查范围：本地已有 POM</AlertTitle><AlertDescription>
          <p>有 {scan.missingModels.length} 个引用模型未在本地找到。候选只表示已读取的 POM 中未发现引用，缺失模型的传递依赖仍可能需要它们。</p>
          {scan.missingModels.length ? <details className="mt-2"><summary className="cursor-pointer">查看缺失模型</summary><ul className="mt-2 grid max-h-40 gap-1 overflow-auto">{scan.missingModels.map((model) => <li className="break-all" key={model}>{model}</li>)}</ul></details> : null}
        </AlertDescription></Alert> : null}
        {scan.blockers.length ? <Alert><AlertTitle>引用分析不完整，暂不可清理</AlertTitle><AlertDescription>
          <ul className="grid max-h-40 gap-1 overflow-auto">{scan.blockers.map((message) => <li key={message} className="break-all">{message}</li>)}</ul>
        </AlertDescription></Alert> : <>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="min-w-36 flex-1" type="search" aria-label="搜索 Maven 未引用构件" placeholder="搜索构件或版本" value={query} onChange={(event) => setQuery(event.target.value)} />
            <span className="text-xs tabular-nums text-muted-foreground">{candidates.length} / {scan.candidates.length} 个版本</span>
            <Button size="sm" variant="outline" disabled={locked || !candidates.length || !clearVisible && selected.size >= 200}
              onClick={() => workflow.selectMany(candidates.map((candidate) => candidate.id), !clearVisible)}>
              {clearVisible ? deferredQuery ? "取消当前选择" : "取消全选" : deferredQuery ? "全选当前结果" : "全选"}
            </Button>
            <Button size="sm" variant="outline" disabled={locked || !selection.length} onClick={() => setConfirming(true)}>清理所选 {selection.length} 个</Button>
          </div>
          {scan.candidates.length > 200 ? <p className="text-xs text-muted-foreground">每批最多选择 200 个版本，全选会优先选择当前结果中靠前的构件。</p> : null}
          {scan.candidates.length ? <div className="max-h-96 overflow-auto">
            <Table><TableHeader><TableRow><TableHead className="w-10">选择</TableHead><TableHead>构件与版本</TableHead><TableHead className="text-right">目录占用</TableHead></TableRow></TableHeader>
              <TableBody>{candidates.map((candidate) => <TableRow key={candidate.id}>
                <TableCell><Checkbox aria-label={`选择 ${candidate.coordinate}:${candidate.version}`} checked={selected.has(candidate.id)}
                  disabled={locked || selected.size >= 200 && !selected.has(candidate.id)} onCheckedChange={() => workflow.toggle(candidate.id)} /></TableCell>
                <TableCell className="whitespace-normal"><span className="break-all text-sm">{candidate.coordinate}</span><p className="text-xs text-muted-foreground">{candidate.version}</p></TableCell>
                <TableCell className="text-right tabular-nums">{bytesLabel(candidate.bytes)}</TableCell>
              </TableRow>)}</TableBody></Table>
            {!candidates.length ? <p className="p-3 text-sm text-muted-foreground">没有匹配的构件，请调整搜索词。</p> : null}
          </div> : <p className="text-sm text-muted-foreground">扫描范围内没有可清理的未引用构件。</p>}
        </>}
      </> : null}
    </div>
    <AlertDialog open={confirming && Boolean(scan)} onOpenChange={(open) => { if (!busy) setConfirming(open); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>清理 {selection.length} 个 Maven 构件版本？</AlertDialogTitle>
          <AlertDialogDescription>目录占用共 {bytesLabel(selectedBytes)}。这些构件未在所选目录的 POM 引用中发现，其他项目或动态加载仍可能使用它们。构件将移入废纸篓，清空前可恢复；以后构建可能重新下载。</AlertDialogDescription>
          {scan?.referenceMode === "available" ? <p className="text-sm text-muted-foreground">本次仅检查本地已有 POM，有 {scan.missingModels.length} 个缺失模型，无法完整确认传递依赖。缺失模型也可能引用所选构件。</p> : null}
        </AlertDialogHeader>
        <ul className="grid max-h-48 gap-1 overflow-auto text-xs">{selection.map((candidate) => <li key={candidate.id} className="break-all">{candidate.coordinate}:{candidate.version}</li>)}</ul>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <Button disabled={locked || !selection.length} onClick={async () => {
            setConfirming(false);
            if (await workflow.remove()) onRemoved();
          }}>移入废纸篓</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(1)} ${units[index]}`;
}
