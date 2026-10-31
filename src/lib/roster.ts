import type { CSSProperties } from "react";
import roster from "../../agents/roster.json";
import socialRoster from "../../agents/roster-social.json";

/** Roster ids are data (agents/roster*.json), so they are plain strings. */
export type AgentId = string;
export type AgentRole =
  | "backend"
  | "frontend"
  | "senior"
  | "security"
  | "testing"
  | "reality"
  | "ceo"
  | "socialCeo"
  | "director"
  | "copy"
  | "image"
  | "trend"
  | "community"
  | "ads"
  | "carousel";

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
  /** Where the character stands on the department map (percent of the map image). */
  map: { x: number; y: number; height: number; label?: { x: number; y: number } };
  assets: { avatar: string; sprite: string };
  /** Upstream agency-agents files that give this character its skills. */
  agents: string[];
}

export interface MapScene {
  background: string;
  center: string;
  width: number;
  height: number;
  /** Feet of the center building, its height, and the point dashed links connect to. */
  centerMark: { x: number; y: number; height: number; hub: { x: number; y: number } };
  ariaLabel: string;
}

export type DepartmentId = "it" | "social";

export interface Department {
  id: DepartmentId;
  agents: readonly Agent[];
  ceo: Agent;
  reviewer: Agent;
  /** Owner when a task matches nobody. */
  fallback: Agent;
  /** Second person when a task has only one participant. */
  partner: Agent;
  map: MapScene;
}

function requireRole(agents: readonly Agent[], role: AgentRole, department: DepartmentId): Agent {
  const agent = agents.find((item) => item.role === role);
  if (!agent) throw new Error(`agents roster for ${department} has no role "${role}"`);
  return agent;
}

function buildDepartment(
  id: DepartmentId,
  agents: readonly Agent[],
  map: MapScene,
  roles: { ceo: AgentRole; reviewer: AgentRole; fallback: AgentRole; partner: AgentRole },
): Department {
  return {
    id,
    agents,
    map,
    ceo: requireRole(agents, roles.ceo, id),
    reviewer: requireRole(agents, roles.reviewer, id),
    fallback: requireRole(agents, roles.fallback, id),
    partner: requireRole(agents, roles.partner, id),
  };
}

export const IT: Department = buildDepartment("it", roster as Agent[], {
  background: "/maps/temple.png",
  center: "/maps/center.png",
  width: 819,
  height: 461,
  centerMark: { x: 50, y: 52, height: 16, hub: { x: 50, y: 46 } },
  ariaLabel: "Temple Studio Map",
}, { ceo: "ceo", reviewer: "reality", fallback: "senior", partner: "backend" });

export const SOCIAL: Department = buildDepartment("social", socialRoster as Agent[], {
  background: "/maps/social-map.png",
  center: "/maps/social-center.png",
  width: 1536,
  height: 1024,
  centerMark: { x: 50, y: 54, height: 13, hub: { x: 50, y: 47 } },
  ariaLabel: "Social Marketing Map",
}, { ceo: "socialCeo", reviewer: "director", fallback: "copy", partner: "image" });

/** Stable order of every department map. Sidebar counts and workspace tabs read this. */
export const DEPARTMENT_IDS: readonly DepartmentId[] = ["it", "social"];

const DEPARTMENTS: Record<DepartmentId, Department> = { it: IT, social: SOCIAL };

export function getDepartment(id: DepartmentId): Department {
  return DEPARTMENTS[id];
}

/** IT Research roster. Existing callers keep this view. */
export const AGENTS: ReadonlyArray<Agent> = IT.agents;
export const AGENT_IDS: ReadonlyArray<AgentId> = AGENTS.map((agent) => agent.id);

/** The IT coordinator (Elio). */
export const CEO: Agent = IT.ceo;
/** The IT release gate (Goku). */
export const REVIEWER: Agent = IT.reviewer;

export function getAgent(id: AgentId): Agent | undefined {
  return IT.agents.find((agent) => agent.id === id) ?? SOCIAL.agents.find((agent) => agent.id === id);
}

export function agentName(id: AgentId): string {
  return getAgent(id)?.name ?? id;
}

export function agentByRole(role: AgentRole, department: Department = IT): Agent {
  return requireRole(department.agents, role, department.id);
}

export function isAgentId(value: string): value is AgentId {
  return IT.agents.some((agent) => agent.id === value) || SOCIAL.agents.some((agent) => agent.id === value);
}

/** Inline style that shows the character headshot; keeps image URLs out of the CSS. */
export function avatarStyle(agent: Agent): CSSProperties {
  return { backgroundImage: `url("${agent.assets.avatar}")`, ["--avatar-color" as string]: agent.color };
}
