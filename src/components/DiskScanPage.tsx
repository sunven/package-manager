import { useEffect } from "react";
import { ArrowUp, CaretRight, Copy, File, Folder, FolderOpen, Link, HardDrives, Square } from "@phosphor-icons/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { EmptyState, Notice, Panel } from "./ui";
import { diskScanKindLabels, diskScanPhaseLabels, diskScanStatusLabels, type DiskScanEntry, type DiskScanView } from "../diskScan";
import type { DiskScanWorkflow } from "../diskScanWorkflow";
import { formatBytes, errorToString } from "../utils/format";
import "../diskScan.css";

function size(entry: DiskScanEntry) {
  if (entry.status === "excluded") return "未计入";
  if (entry.bytes === null) return "—";
  return `${entry.status === "complete" ? "" : "≥ "}${formatBytes(entry.bytes)}`;
}

async function copyPath(path: string) {
  try { await writeText(path); toast.success("路径已复制"); }
  catch (error) { toast.error(`复制失败：${errorToString(error)}`); }
}

export function DiskScanPage({ view, workflow }: { view: DiskScanView; workflow: DiskScanWorkflow }) {
  const { summary, page } = view;
  const running = summary?.phase === "running";
  useEffect(() => { workflow.setVisible(true); return () => workflow.setVisible(false); }, [workflow]);
  const parent = page?.ancestors[page.ancestors.length - 1];
  return (
    <main className="view-grid disk-scan-page">
      <header className="disk-scan-title">
        <h1>磁盘扫描</h1>
        <p>从一个目录开始，逐层查看文件和子目录的占用。</p>
      </header>
      <Panel className="disk-scan-controls">
        <form onSubmit={(event) => { event.preventDefault(); void workflow.start(); }}>
          <label htmlFor="disk-scan-path">扫描目录</label>
          <div className="disk-scan-inputs">
            <Input id="disk-scan-path" value={view.draftPath} onChange={(event) => workflow.setPath(event.target.value)} placeholder="/Users/… 或 ~/…" autoComplete="off" spellCheck={false} />
            <Button type="button" variant="outline" disabled={view.picking} onClick={() => void workflow.choose()}><FolderOpen aria-hidden="true" />{view.picking ? "选择中…" : "选择目录"}</Button>
            <Button type="submit" disabled={!view.loaded || !view.draftPath || view.starting}>{view.starting ? "检查目录…" : summary ? "重新扫描" : "开始扫描"}</Button>
            {running && <Button type="button" variant="outline" disabled={view.stopping || view.starting} onClick={() => void workflow.stop()}><Square aria-hidden="true" />{view.stopping ? "正在停止…" : "停止扫描"}</Button>}
          </div>
          <p className="disk-scan-hint">只读扫描，包含隐藏文件和目录。</p>
        </form>
      </Panel>
      {view.error && <Notice title="无法完成操作" message={view.error} />}
      {(summary?.warning ?? view.warning) && <Notice title="路径记忆提示" message={(summary?.warning ?? view.warning)!} />}
      {summary ? <>
        <section className="disk-scan-summary" aria-label="本轮扫描记录">
          <div className="disk-scan-record">
            <strong>本轮扫描记录</strong>
            <span role="status">{diskScanPhaseLabels[summary.phase]}</span>
            <time dateTime={new Date(summary.startedAt).toISOString()}>{new Date(summary.startedAt).toLocaleString("zh-CN", { hour12: false })}</time>
          </div>
          <p className="disk-scan-root" title={summary.rootPath}>{summary.rootPath}</p>
          <dl className="disk-scan-metrics">
            <div><dt>已统计占用</dt><dd>{summary.bytes === null ? "—" : `${summary.phase === "completed" ? "" : "≥ "}${formatBytes(summary.bytes)}`}</dd></div>
            <div><dt>已扫描条目</dt><dd>{summary.entries.toLocaleString("zh-CN")}</dd></div>
            <div><dt>耗时</dt><dd>{(summary.elapsedMs / 1000).toFixed(1)} 秒</dd></div>
          </dl>
          {summary.message && <p className="disk-scan-diagnostic" role="status">{summary.message}</p>}
          {(summary.errors > 0 || summary.excluded > 0) && <p className="disk-scan-hint">{summary.errors > 0 && `${summary.errors.toLocaleString("zh-CN")} 处读取问题 · `}{summary.excluded.toLocaleString("zh-CN")} 个主动排除条目（链接、其他磁盘或特殊条目）</p>}
        </section>
        <Panel className="disk-scan-browser">
          <div className="disk-scan-browser-head">
            <Button type="button" size="sm" variant="outline" disabled={!parent} onClick={() => parent && workflow.enter(parent.id)}><ArrowUp aria-hidden="true" />上一级</Button>
            <nav aria-label="目录路径" className="disk-scan-breadcrumbs">
              {page ? <>
                {page.ancestors.map((entry) => <span key={entry.id}><button type="button" onClick={() => workflow.enter(entry.id)} title={entry.path}>{entry.name}</button><CaretRight aria-hidden="true" /></span>)}
                <span aria-current="location" title={page.directory.path}>{page.directory.name}</span>
              </> : <span>读取目录记录…</span>}
            </nav>
            {page && <span className="disk-scan-directory-size">{size(page.directory)}</span>}
          </div>
          {page ? <>
            {page.directory.message && <p className="disk-scan-directory-note">{page.directory.message}</p>}
            {page.entries.length ? <table className="disk-scan-table" aria-label="目录内容">
              <thead><tr><th scope="col">名称</th><th scope="col">类型</th><th scope="col">占用空间</th><th scope="col">读取状态</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{page.entries.map((entry) => {
                const Icon = entry.kind === "directory" ? Folder : entry.kind === "symlink" ? Link : entry.kind === "mount" ? HardDrives : File;
                return <tr key={entry.id}>
                  <td className="disk-scan-name"><div><Icon aria-hidden="true" />{entry.kind === "directory" ? <button type="button" title={entry.path} onClick={() => workflow.enter(entry.id)}>{entry.name}<CaretRight aria-hidden="true" /></button> : <span title={entry.path}>{entry.name}</span>}</div></td>
                  <td className="disk-scan-type">{diskScanKindLabels[entry.kind]}</td>
                  <td className="disk-scan-size">{size(entry)}</td>
                  <td className="disk-scan-status" title={entry.message ?? undefined}><span>{diskScanStatusLabels[entry.status]}</span>{entry.message && <small>{entry.message}</small>}</td>
                  <td className="disk-scan-copy"><Button type="button" size="icon" variant="ghost" aria-label={`复制路径：${entry.name}`} title="复制路径" onClick={() => void copyPath(entry.path)}><Copy aria-hidden="true" /></Button></td>
                </tr>;
              })}</tbody>
            </table> : <EmptyState message={page.directory.status === "complete" ? "此目录为空。" : page.directory.status === "partial" ? "此目录尚无可展示的条目，读取结果不完整。" : "此目录尚在扫描，已发现的条目会逐步显示。"} />}
            <div className="disk-scan-list-footer">
              <span>已显示 {page.entries.length.toLocaleString("zh-CN")} / {page.total.toLocaleString("zh-CN")} 个已发现条目</span>
              {page.entries.length < page.total && <Button type="button" size="sm" variant="outline" disabled={view.loading} onClick={workflow.loadMore}>继续显示 200 条</Button>}
            </div>
          </> : view.error ? <Button type="button" variant="outline" onClick={() => void workflow.refreshPage()}>重试读取目录记录</Button> : <EmptyState message="正在读取本轮目录记录…" />}
        </Panel>
        <p className="disk-scan-hint">每个目录独立去重硬链接，子项占用之和可能大于父目录。占用不等于可释放空间。磁盘内容变化后请重新扫描。</p>
      </> : <Panel><EmptyState message={view.lastPath ? "已恢复上次路径。点击开始扫描，读取本轮目录占用。" : "选择或输入一个目录，开始查看其中的占用。"} /></Panel>}
    </main>
  );
}
