/**
 * Copy data/it.db and data/social.db into the shared MySQL database.
 * Safe to run again: rows are updated by their id, never duplicated.
 * The SQLite files are left in place.
 *
 * Usage: npm run db:import
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), ".env"));

const host = process.env.DB_HOST?.trim();
const database = process.env.DB_NAME?.trim() || "anitech_agency";
if (!host) {
  console.error("DB_HOST is empty. Set it in .env.local, start MySQL in Laragon, then run this again.");
  process.exit(1);
}
if (!/^[A-Za-z0-9_]+$/.test(database)) {
  console.error("DB_NAME may only contain letters, numbers and underscore.");
  process.exit(1);
}

const port = Number(process.env.DB_PORT) || 3306;
const user = process.env.DB_USER?.trim() || "root";
const password = process.env.DB_PASSWORD ?? "";
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");

const bootstrap = await mysql.createConnection({ host, port, user, password, charset: "utf8mb4" });
await bootstrap.query(`create database if not exists \`${database}\` character set utf8mb4 collate utf8mb4_unicode_ci`);
await bootstrap.end();

const conn = await mysql.createConnection({ host, port, user, password, database, charset: "utf8mb4" });
const schema = fs.readFileSync(path.join(process.cwd(), "src", "server", "mysql.schema.sql"), "utf8");
for (const statement of schema.split(";")) {
  const sql = statement.trim();
  if (sql) await conn.query(sql);
}

const upsert = async (sql, params) => {
  await conn.query(sql, params);
};

for (const departmentId of ["it", "social"]) {
  const file = path.join(dataDir, `${departmentId}.db`);
  if (!fs.existsSync(file)) {
    console.log(`${departmentId}: no file at ${file}, skipped`);
    continue;
  }
  const db = new DatabaseSync(file);
  const tasks = db.prepare("select * from tasks order by rowid").all();
  const threads = db.prepare("select * from threads order by rowid").all();
  const participants = db.prepare("select * from thread_participants order by position").all();
  const messages = db.prepare("select * from messages order by rowid").all();
  const activities = db.prepare("select * from activities order by id").all();
  const meta = db.prepare("select key, value from meta").all();

  await conn.beginTransaction();
  try {
    for (const row of tasks) {
      await upsert(
        `insert into tasks (department_id, id, title_key, title, owner_id, status, progress, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on duplicate key update title_key = values(title_key), title = values(title), owner_id = values(owner_id),
           status = values(status), progress = values(progress)`,
        [departmentId, row.id, row.title_key, row.title, row.owner_id, row.status, row.progress, row.created_at],
      );
    }
    for (const row of threads) {
      await upsert(
        `insert into threads (department_id, id, task_id, topic_key, topic_title, status)
         values (?, ?, ?, ?, ?, ?)
         on duplicate key update task_id = values(task_id), topic_key = values(topic_key), topic_title = values(topic_title), status = values(status)`,
        [departmentId, row.id, row.task_id, row.topic_key, row.topic_title, row.status],
      );
    }
    const threadIds = threads.map((row) => row.id);
    if (threadIds.length) {
      await conn.query(
        `delete from thread_participants where department_id = ? and thread_id in (${threadIds.map(() => "?").join(",")})`,
        [departmentId, ...threadIds],
      );
    }
    for (const row of participants) {
      await upsert(
        "insert into thread_participants (department_id, thread_id, agent_id, position) values (?, ?, ?, ?)",
        [departmentId, row.thread_id, row.agent_id, row.position],
      );
    }
    for (const row of messages) {
      await upsert(
        `insert into messages (department_id, id, thread_id, from_agent, kind, text_key, text, at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on duplicate key update thread_id = values(thread_id), from_agent = values(from_agent), kind = values(kind),
           text_key = values(text_key), text = values(text), at = values(at)`,
        [departmentId, row.id, row.thread_id, row.from_agent, row.kind, row.text_key, row.text, row.at],
      );
    }
    for (const row of activities) {
      await upsert(
        `insert into activities (department_id, type, agent_id, message_key, created_at, legacy_id)
         values (?, ?, ?, ?, ?, ?)
         on duplicate key update type = values(type), agent_id = values(agent_id), message_key = values(message_key), created_at = values(created_at)`,
        [departmentId, row.type, row.agent_id, row.message_key, row.created_at, row.id],
      );
    }
    for (const row of meta) {
      await upsert(
        `insert into meta (department_id, meta_key, meta_value) values (?, ?, ?)
         on duplicate key update meta_value = values(meta_value)`,
        [departmentId, row.key, row.value],
      );
    }
    await upsert(
      `insert into meta (department_id, meta_key, meta_value) values (?, 'seeded', '1')
       on duplicate key update meta_value = values(meta_value)`,
      [departmentId],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    db.close();
    throw error;
  }
  db.close();
  console.log(`${departmentId}: ${tasks.length} tasks, ${threads.length} threads, ${messages.length} messages, ${activities.length} activities`);
}

await conn.end();
console.log(`Imported into MySQL ${host}:${port}/${database}. SQLite files were kept.`);
