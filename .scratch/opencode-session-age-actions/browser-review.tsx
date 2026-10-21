import ReactDOM from "react-dom/client";
import { SessionRecordsPage } from "../../src/components/SessionRecordsPage";
import { useSessionRecords } from "../../src/hooks/useSessionRecords";
import { useOpenCodeSessions } from "../../src/hooks/useOpenCodeSessions";
import "../../src/styles.css";

const nowMs = new Date(2026, 9, 21, 12).getTime();
const day = 24 * 60 * 60 * 1000;
const record = (id: string, title: string, age: number, parentId: string | null = null) => ({
  id, title, lastActivityMs: nowMs - age * day, parentId, parentTitle: parentId,
  archived: id === "ses_archived", workingDirectory: "/Users/example/projects/" + "long-directory-name/".repeat(4),
});
const scan = {
  status: "ready", message: null, activeSessionIds: ["ses_running"], activityMessage: null,
  records: [record("ses_recent", "近期项目讨论", 1), record("ses_parent", "旧父会话，保留近期后代", 70),
    record("ses_child", "昨天仍有活动的子会话", 1, "ses_parent"), record("ses_old", "可删除的旧分支", 40),
    record("ses_archived", "已归档的旧子会话", 35, "ses_old"), record("ses_running", "运行中的旧记录", 40)],
};
const state = { calls: [] as { command: string; args: any }[], scan };
(window as any).openCodeAgeReview = state;
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: any) => {
    state.calls.push({ command, args });
    if (command === "scan_session_records") return {
      codex: { directory: "/fixture/codex", status: "Missing", records: [], message: null },
      claude: { directory: "/fixture/claude", status: "Missing", records: [], message: null },
    };
    if (command === "scan_opencode_sessions") return structuredClone(state.scan);
    if (command === "delete_opencode_sessions_older_than") {
      const ids = new Set(args.expectedRecords.map((record: any) => record.id));
      state.scan.records = state.scan.records.filter((record) => !ids.has(record.id));
      return { preflightError: null, items: args.sessionIds.map((id: string) => ({ id, status: "deleted", message: null })) };
    }
    throw new Error("Isolated fixture rejects: " + command);
  },
};
function Review() {
  const records = useSessionRecords(true);
  const openCode = useOpenCodeSessions(true);
  return <div className="p-4"><p className="mb-4 text-sm">合成数据验证 · 不连接本机 OpenCode</p><SessionRecordsPage records={records} openCode={openCode} initialSource="opencode" homeDirectory="/Users/example" nowMs={nowMs} /></div>;
}
ReactDOM.createRoot(document.getElementById("app")!).render(<Review />);
