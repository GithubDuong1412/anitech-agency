import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DEPARTMENT_IDS, type DepartmentId, getDepartment } from "@/lib/roster";
import { type HubMessage, type HubMessageKind, type HubThread, type HubThreadStatus, type HubState, createHub, syncAll } from "@/lib/hub";
import type { Task, TaskStatus, TaskTitleKey } from "@/lib/tasks";
import type { ActivityRecord, DeptSnapshot } from "@/lib/state";
import { seedSnapshot } from "@/lib/seed";

/**
 * Department storage. MySQL (one shared database, rows split by department_id) when DB_HOST is set.
 * SQLite files under data/ are only the fallback for machines without MySQL.
 * Server-only. Never import this from a client component.
 */

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DB_NAME = /^[A-Za-z0-9_]+$/;

/** Null when DB_HOST is empty: the app then uses the SQLite fallback. */
export function mysqlConfig(env: Record<string, string | undefined> = process.env): MysqlConfig | null {
  const host = env.DB_HOST?.trim();
  if (!host) return null;
  const database = env.DB_NAME?.trim() || "anitech_agency";
  if (!DB_NAME.test(database)) throw new Error("DB_NAME may only contain letters, numbers and underscore");
  const port = Number(env.DB_PORT);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 3306,
    user: env.DB_USER?.trim() || "root",
    password: env.DB_PASSWORD ?? "",
    database,
  };
}

export function dbEngine(env: Record<string, string | undefined> = process.env): "mysql" | "sqlite" {
  return env.DB_HOST?.trim() ? "mysql" : "sqlite";
}

export interface DeptStore {
  readonly departmentId: DepartmentId;
  tasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  saveTask(task: Task): Promise<void>;
  addActivity(input: Omit<ActivityRecord, "id">, at?: number): Promise<ActivityRecord>;
  activities(limit?: number): Promise<ActivityRecord[]>;
  hub(): Promise<HubState>;
  commitHub(previous: HubState, next: HubState): Promise<void>;
  snapshot(): Promise<DeptSnapshot>;
  close(): Promise<void>;
}

export function isDepartmentId(value: unknown): value is DepartmentId {
  return typeof value === "string" && (DEPARTMENT_IDS as readonly string[]).includes(value);
}

const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists tasks (
  id text primary key, title_key text not null, title text, owner_id text not null,
  status text not null, run_mode text, provider text, model text, progress integer not null, created_at integer not null
);
create table if not exists threads (
  id text primary key, task_id text, topic_key text, topic_title text, status text not null
);
create table if not exists thread_participants (
  thread_id text not null references threads(id) on delete cascade,
  agent_id text not null, position integer not null,
  primary key (thread_id, agent_id)
);
create table if not exists messages (
  id text primary key, thread_id text not null references threads(id) on delete cascade,
  from_agent text not null, kind text not null, text_key text, text text, at integer not null
);
create table if not exists activities (
  id integer primary key autoincrement, type text not null, agent_id text, message_key text, created_at integer not null
);
create index if not exists messages_thread on messages (thread_id);
`;

type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? undefined : String(value));

export class Store implements DeptStore {
  readonly departmentId: DepartmentId;
  private readonly db: DatabaseSync;

  constructor(departmentId: DepartmentId, location: string) {
    if (!isDepartmentId(departmentId)) throw new Error("unknown department");
    this.departmentId = departmentId;
    if (location !== ":memory:") fs.mkdirSync(path.dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
    this.db.exec("pragma journal_mode = WAL; pragma foreign_keys = on;");
    this.db.exec(SCHEMA);
    this.migrateTasks();
    this.seedOnce();
  }

  async close() {
    this.db.close();
  }

  private migrateTasks() {
    const columns = new Set((this.db.prepare("pragma table_info(tasks)").all() as Row[]).map((row) => String(row.name)));
    if (!columns.has("run_mode")) this.db.exec("alter table tasks add column run_mode text");
    if (!columns.has("provider")) this.db.exec("alter table tasks add column provider text");
    if (!columns.has("model")) this.db.exec("alter table tasks add column model text");
  }

  private depth = 0;

  /** Transaction that can nest: only the outermost call begins and commits. */
  private tx<T>(work: () => T): T {
    if (this.depth > 0) return work();
    this.db.exec("begin");
    this.depth = 1;
    try {
      const result = work();
      this.db.exec("commit");
      return result;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  private meta(key: string): string | undefined {
    const row = this.db.prepare("select value from meta where key = ?").get(key) as Row | undefined;
    return str(row?.value);
  }

  private setMeta(key: string, value: string) {
    this.db.prepare("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }

  private seedOnce() {
    if (this.meta("seeded")) return;
    const seed = seedSnapshot(this.departmentId);
    this.tx(() => {
      for (const task of seed.tasks) this.saveTask(task);
      // Activities list newest first; insert oldest first so ids ascend with time.
      for (const activity of [...seed.activities].reverse()) this.addActivity({ type: activity.type, agentId: activity.agentId, messageKey: activity.messageKey }, 0);
      this.commitHub(createHub(this.agentIds()), seed.hub);
      this.setMeta("seeded", "1");
    });
  }

  private agentIds(): string[] {
    return getDepartment(this.departmentId).agents.map((agent) => agent.id);
  }

  // ---- tasks -------------------------------------------------------------

  private toTask(row: Row): Task {
    return {
      id: String(row.id),
      titleKey: String(row.title_key) as TaskTitleKey,
      title: str(row.title),
      ownerId: String(row.owner_id),
      status: String(row.status) as TaskStatus,
      runMode: row.run_mode === "ai" || row.run_mode === "demo" ? row.run_mode : undefined,
      provider: str(row.provider),
      model: str(row.model),
      progress: Number(row.progress),
      createdAt: Number(row.created_at),
    };
  }

  async tasks(): Promise<Task[]> {
    return (this.db.prepare("select * from tasks order by rowid").all() as Row[]).map((row) => this.toTask(row));
  }

  async getTask(id: string): Promise<Task | undefined> {
    const row = this.db.prepare("select * from tasks where id = ?").get(id) as Row | undefined;
    return row ? this.toTask(row) : undefined;
  }

  async saveTask(task: Task) {
    this.db.prepare(
      `insert into tasks (id, title_key, title, owner_id, status, run_mode, provider, model, progress, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set title_key = excluded.title_key, title = excluded.title, owner_id = excluded.owner_id,
         status = excluded.status, run_mode = excluded.run_mode, provider = excluded.provider, model = excluded.model, progress = excluded.progress`,
    ).run(task.id, task.titleKey, task.title ?? null, task.ownerId, task.status, task.runMode ?? null, task.provider ?? null, task.model ?? null, Math.round(task.progress), task.createdAt);
  }

  // ---- activities --------------------------------------------------------

  async addActivity(input: Omit<ActivityRecord, "id">, at = Date.now()): Promise<ActivityRecord> {
    const result = this.db.prepare("insert into activities (type, agent_id, message_key, created_at) values (?, ?, ?, ?)")
      .run(input.type, input.agentId ?? null, input.messageKey ?? null, at);
    return { ...input, id: "activity-db-" + String(result.lastInsertRowid) };
  }

  async activities(limit = 6): Promise<ActivityRecord[]> {
    return (this.db.prepare("select * from activities order by id desc limit ?").all(limit) as Row[]).map((row) => ({
      id: "activity-db-" + String(row.id),
      type: String(row.type) as ActivityRecord["type"],
      agentId: str(row.agent_id),
      messageKey: str(row.message_key),
    }));
  }

  // ---- hub ---------------------------------------------------------------

  async hub(): Promise<HubState> {
    const participants = new Map<string, string[]>();
    for (const row of this.db.prepare("select thread_id, agent_id from thread_participants order by position").all() as Row[]) {
      const list = participants.get(String(row.thread_id)) ?? [];
      list.push(String(row.agent_id));
      participants.set(String(row.thread_id), list);
    }
    const threads: HubThread[] = (this.db.prepare("select * from threads order by rowid").all() as Row[]).map((row) => ({
      id: String(row.id),
      taskId: str(row.task_id),
      topicKey: str(row.topic_key) as TaskTitleKey | undefined,
      topicTitle: str(row.topic_title),
      participants: participants.get(String(row.id)) ?? [],
      status: String(row.status) as HubThreadStatus,
    }));
    const messages: HubMessage[] = (this.db.prepare("select * from messages order by rowid").all() as Row[]).map((row) => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      from: String(row.from_agent),
      kind: String(row.kind) as HubMessageKind,
      textKey: str(row.text_key),
      text: str(row.text),
      at: Number(row.at),
    }));
    const state = createHub(this.agentIds());
    return syncAll({ ...state, version: Number(this.meta("hub_version") ?? 0), threads, messages });
  }

  /** Write only what changed between two hub states: new threads, thread edits, new messages, the version. */
  async commitHub(previous: HubState, next: HubState) {
    const before = new Map(previous.threads.map((thread) => [thread.id, thread]));
    const knownMessages = new Set(previous.messages.map((message) => message.id));
    const writeParticipants = (thread: HubThread) => {
      this.db.prepare("delete from thread_participants where thread_id = ?").run(thread.id);
      thread.participants.forEach((agentId, position) => {
        this.db.prepare("insert into thread_participants (thread_id, agent_id, position) values (?, ?, ?)").run(thread.id, agentId, position);
      });
    };
    this.tx(() => {
      for (const thread of next.threads) {
        const old = before.get(thread.id);
        if (!old) {
          this.db.prepare("insert into threads (id, task_id, topic_key, topic_title, status) values (?, ?, ?, ?, ?)")
            .run(thread.id, thread.taskId ?? null, thread.topicKey ?? null, thread.topicTitle ?? null, thread.status);
          writeParticipants(thread);
          continue;
        }
        if (old.status !== thread.status) this.db.prepare("update threads set status = ? where id = ?").run(thread.status, thread.id);
        if (old.participants.join("|") !== thread.participants.join("|")) writeParticipants(thread);
      }
      for (const message of next.messages) {
        if (knownMessages.has(message.id)) continue;
        this.db.prepare("insert into messages (id, thread_id, from_agent, kind, text_key, text, at) values (?, ?, ?, ?, ?, ?, ?)")
          .run(message.id, message.threadId, message.from, message.kind, message.textKey ?? null, message.text ?? null, message.at);
      }
      this.setMeta("hub_version", String(next.version));
    });
  }

  async snapshot(): Promise<DeptSnapshot> {
    return { tasks: await this.tasks(), activities: await this.activities(), hub: await this.hub() };
  }
}

const globalStores = globalThis as unknown as { __anitechStores?: Map<DepartmentId, Promise<DeptStore>> };

function dataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
}

let announced = false;

/**
 * One store per department, kept on globalThis so dev hot reloads reuse the connection.
 * MySQL when DB_HOST is set; otherwise the SQLite fallback.
 */
export function openStore(id: DepartmentId): Promise<DeptStore> {
  const stores = (globalStores.__anitechStores ??= new Map());
  let store = stores.get(id);
  if (!store) {
    store = openFresh(id);
    stores.set(id, store);
  }
  return store;
}

async function openFresh(id: DepartmentId): Promise<DeptStore> {
  const config = mysqlConfig();
  if (config) {
    const { openMysqlStore } = await import("./mysql");
    if (!announced) {
      announced = true;
      console.info(`[db] MySQL ${config.host}:${config.port}/${config.database}`);
    }
    return openMysqlStore(id, config);
  }
  if (!announced) {
    announced = true;
    console.warn(`[db] DB_HOST is not set, using the SQLite fallback in ${dataDir()}`);
  }
  return new Store(id, path.join(dataDir(), `${id}.db`));
}
