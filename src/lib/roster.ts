import type { CSSProperties } from "react";
import roster from "../../agents/roster.json";

/** Roster ids are data (agents/roster.json), so they are plain strings. */
export type AgentId = string;
export type AgentRole = "backend" | "frontend" | "senior" | "security" | "testing" | "reality" | "ceo";

export interface Agent {
  id: AgentId;
  name: string;
  /** i18n key group (roles.*, profiles.*, office.rooms.*, focus.*). */
  role: AgentRole;
  title: string;
  color: string;
  /** Cursor rule file generated for this character (without .mdc). */
  rule: string;
  keywords: string[];
  /** Agents that usually join a task together with this one. */
  collaborators: AgentId[];
  /** Where the character stands on the temple map (percent of the map image). */
  map: { x: number; y: number; height: number; label?: { x: number; y: number } };
  assets: { avatar: string; sprite: string };
  /** Upstream agency-agents files that give this character its skills. */
  agents: string[];
}

export const AGENTS: ReadonlyArray<Agent> = roster as Agent[];
export const AGENT_IDS: ReadonlyArray<AgentId> = AGENTS.map((agent) => agent.id);

function byRole(role: AgentRole): Agent {
  const agent = AGENTS.find((item) => item.role === role);
  if (!agent) throw new Error(`agents/roster.json has no agent with role "${role}"`);
  return agent;
}

/** The coordinator (Elio). */
export const CEO: Agent = byRole("ceo");
/** The release gate (Goku). */
export const REVIEWER: Agent = byRole("reality");

export function getAgent(id: AgentId): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

export function agentName(id: AgentId): string {
  return getAgent(id)?.name ?? id;
}

export function agentByRole(role: AgentRole): Agent {
  return byRole(role);
}

export function isAgentId(value: string): value is AgentId {
  return AGENTS.some((agent) => agent.id === value);
}

/** Inline style that shows the character headshot; keeps image URLs out of the CSS. */
export function avatarStyle(agent: Agent): CSSProperties {
  return { backgroundImage: `url("${agent.assets.avatar}")`, ["--avatar-color" as string]: agent.color };
}
