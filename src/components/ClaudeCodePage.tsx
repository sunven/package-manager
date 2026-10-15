import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import type { ClaudeCodeState } from "../hooks/useClaudeCode";
import { ClaudeMarketplacesPage } from "./ClaudeMarketplacesPage";
import { ClaudeHooksPage } from "./ClaudeHooksPage";

export function ClaudeCodePage({ state, tab, onTabChange }: { state: ClaudeCodeState; tab: string; onTabChange: (tab: string) => void }) {
  return <Tabs value={tab} onValueChange={onTabChange} role="main" aria-label="Claude Code 管理">
    <TabsList aria-label="Claude Code 管理视图">
      <TabsTrigger value="marketplaces" disabled={state.busy}>插件市场</TabsTrigger>
      <TabsTrigger value="hooks" disabled={state.busy}>Hooks</TabsTrigger>
    </TabsList>
    {state.error ? <Alert variant="destructive" className="mt-3"><AlertTitle>读取未完成</AlertTitle><AlertDescription>{state.error} 请重新读取；已有清单仅供参考。</AlertDescription></Alert> : null}
    {state.result ? <Alert className="mt-3" variant={state.result.status === "Succeeded" ? "default" : "destructive"}>
      <AlertTitle>{state.result.status === "Succeeded" ? "操作已完成" : state.result.status === "Conflict" ? "内容已变化" : "操作未能完整确认"}</AlertTitle>
      <AlertDescription>{state.result.message}</AlertDescription>
    </Alert> : null}
    <TabsContent value="marketplaces"><ClaudeMarketplacesPage state={state} onShowHooks={() => onTabChange("hooks")} /></TabsContent>
    <TabsContent value="hooks"><ClaudeHooksPage state={state} /></TabsContent>
  </Tabs>;
}
