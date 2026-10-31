import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDepartment, type DepartmentId } from "@/lib/roster";
import { createHub, syncAll, type HubMessage, type HubMessageKind, type HubState, type HubThread, type HubThreadStatus } from "@/lib/hub";
import type { Task, TaskStatus, TaskTitleKey } from "@/lib/tasks";
import type { ActivityRecord, DeptSnapshot } from "@/lib/state";
import { seedSnapshot } from "@/lib/seed";
import { isDepartmentId, type DeptStore, type MysqlConfig } from "./db";

/**
 * One MySQL database for every map. Each row carries department_id, so the two maps never mix.
 * Tables are created on first use. The database itself is created too if it is missing.
 */

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "server", "mysql.schema.sql"), "utf8");

type Row = RowDataPacket & Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? undefined : String(value));

const txContext = new AsyncLocalStorage<PoolConnection>();
const pools = globalThis as unknown as { __anitechMysql?: { key: string; pool: Pool } };

function poolFor(config: MysqlConfig): Pool {
  const key = `${config.host}:${config.port}/${config.database}/${config.user}`;
  if (pools.__anitechMysql?.key === key) return pools.__anitechMysql.pool;
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
    // Keep big ids as numbers while they fit in JS. Timestamps here always do.
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  pools.__anitechMysql = { key, pool };
  return pool;
}

let schemaReady: Promise<void> | null = null;

/** Create the database and tables. Safe to call more than once. */
export function ensureMysql(config: MysqlConfig): Promise<void> {
  schemaReady ??= (async () => {
    const bootstrap = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: "utf8mb4",
    });
    try {
      await bootstrap.query(
        `create database if not exists \`${config.database}\` character set utf8mb4 collate utf8mb4_unicode_ci`,
      );
    } finally {
      await bootstrap.end();
    }
    const pool = poolFor(config);
    for (const statement of SCHEMA.split(";")) {
      const sql = statement.trim();
      if (sql) await pool.query(sql);
    }
    const [taskColumns] = await pool.query<RowDataPacket[]>(
      "select column_name from information_schema.columns where table_schema = database() and table_name = 'tasks'",
    );
    const columns = new Set(taskColumns.map((row) => String(row.column_name)));
    if (!columns.has("run_mode")) await pool.query("alter table tasks add column run_mode varchar(16) null");
    if (!columns.has("provider")) await pool.query("alter table tasks add column provider varchar(64) null");
    if (!columns.has("model")) await pool.query("alter table tasks add column model varchar(160) null");
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export class MysqlStore implements DeptStore {
  readonly departmentId: DepartmentId;
  private readonly pool: Pool;

  constructor(departmentId: DepartmentId, config: MysqlConfig) {
    if (!isDepartmentId(departmentId)) throw new Error("unknown department");
    this.departmentId = departmentId;
    this.pool = poolFor(config);
  }

  async close() {
    // The pool is shared by every department and stays open for the process.
  }

  private async query(sql: string, params: unknown[] = []): Promise<[Row[], ResultSetHeader]> {
    const runner = txContext.getStore() ?? this.pool;
    const [rows] = await runner.query<Row[] & ResultSetHeader>(sql, params);
    return [Array.isArray(rows) ? rows : [], rows as unknown as ResultSetHeader];
  }

  private async tx<T>(work: () => Promise<T>): Promise<T> {
    if (txContext.getStore()) return work();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await txContext.run(connection, work);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async meta(key: string): Promise<string | undefined> {
    const [rows] = await this.query("select meta_value from meta where department_id = ? and meta_key = ?", [this.departmentId, key]);
    return str(rows[0]?.meta_value);
  }

  private async setMeta(key: string, value: string) {
    await this.query(
      `insert into meta (department_id, meta_key, meta_value) values (?, ?, ?)
       on duplicate key update meta_value = values(meta_value)`,
      [this.departmentId, key, value],
    );
  }

  private agentIds(): string[] {
    return getDepartment(this.departmentId).agents.map((agent) => agent.id);
  }

  /** Insert the demo rows the first time this department is opened. */
  async prepare() {
    if (await this.meta("seeded")) return;
    const seed = seedSnapshot(this.departmentId);
    await this.tx(async () => {
      if (await this.meta("seeded")) return;
      for (const task of seed.tasks) await this.saveTask(task);
      for (const activity of [...seed.activities].reverse()) {
        await this.addActivity({ type: activity.type, agentId: activity.agentId, messageKey: activity.messageKey }, 0);
      }
      await this.commitHub(createHub(this.agentIds()), seed.hub);
      await this.setMeta("seeded", "1");
    });
  }

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
    const [rows] = await this.query("select * from tasks where department_id = ? order by seq", [this.departmentId]);
    return rows.map((row) => this.toTask(row));
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [rows] = await this.query("select * from tasks where department_id = ? and id = ?", [this.departmentId, id]);
    return rows[0] ? this.toTask(rows[0]) : undefined;
  }

  async saveTask(task: Task) {
    await this.query(
      `insert into tasks (department_id, id, title_key, title, owner_id, status, run_mode, provider, model, progress, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on duplicate key update title_key = values(title_key), title = values(title), owner_id = values(owner_id),
         status = values(status), run_mode = values(run_mode), provider = values(provider), model = values(model), progress = values(progress)`,
      [this.departmentId, task.id, task.titleKey, task.title ?? null, task.ownerId, task.status, task.runMode ?? null, task.provider ?? null, task.model ?? null, Math.round(task.progress), task.createdAt],
    );
  }

  async addActivity(input: Omit<ActivityRecord, "id">, at = Date.now(), legacyId?: number): Promise<ActivityRecord> {
    const [, header] = await this.query(
      "insert into activities (department_id, type, agent_id, message_key, created_at, legacy_id) values (?, ?, ?, ?, ?, ?)",
      [this.departmentId, input.type, input.agentId ?? null, input.messageKey ?? null, at, legacyId ?? null],
    );
    return { ...input, id: "activity-db-" + String(header.insertId) };
  }

  async activities(limit = 6): Promise<ActivityRecord[]> {
    const [rows] = await this.query(
      "select * from activities where department_id = ? order by id desc limit ?",
      [this.departmentId, limit],
    );
    return rows.map((row) => ({
      id: "activity-db-" + String(row.id),
      type: String(row.type) as ActivityRecord["type"],
      agentId: str(row.agent_id),
      messageKey: str(row.message_key),
    }));
  }

  async hub(): Promise<HubState> {
    const [participantRows] = await this.query(
      "select thread_id, agent_id from thread_participants where department_id = ? order by position",
      [this.departmentId],
    );
    const participants = new Map<string, string[]>();
    for (const row of participantRows) {
      const list = participants.get(String(row.thread_id)) ?? [];
      list.push(String(row.agent_id));
      participants.set(String(row.thread_id), list);
    }
    const [threadRows] = await this.query("select * from threads where department_id = ? order by seq", [this.departmentId]);
    const threads: HubThread[] = threadRows.map((row) => ({
      id: String(row.id),
      taskId: str(row.task_id),
      topicKey: str(row.topic_key) as TaskTitleKey | undefined,
      topicTitle: str(row.topic_title),
      participants: participants.get(String(row.id)) ?? [],
      status: String(row.status) as HubThreadStatus,
    }));
    const [messageRows] = await this.query("select * from messages where department_id = ? order by seq", [this.departmentId]);
    const messages: HubMessage[] = messageRows.map((row) => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      from: String(row.from_agent),
      kind: String(row.kind) as HubMessageKind,
      textKey: str(row.text_key),
      text: str(row.text),
      at: Number(row.at),
    }));
    const state = createHub(this.agentIds());
    return syncAll({ ...state, version: Number((await this.meta("hub_version")) ?? 0), threads, messages });
  }

  async commitHub(previous: HubState, next: HubState) {
    const before = new Map(previous.threads.map((thread) => [thread.id, thread]));
    const knownMessages = new Set(previous.messages.map((message) => message.id));
    const writeParticipants = async (thread: HubThread) => {
      await this.query("delete from thread_participants where department_id = ? and thread_id = ?", [this.departmentId, thread.id]);
      for (const [position, agentId] of thread.participants.entries()) {
        await this.query(
          "insert into thread_participants (department_id, thread_id, agent_id, position) values (?, ?, ?, ?)",
          [this.departmentId, thread.id, agentId, position],
        );
      }
    };
    await this.tx(async () => {
      for (const thread of next.threads) {
        const old = before.get(thread.id);
        if (!old) {
          await this.query(
            "insert into threads (department_id, id, task_id, topic_key, topic_title, status) values (?, ?, ?, ?, ?, ?)",
            [this.departmentId, thread.id, thread.taskId ?? null, thread.topicKey ?? null, thread.topicTitle ?? null, thread.status],
          );
          await writeParticipants(thread);
          continue;
        }
        if (old.status !== thread.status) {
          await this.query("update threads set status = ? where department_id = ? and id = ?", [thread.status, this.departmentId, thread.id]);
        }
        if (old.participants.join("|") !== thread.participants.join("|")) await writeParticipants(thread);
      }
      for (const message of next.messages) {
        if (knownMessages.has(message.id)) continue;
        await this.query(
          "insert into messages (department_id, id, thread_id, from_agent, kind, text_key, text, at) values (?, ?, ?, ?, ?, ?, ?, ?)",
          [this.departmentId, message.id, message.threadId, message.from, message.kind, message.textKey ?? null, message.text ?? null, message.at],
        );
      }
      await this.setMeta("hub_version", String(next.version));
    });
  }

  async snapshot(): Promise<DeptSnapshot> {
    return { tasks: await this.tasks(), activities: await this.activities(), hub: await this.hub() };
  }
}

const opened = new Map<DepartmentId, Promise<MysqlStore>>();

export function openMysqlStore(id: DepartmentId, config: MysqlConfig): Promise<MysqlStore> {
  let pending = opened.get(id);
  if (!pending) {
    pending = ensureMysql(config).then(async () => {
      const store = new MysqlStore(id, config);
      await store.prepare();
      return store;
    }).catch((error) => {
      opened.delete(id);
      throw error;
    });
    opened.set(id, pending);
  }
  return pending;
}
