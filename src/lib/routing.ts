import { AGENTS, Agent, AgentId, CEO, REVIEWER, agentByRole, getAgent } from "./roster";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A keyword matches at the start of a word (so "api" matches "apis" but not "capital").
const matchers = AGENTS.filter((agent) => agent.keywords.length > 0).map((agent) => ({
  agent,
  patterns: agent.keywords.map((keyword) => new RegExp("(?<![\\p{L}\\p{N}])" + escapeRegExp(keyword.toLocaleLowerCase()), "u")),
}));

/** Agents whose keywords appear in the description, best match first (ties keep roster order). */
function matchAgents(description: string): Agent[] {
  const text = description.toLocaleLowerCase();
  return matchers
    .map(({ agent, patterns }) => ({ agent, score: patterns.filter((pattern) => pattern.test(text)).length }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.agent);
}

const senior = () => agentByRole("senior");

/** Who should own a task. Falls back to the senior developer when nothing matches. */
export function recommendAgent(description: string): AgentId {
  return matchAgents(description)[0]?.id ?? senior().id;
}

/** Parts of the work a description touches, best match first. The senior is the fallback owner, not a detected part. */
export function matchedAreas(description: string): AgentId[] {
  return matchAgents(description).map((agent) => agent.id).filter((id) => id !== senior().id && id !== CEO.id);
}

/**
 * Characters the assignment dialog can offer as owner.
 * Gojo is always first and is the default. The rest are the chosen parts plus their usual collaborators.
 */
export function ownerCandidates(areaIds: readonly AgentId[]): Agent[] {
  const lead = senior();
  const ids = new Set<AgentId>([lead.id]);
  for (const id of areaIds) {
    const agent = getAgent(id);
    if (!agent || agent.id === CEO.id) continue;
    ids.add(agent.id);
    for (const collaborator of agent.collaborators) {
      const partner = getAgent(collaborator);
      if (partner && partner.id !== CEO.id && partner.id !== REVIEWER.id) ids.add(partner.id);
    }
  }
  if (areaIds.includes(REVIEWER.id)) ids.add(REVIEWER.id);
  return [lead, ...AGENTS.filter((agent) => ids.has(agent.id) && agent.id !== lead.id)];
}

/** Agents involved in a task: the owner plus matching specialists and their usual collaborators (max 3). */
export function relevantAgents(description: string, ownerId: AgentId, areaIds?: readonly AgentId[]): AgentId[] {
  const related = new Set<AgentId>([ownerId]);
  const seeds = areaIds ?? matchAgents(description).map((agent) => agent.id);
  for (const id of seeds) {
    const agent = getAgent(id);
    if (!agent) continue;
    related.add(agent.id);
    for (const collaborator of agent.collaborators) related.add(collaborator);
  }

  // The CEO coordinates. The release gate joins at review unless this task is explicitly about that part, or they own it.
  for (const id of [CEO.id, REVIEWER.id]) {
    if (id !== ownerId && !areaIds?.includes(id)) related.delete(id);
  }
  if (related.size === 1) {
    const lead = senior().id;
    related.add(ownerId === lead ? agentByRole("backend").id : lead);
  }
  const ids = [ownerId, ...Array.from(related).filter((id) => id !== ownerId)].filter((id) => getAgent(id));
  return ids.length > 3 ? ids.slice(0, 3) : ids;
}
