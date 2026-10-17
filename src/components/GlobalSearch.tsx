import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { managerLabels, packageKindLabels } from "../constants";
import { searchManagers, type SearchTarget } from "../globalSearch";
import type { ManagerId, ManagerSnapshot, PackageKind } from "../types";
import type { ManagerScanState } from "../managerScanning";
import { formatHomePath } from "../utils/format";

export function GlobalSearch({ managers, snapshots, scanStates, homeDirectory, busy, onRefresh, onLocate }: {
  managers: ManagerId[];
  snapshots: Partial<Record<ManagerId, ManagerSnapshot>>;
  scanStates: Partial<Record<ManagerId, ManagerScanState>>;
  homeDirectory: string | null;
  busy: boolean;
  onRefresh: () => void;
  onLocate: (target: SearchTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [active, setActive] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const navigating = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchManagers(managers, snapshots, query), [managers, snapshots, query]);
  const visible = results.slice(0, limit);
  const selected = Math.min(active, Math.max(0, visible.length - 1));
  const scanned = managers.filter((id) => snapshots[id]);
  const incomplete = managers.filter((id) => scanStates[id]?.error || ["Partial", "Failed", "Missing"].includes(snapshots[id]?.status ?? ""));
  function show() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigating.current = false;
    setQuery(""); setLimit(50); setActive(0); setOpen(true);
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.isComposing && !event.repeat) {
        if (!open && document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        if (open) setOpen(false); else show();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-result-index="${selected}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  function choose(target: SearchTarget) { navigating.current = true; setOpen(false); onLocate(target); }
  return <>
    <Button variant="outline" size="sm" onClick={show} aria-label="跨管理器搜索" type="button"><MagnifyingGlass aria-hidden="true" />搜索<span className="ml-2 text-xs text-muted-foreground">⌘K</span></Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl gap-3" onCloseAutoFocus={(event) => { event.preventDefault(); if (!navigating.current) opener.current?.focus(); }}>
        <DialogTitle>跨管理器搜索</DialogTitle>
        <DialogDescription>搜索已读取的包、运行时、资源和目录，定位到所属管理器。</DialogDescription>
        <Input aria-label="搜索名称、版本或路径" placeholder="输入名称、版本或路径…" value={query}
          role="combobox" aria-autocomplete="list" aria-expanded={true} aria-controls="manager-search-results"
          aria-activedescendant={visible.length ? `manager-search-result-${selected}` : undefined}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setLimit(50); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setActive(Math.max(0, Math.min(visible.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter" && visible[selected]) { event.preventDefault(); choose(visible[selected]); }
          }} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span role="status">已读取 {scanned.length}/{managers.length} 个管理器 · {results.length} 个结果{incomplete.length ? ` · ${incomplete.length} 个管理器存在缺失或读取异常` : ""}</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>扫描全部已启用管理器</Button>
        </div>
        <div id="manager-search-results" role="listbox" aria-label="搜索结果" ref={list} className="max-h-[45vh] overflow-y-auto overscroll-contain rounded-lg border">
          {!visible.length ? <p className="p-5 text-sm text-muted-foreground">{query.trim() ? "没有匹配结果；尚未读取的管理器不会出现在结果中。" : "输入关键词开始搜索。"}</p> : visible.map((result, index) => <button
            key={`${result.key}:${index}`} id={`manager-search-result-${index}`} data-result-index={index} type="button" role="option" aria-selected={selected === index} tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(result)}
            className={`flex w-full flex-col gap-1 border-b p-3 text-left last:border-b-0 ${selected === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
            <span className="flex flex-wrap items-baseline justify-between gap-2"><strong className="break-all text-sm">{result.name}</strong><span className="text-xs text-muted-foreground">{managerLabels[result.managerId]} · {result.kind === "path" ? "目录" : result.managerId === "Nvm" ? "Node 版本" : packageKindLabels[result.objectKind as PackageKind] ?? "包"}</span></span>
            {result.version ? <span className="break-all text-xs">{result.version}</span> : null}
            {result.path ? <code className="break-all text-xs text-muted-foreground">{formatHomePath(result.path, homeDirectory)}</code> : null}
            <span className="text-xs text-muted-foreground">{scanStates[result.managerId]?.scannedAt ? new Date(scanStates[result.managerId]!.scannedAt!).toLocaleString() : "观察时间未知"}{scanStates[result.managerId]?.error ? " · 最近扫描有异常" : ""}</span>
          </button>)}
        </div>
        {results.length > limit ? <Button variant="outline" onClick={() => setLimit(limit + 50)}>继续加载（已显示 {limit}/{results.length}）</Button> : null}
      </DialogContent>
    </Dialog>
  </>;
}
