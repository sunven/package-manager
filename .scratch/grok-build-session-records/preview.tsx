import React from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { SessionRecordsPage } from "../../src/components/SessionRecordsPage";
import { useSessionRecords } from "../../src/hooks/useSessionRecords";
import { useOpenCodeSessions } from "../../src/hooks/useOpenCodeSessions";
import "../../src/styles.css";
const mode = new URLSearchParams(location.search).get("mode") ?? "ready";
const now = Date.now();
const rows = [
  ["1", "修复工作区路径识别与会话恢复", 1, "/Users/example/Projects/devscope", 217088, null],
  ["2", "梳理跨项目的缓存测量边界", 15, "/Users/example/Projects/package-manager", 821760, null],
  ["3", "实现工具栏搜索与年月分组", 45, "/Users/example/Projects/design-system", 13172736, null],
  ["4", "归档项目的恢复方案", null, null, 0, "原工作目录未记录或已不存在，无法继续会话。"],
].map(([id,title,age,cwd,bytes,error]) => ({id: `project/019a1b24-1122-7333-8444-${String(id).padStart(12,"0")}`, title, lastActivityMs:age === null ? null : now - Number(age)*86400000, workingDirectory:cwd, bytes, inUse:false, grok:{sessionId:`019a1b24-1122-7333-8444-${String(id).padStart(12,"0")}`,bytesComplete:age !== null,resumeError:error,parentSessionId:null,relatedSessionIds:id === "2" ? ["019a1b24-1122-7333-8444-000000000003"] : [],relationsComplete:true}}));
let scan = {directory:"/Users/example/.grok/sessions",status:mode === "partial" ? "Partial" : "Ready",message:mode === "partial" ? "1 处记录未能完整读取；无法确认身份的目录不能移除。" : null,records:mode === "empty" ? [] : rows,removalBlockedReason:mode === "running" ? "Grok Build 或其会话宿主仍在运行，请退出后刷新再移除。" : mode === "unknown" ? "无法可靠检查 Grok Build 是否已退出，暂不能移除；请退出 Grok Build 后刷新。" : null};
const empty = {directory:"",status:"Missing",message:null,records:[]};
(window as any).calls = [];
mockIPC((cmd,payload:any) => {
  (window as any).calls.push({cmd,payload});
  if(cmd === "scan_session_records") return {codex:empty,claude:empty,grok:scan};
  if(cmd === "scan_session_source") return scan;
  if(cmd === "open_grok_session") { scan = {...scan,removalBlockedReason:"Grok Build 或其会话宿主仍在运行，请退出后刷新再移除。"}; return null; }
  if(cmd === "record_observation") return {warning:null};
  if(cmd === "scan_opencode_sessions") return {status:"unavailable",records:[],message:"验证页面没有连接 OpenCode 服务",activeSessionIds:null};
  if(cmd.startsWith("remove_session_record")) throw new Error("合成数据预览只验证确认与取消，不执行真实移除。");
  return null;
});
function Preview() {
 const records = useSessionRecords(true); const openCode = useOpenCodeSessions(false);
 const previewRecords = mode === "results" ? {...records, outcome: {
   source: "grok" as const,
   result: {moved: 3, skipped: 0, failed: 0, operationError: null, message: null,
     items: ["/Users/example/Desktop/项目 100%", "/Users/example/github/package-manager", "/Users/example/Work/code/workspace"]
       .map((cwd, index) => ({id: `${encodeURIComponent(cwd)}/019a1b24-1122-7333-8444-${String(index + 1).padStart(12,"0")}`, status: "Moved" as const, reason: null, message: null}))},
   refresh: {status: "ready" as const, message: null}, followUpWarning: null,
 }} : records;
 return <IconContext.Provider value={{color:"currentColor",size:"1em",weight:"bold"}}><div style={{maxWidth:1280,margin:"auto",padding:24}}><header style={{marginBottom:20}}><h1 style={{fontSize:24,fontWeight:600}}>会话记录</h1><p style={{fontSize:12,marginTop:6}}>开发验证 · 合成记录 · 当前状态：{mode}</p></header><SessionRecordsPage records={previewRecords} openCode={openCode} initialSource="grok" homeDirectory="/Users/example" nowMs={now}/></div></IconContext.Provider>;
}
createRoot(document.getElementById("app")!).render(<Preview/>);
