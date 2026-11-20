import { ContextMenu } from "radix-ui";
import { DiskRemovalButton } from "./DiskRemovalPanel";
import { memo, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { TooltipComponent, type TooltipComponentOption } from "echarts/components";
import { TreemapChart, type TreemapSeriesOption } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import { Copy } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "./ui";
import { diskScanGroupLabels, diskScanKindLabels, diskScanPhaseLabels, diskScanSize, diskScanStatusLabels, type DiskScanChart, type DiskScanGroup } from "../diskScan";
import type { DiskScanWorkflow } from "../diskScanWorkflow";
import { formatBytes } from "../utils/format";

echarts.use([TooltipComponent, TreemapChart, CanvasRenderer]);
type ChartOption = echarts.ComposeOption<TreemapSeriesOption | TooltipComponentOption>;
const OTHER_ID = "other";
const lightColors = ["#a5c8bd", "#bed8cd", "#8bb6aa", "#d4e4d9", "#98c0b2", "#c5dbd1"];
const darkColors = ["#365e50", "#416c5d", "#305448", "#456c5b", "#3e6557", "#476f61"];

function chartOption(chart: DiskScanChart, dark: boolean, fontFamily: string): ChartOption {
  const colors = dark ? darkColors : lightColors;
  const ink = dark ? "#f4f7f4" : "#15362c";
  const border = dark ? "#25272c" : "#faf9f4";
  const entries = new Map(chart.entries.map((entry) => [String(entry.id), entry]));
  const otherSize = `${chart.other.partial ? "≥ " : ""}${formatBytes(chart.other.bytes)}`;
  return {
    animation: false,
    textStyle: { fontFamily },
    tooltip: {
      trigger: "item", confine: true, renderMode: "html", borderWidth: 0,
      backgroundColor: dark ? "#25272c" : "#faf9f4", textStyle: { color: dark ? "#f4f7f4" : "#20242a", fontFamily, fontSize: 13 },
      // Paths and file names are untrusted filesystem text, never HTML.
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        const data = item.data as { id?: string } | undefined;
        const entry = entries.get(data?.id ?? "");
        const element = document.createElement("div");
        element.className = "disk-scan-chart-tooltip";
        element.textContent = entry
          ? `${entry.name}\n${entry.path}\n${diskScanKindLabels[entry.kind]} · ${diskScanSize(entry)} · ${diskScanStatusLabels[entry.status]}${entry.message ? `\n${entry.message}` : ""}`
          : `其他 ${chart.other.count.toLocaleString("zh-CN")} 项\n面积权重合计 ${otherSize}\n各条目占用可能重叠；点击查看对应列表。`;
        return element;
      },
    },
    series: [{
      type: "treemap", id: "disk-footprints", name: "同层条目占用",
      left: 0, top: 0, right: 0, bottom: 0,
      roam: false, nodeClick: false, breadcrumb: { show: false },
      visibleMin: 0, sort: false, animation: false,
      label: {
        show: true, position: "insideTopLeft", padding: [10, 10], color: ink, fontSize: 13, lineHeight: 21,
        overflow: "truncate",
        formatter(params) {
          const entry = entries.get((params.data as { id: string }).id);
          return entry ? `${entry.name}${entry.kind === "directory" ? "/" : ""}\n${diskScanSize(entry)}` : `其他 ${chart.other.count.toLocaleString("zh-CN")} 项\n${otherSize}`;
        },
      },
      upperLabel: { show: false },
      itemStyle: { borderColor: border, borderWidth: 2, gapWidth: 2 },
      emphasis: { itemStyle: { borderColor: ink, borderWidth: 2 }, label: { color: ink } },
      data: [
        ...chart.entries.map((entry) => ({
          id: String(entry.id), name: entry.name, value: entry.bytes!,
          itemStyle: { color: colors[entry.id % colors.length] },
        })),
        ...(chart.other.count ? [{ id: OTHER_ID, name: `其他 ${chart.other.count} 项`, value: chart.other.bytes,
          itemStyle: { color: dark ? "#4d5351" : "#d9ded9" } }] : []),
      ],
    }],
  };
}

const TreemapCanvas = memo(function TreemapCanvas({ chart, onActivate, onContext }: { chart: DiskScanChart; onActivate: (id: string) => void; onContext: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.EChartsType | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const activate = useEffectEvent(onActivate);
  const context = useEffectEvent(onContext);
  const draw = useEffectEvent(() => {
    if (!instance.current || !host.current) return;
    instance.current.setOption(chartOption(chart, document.documentElement.dataset.theme === "dark", getComputedStyle(host.current).fontFamily), { notMerge: true });
  });
  useEffect(() => {
    if (!host.current) return;
    try { instance.current = echarts.init(host.current, undefined, { renderer: "canvas" }); }
    catch { setFailure("图表暂时无法显示，请切换到列表查看本轮记录。"); return; }
    const canvas = instance.current;
    canvas.on("click", (event) => {
      const id = (event.data as { id?: string } | undefined)?.id;
      if (id !== undefined) activate(id);
    });
    canvas.on("contextmenu", (event) => {
      const id = (event.data as { id?: string } | undefined)?.id;
      if (id !== undefined) context(id);
    });
    const resize = new ResizeObserver(() => canvas.resize());
    resize.observe(host.current);
    const theme = new MutationObserver(() => draw());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let disposed = false;
    void document.fonts?.ready.then(() => { if (!disposed) draw(); });
    return () => { disposed = true; resize.disconnect(); theme.disconnect(); canvas.dispose(); instance.current = null; };
  }, []);
  useEffect(() => { draw(); }, [chart]);
  return failure ? <p role="alert">{failure}</p> : <div ref={host} className="disk-scan-treemap-canvas" role="img"
    aria-label={`当前目录 ${chart.total.toLocaleString("zh-CN")} 个已发现条目的占用矩形树图。面积表示同层相对大小，可切换列表使用键盘浏览。`} />;
});

export default function DiskScanTreemap({ chart, pending, workflow, onCopy, disabled }: {
  chart: DiskScanChart; pending: boolean; disabled?: boolean; workflow: DiskScanWorkflow; onCopy: (path: string) => Promise<void>;
}) {
  const [contextId, setContextId] = useState<string | null>(null);
  const contextEntry = chart.entries.find((entry) => String(entry.id) === contextId);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const hovering = useRef(false);
  const focusing = useRef(false);
  const selected = chart.entries.find((entry) => entry.id === selectedId);
  const activate = useCallback((id: string) => {
    if (disabled) return;
    if (id === OTHER_ID) { workflow.showGroup("other"); return; }
    const entry = chart.entries.find((candidate) => String(candidate.id) === id);
    if (entry?.kind === "directory") workflow.enter(entry.id);
    else if (entry) setSelectedId(entry.id);
  }, [chart, workflow, disabled]);
  return <section className="disk-scan-chart" aria-label="矩形树图结果"
    onPointerEnter={(event) => { if (event.pointerType !== "touch") { hovering.current = true; workflow.setChartPaused(true); } }}
    onPointerLeave={() => { hovering.current = false; workflow.setChartPaused(focusing.current); }}
    onPointerDown={(event) => {
      focusing.current = false;
      if (event.pointerType === "touch") workflow.setChartPaused(true);
    }}
    onPointerUp={(event) => { if (event.pointerType === "touch") workflow.setChartPaused(false); }}
    onPointerCancel={() => { hovering.current = false; workflow.setChartPaused(focusing.current); }}
    onFocus={(event) => {
      focusing.current = event.target.matches(":focus-visible");
      workflow.setChartPaused(focusing.current || hovering.current);
    }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { focusing.current = false; workflow.setChartPaused(hovering.current); } }}>
    <div className="disk-scan-chart-caption">
      <p>面积比较同层条目的占用大小</p>
      <span role="status">{pending ? "有新结果待显示" : diskScanPhaseLabels[chart.phase]}</span>
    </div>
    {chart.entries.length ? <ContextMenu.Root onOpenChange={(open) => { if (!open) setContextId(null); }}>
      <ContextMenu.Trigger asChild disabled={disabled}><div onContextMenuCapture={() => setContextId(null)}><TreemapCanvas chart={chart} onActivate={activate} onContext={setContextId} /></div></ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Content className="disk-removal-context" collisionPadding={12}>
        <ContextMenu.Item disabled={!contextEntry || !workflow.canRemove(contextEntry)} onSelect={() => { if (contextEntry) void workflow.prepareRemoval([contextEntry.id]); }}>移到废纸篓</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => workflow.setMode("list")}>到列表选择</ContextMenu.Item>
      </ContextMenu.Content></ContextMenu.Portal>
    </ContextMenu.Root> : <EmptyState message={
      chart.total === 0 && chart.directory.status === "complete" ? "此目录为空。" : chart.phase === "running"
        ? "尚未统计出可绘制的占用，扫描结果会逐步显示。" : "当前没有可绘制的正占用；零占用、未统计出占用及未计入条目可在列表中查看。"
    } />}
    <div className="disk-scan-chart-footer">
      <span>当前层 {chart.total.toLocaleString("zh-CN")} 项 · 单独展示 {chart.entries.length.toLocaleString("zh-CN")} 项</span>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => workflow.showGroup("all")}>查看全部列表</Button>
    </div>
    <div className="disk-scan-chart-groups" role="group" aria-label="分组查看">
      {chart.other.count > 0 && <button type="button" disabled={disabled} onClick={() => workflow.showGroup("other")}>其他 <strong>{chart.other.count.toLocaleString("zh-CN")}</strong> 项</button>}
      {(["unmeasured", "zero", "excluded"] as const).map((group: Exclude<DiskScanGroup, "all" | "other">) => <button type="button" key={group}
        disabled={disabled || !chart.counts[group]} onClick={() => workflow.showGroup(group)}>{diskScanGroupLabels[group]} <strong>{chart.counts[group].toLocaleString("zh-CN")}</strong></button>)}
    </div>
    {selected ? <div className="disk-scan-chart-detail" role="group" aria-label="选中文件详情">
      <div><strong>{selected.name}</strong><p className="disk-scan-detail-path">{selected.path}</p>
        <p>{diskScanKindLabels[selected.kind]} · {diskScanSize(selected)} · {diskScanStatusLabels[selected.status]}{selected.message ? ` · ${selected.message}` : ""}</p></div>
      <DiskRemovalButton entry={selected} workflow={workflow} />
      <Button type="button" variant="outline" size="sm" aria-label={`复制路径：${selected.name}`} onClick={() => void onCopy(selected.path)}><Copy aria-hidden="true" />复制路径</Button>
    </div> : <p className="disk-scan-chart-help">点击目录进入下一层，点击文件查看详情。较小条目可通过列表查看。</p>}
  </section>;
}
