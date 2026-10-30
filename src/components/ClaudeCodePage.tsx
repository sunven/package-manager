import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import type { ClaudeWorkflow } from "../hooks/useClaudeWorkflow";
import type { ObservationCoverageItem } from "../observationCoverage";
import { ClaudeMarketplacesPage } from "./ClaudeMarketplacesPage";
import { ClaudeSkillsPage } from "./ClaudeSkillsPage";
import { ClaudeHooksPage } from "./ClaudeHooksPage";

export function ClaudeCodePage({ workflow, coverage, tab, onTabChange }: {
  workflow: ClaudeWorkflow;
  coverage: { extensions: ObservationCoverageItem; hooks: ObservationCoverageItem; skills: ObservationCoverageItem };
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const [focusedPluginId, setFocusedPluginId] = useState<string | undefined>();
  const { state, skills, locked } = workflow;
  return <div className="view-grid">
    <Tabs value={tab} onValueChange={onTabChange} role="main" aria-label="Claude Code 管理">
    <TabsList aria-label="Claude Code 管理视图">
      <TabsTrigger value="marketplaces" disabled={locked}>插件市场</TabsTrigger>
      <TabsTrigger value="hooks" disabled={locked}>Hooks</TabsTrigger>
      <TabsTrigger value="skills" disabled={locked}>Skills</TabsTrigger>
    </TabsList>
    {tab !== "skills" && state.error ? <Alert variant="destructive" className="mt-3"><AlertTitle>读取未完成</AlertTitle><AlertDescription>{state.error} 请重新读取；已有清单仅供参考。</AlertDescription></Alert> : null}
    {tab !== "skills" && state.result ? <Alert className="mt-3" variant={state.result.status === "Succeeded" ? "default" : "destructive"}>
      <AlertTitle>{state.result.status === "Succeeded" ? "操作已完成" : state.result.status === "Conflict" ? "内容已变化" : "操作未能完整确认"}</AlertTitle>
      <AlertDescription>{state.result.message}</AlertDescription>
    </Alert> : null}
    <TabsContent value="marketplaces"><ClaudeMarketplacesPage coverageItem={coverage.extensions} state={state} focusedPluginId={focusedPluginId} onShowHooks={() => onTabChange("hooks")} /></TabsContent>
    <TabsContent value="hooks"><ClaudeHooksPage coverageItem={coverage.hooks} state={state} /></TabsContent>
    <TabsContent value="skills"><ClaudeSkillsPage coverageItem={coverage.skills} workflow={skills} onShowPlugins={(pluginId) => { setFocusedPluginId(pluginId); onTabChange("marketplaces"); }} /></TabsContent>
    </Tabs>
  </div>;
}
