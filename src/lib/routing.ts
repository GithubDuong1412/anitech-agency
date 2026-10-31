import { Department, IT, Agent, AgentId } from "./roster";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchersFor(department: Department) {
  return department.agents.filter((agent) => agent.keywords.length > 0).map((agent) => ({
    agent,
    patterns: agent.keywords.map((keyword) => new RegExp("(?<![\\p{L}\\p{N}])" + escapeRegExp(keyword.toLocaleLowerCase()), "u")),
  }));
}

/** Agents whose keywords appear in the description, best match first (ties keep roster order). */
function matchAgents(description: string, department: Department): Agent[] {
  const text = description.toLocaleLowerCase();
  return matchersFor(department)
    .map(({ agent, patterns }) => ({ agent, score: patterns.filter((pattern) => pattern.test(text)).length }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.agent);
}

function inDepartment(department: Department, id: AgentId): Agent | undefined {
  return department.agents.find((agent) => agent.id === id);
}

/** Who should own a task. Falls back to the department's default owner when nothing matches. */
export function recommendAgent(description: string, department: Department = IT): AgentId {
  return matchAgents(description, department)[0]?.id ?? department.fallback.id;
}

/** Parts of the work a description touches, best match first. The department lead is not a detected part. */
export function matchedAreas(description: string, department: Department = IT): AgentId[] {
  return matchAgents(description, department)
    .map((agent) => agent.id)
    .filter((id) => id !== department.ceo.id);
}

/**
 * Characters the assignment dialog can offer as owner.
 * These are exactly the parts selected above. The fallback owner is used when nothing is selected.
 */
export function ownerCandidates(areaIds: readonly AgentId[], department: Department = IT): Agent[] {
  const chosen: Agent[] = [];
  for (const id of areaIds) {
    const agent = inDepartment(department, id);
    if (!agent || agent.id === department.ceo.id || chosen.some((item) => item.id === agent.id)) continue;
    chosen.push(agent);
  }
  return chosen.length > 0 ? chosen : [department.fallback];
}

/** Agents involved in a task: the owner plus matching specialists and their usual collaborators (max 3). */
export function relevantAgents(
  description: string,
  ownerId: AgentId,
  areaIds?: readonly AgentId[],
  department: Department = IT,
): AgentId[] {
  const related = new Set<AgentId>([ownerId]);
  const seeds = areaIds ?? matchAgents(description, department).map((agent) => agent.id);
  for (const id of seeds) {
    const agent = inDepartment(department, id);
    if (!agent) continue;
    related.add(agent.id);
    // A hand-picked part list is the whole team. Collaborators join only when the description is routed on its own.
    if (areaIds) continue;
    for (const collaborator of agent.collaborators) related.add(collaborator);
  }

  // The lead coordinates. The reviewer joins at review unless this task is explicitly about that part, or they own it.
  for (const id of [department.ceo.id, department.reviewer.id]) {
    if (id !== ownerId && !areaIds?.includes(id)) related.delete(id);
  }
  if (!areaIds && related.size === 1) {
    related.add(ownerId === department.fallback.id ? department.partner.id : department.fallback.id);
  }
  const ids = [ownerId, ...Array.from(related).filter((id) => id !== ownerId)].filter((id) => inDepartment(department, id));
  return ids.length > 3 ? ids.slice(0, 3) : ids;
}
