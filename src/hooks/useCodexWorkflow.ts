import { useCodexExtensions } from "./useCodexExtensions";
import { useCodexSkills } from "./useCodexSkills";

export function useCodexWorkflow(active: boolean, tab: string) {
  const extensions = useCodexExtensions(active, tab);
  const skills = useCodexSkills(
    active && tab === "skills",
    `${extensions.plugins.revision}:${extensions.marketplaces.revision}`,
    Boolean(extensions.operation),
  );

  return { extensions, skills, locked: Boolean(extensions.operation || skills.phase) };
}
