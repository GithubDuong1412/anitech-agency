export const DEFAULT_UPSTREAM_DIR: string;
export const TEAM_RULE: string;

export interface SyncOptions {
  rosterPath: string;
  rosterSocialPath?: string | null;
  personasDir: string;
  vendorDir: string;
  outDir: string;
  upstreamDir?: string | null;
}

export function defaultPaths(root?: string): Required<SyncOptions>;
export function yamlQuote(value: string): string;
export function parseAgentFile(raw: string): { fields: Record<string, string>; body: string };
export function mdc(input: { description: string; alwaysApply: boolean; body: string }): string;
export function syncAgents(options: SyncOptions): { files: string[]; copied: string[]; usedUpstream: boolean };
