import { type Department, type DepartmentId, getDepartment } from "@/lib/roster";
import { type Locale, isLocale } from "@/i18n";
import { isDepartmentId } from "./db";

export const MAX_BODY_BYTES = 4_000;
export const MAX_TITLE = 500;
export const MAX_NOTE = 500;
export const MAX_AREAS = 8;

/**
 * Mutating routes accept only requests made by this site's own pages.
 * Browsers always send Origin on cross-site POST/PATCH; scripts without Origin are not a CSRF risk.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === request.headers.get("host");
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

const hits = new Map<string, number[]>();

/** Sliding-window limiter, memory only. Good enough for one server; swap for a shared store if scaled out. */
export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [name, times] of hits) if (times.every((time) => now - time >= windowMs)) hits.delete(name);
  return false;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

export function resetRateLimits() {
  hits.clear();
}

const running = new Set<DepartmentId>();

/** One agent run per department at a time, so two runs cannot interleave one hub. */
export function tryLock(id: DepartmentId): boolean {
  if (running.has(id)) return false;
  running.add(id);
  return true;
}

export function unlock(id: DepartmentId) {
  running.delete(id);
}

export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  const text = await request.text();
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function department(id: string): Department | undefined {
  return isDepartmentId(id) ? getDepartment(id) : undefined;
}

export function localeOf(value: unknown): Locale {
  return typeof value === "string" && isLocale(value) ? value : "vi";
}

export interface NewTaskBody {
  title: string;
  ownerId: string;
  areas?: string[];
  locale: Locale;
}

export function parseNewTask(body: unknown, dept: Department): NewTaskBody | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title || title.length > MAX_TITLE) return undefined;
  const ids = new Set(dept.agents.map((agent) => agent.id));
  const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
  if (!ids.has(ownerId)) return undefined;
  let areas: string[] | undefined;
  if (data.areas !== undefined) {
    if (!Array.isArray(data.areas) || data.areas.length > MAX_AREAS) return undefined;
    // Ids from another department are dropped, not trusted.
    areas = data.areas.filter((item): item is string => typeof item === "string" && ids.has(item));
  }
  return { title, ownerId, areas, locale: localeOf(data.locale) };
}

export interface ResolveBody {
  action: "approve" | "changes";
  note?: string;
  locale: Locale;
}

export function parseResolve(body: unknown): ResolveBody | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as Record<string, unknown>;
  if (data.action !== "approve" && data.action !== "changes") return undefined;
  const note = typeof data.note === "string" ? data.note.trim().slice(0, MAX_NOTE) : undefined;
  return { action: data.action, note: note || undefined, locale: localeOf(data.locale) };
}

export const TASK_ID = /^task-[A-Za-z0-9-]{1,40}$/;
