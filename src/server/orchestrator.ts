import { randomUUID } from "node:crypto";
import type { AgentId, Department } from "@/lib/roster";
import { type HubMessage, type HubMessageKind, closeThread, joinThread, openThread, postMessage } from "@/lib/hub";
import { relevantAgents } from "@/lib/routing";
import { type Task, approveTask, createTask, requestTaskChanges } from "@/lib/tasks";
import type { RunEvent } from "@/lib/state";
import { isLocale, translate } from "@/i18n";
import type { DeptStore } from "./db";
import type { LlmClient } from "./llm";
import { buildSystemPrompt } from "./persona";

/**
 * Runs a task through the department: the owner plans, teammates answer from their own rules,
 * the owner sums up, the reviewer checks. Every message is saved before it is streamed out.
 *
 * Without an LlmClient the same pipeline runs in demo mode: scripted replies, same database.
 */

export interface RunDeps {
  store: DeptStore;
  dept: Department;
  llm: LlmClient | null;
  provider?: string;
  model?: string;
  locale: string;
  emit: (event: RunEvent) => void;
  /** Pause between scripted demo turns so the map can animate. Defaults to 1200ms in demo mode, 0 with a model. */
  delayMs?: number;
  /** Hard cap on messages per run, including the final summary and review. */
  maxTurns?: number;
  now?: () => number;
  newId?: () => string;
  root?: string;
}

interface Turn {
  kind: HubMessageKind;
  text?: string;
  textKey?: string;
  ask: AgentId[];
}

const DEFAULT_MAX_TURNS = 8;
const MAX_TURNS_PER_AGENT = 2;
const MAX_TEXT = 1200;
const MAX_ASK = 2;
const PEER_KINDS: ReadonlySet<HubMessageKind> = new Set(["plan", "question", "answer", "handoff"]);
const REVIEW_KINDS: ReadonlySet<HubMessageKind> = new Set(["review", "answer"]);
const DECISION_KINDS: ReadonlySet<HubMessageKind> = new Set(["decision"]);

const DEMO_KEY: Record<HubMessageKind, string> = {
  plan: "hub.msg.plan",
  question: "hub.msg.question",
  answer: "hub.msg.answer",
  handoff: "hub.msg.handoff",
  review: "hub.msg.review",
  decision: "hub.msg.approved",
};

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Tags in prompts are our delimiters; strip user angle brackets so text cannot close them. */
const plain = (text: string) => text.replace(/[<>]/g, "").trim();

function extractJson(raw: string): Record<string, unknown> | null {
  const tryParse = (text: string) => {
    try {
      const value: unknown = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  return tryParse(raw.trim()) ?? (raw.match(/\{[\s\S]*\}/) ? tryParse(raw.match(/\{[\s\S]*\}/)![0]) : null);
}

export function parseTurn(
  raw: string,
  hint: HubMessageKind,
  allowed: ReadonlySet<HubMessageKind>,
  dept: Department,
  selfId: AgentId,
): Turn {
  const data = extractJson(raw);
  if (!data) throw new Error("agent turn returned invalid JSON");
  const kindValue = typeof data?.kind === "string" ? (data.kind as HubMessageKind) : undefined;
  const kind = kindValue && allowed.has(kindValue) ? kindValue : hint;
  const text = (typeof data.text === "string" ? data.text : "").trim().slice(0, MAX_TEXT);
  if (!text) throw new Error("agent turn had no text");
  const ask: AgentId[] = [];
  if (Array.isArray(data?.ask)) {
    for (const item of data.ask) {
      // The model may name anyone; only real teammates of this department count.
      if (typeof item === "string" && item !== selfId && dept.agents.some((agent) => agent.id === item) && !ask.includes(item)) ask.push(item);
      if (ask.length >= MAX_ASK) break;
    }
  }
  return { kind, text, ask };
}

class Run {
  turns = 0;
  readonly spoken = new Map<AgentId, number>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly delay: number;

  constructor(
    private readonly deps: RunDeps,
    readonly taskId: string,
    readonly threadId: string,
    readonly title: string,
  ) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => randomUUID().slice(0, 8));
    this.delay = deps.delayMs ?? (deps.llm ? 0 : 1200);
  }

  get maxTurns() {
    return this.deps.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  private text(message: HubMessage): string {
    return message.text ?? (message.textKey ? translate(isLocale(this.deps.locale) ? this.deps.locale : "vi", message.textKey) : "");
  }

  private async transcript(): Promise<string> {
    const { dept, store } = this.deps;
    const name = (id: AgentId) => dept.agents.find((agent) => agent.id === id)?.name ?? id;
    const lines = (await store.hub()).messages.filter((message) => message.threadId === this.threadId)
      .map((message) => `${name(message.from)} [${message.kind}]: ${plain(this.text(message))}`);
    return lines.length ? lines.join("\n") : "(chưa có)";
  }

  /** One agent thinks: its own rules as system prompt, the thread as context. */
  async turn(
    agentId: AgentId,
    instruction: string,
    hint: HubMessageKind,
    options: { allowed?: ReadonlySet<HubMessageKind>; demoKey?: string; note?: string } = {},
  ): Promise<Turn> {
    const { dept, llm, locale, emit } = this.deps;
    const agent = dept.agents.find((item) => item.id === agentId);
    if (!agent) throw new Error("unknown agent");
    emit({ type: "typing", agentId });
    if (!llm) {
      await sleep(this.delay);
      return { kind: hint, textKey: options.demoKey ?? DEMO_KEY[hint], ask: [] };
    }
    const user = [
      `<task>${plain(this.title)}</task>`,
      options.note ? `<note>${plain(options.note).slice(0, 500)}</note>` : "",
      "",
      "Trao đổi trong thread cho tới giờ:",
      await this.transcript(),
      "",
      `Việc của bạn lúc này: ${instruction}`,
    ].filter((line, index) => line || index === 2 || index === 4).join("\n");
    const raw = await llm.complete([
      { role: "system", content: buildSystemPrompt(agent, dept, locale, this.deps.root) },
      { role: "user", content: user },
    ]);
    return parseTurn(raw, hint, options.allowed ?? PEER_KINDS, dept, agentId);
  }

  async say(agentId: AgentId, turn: Turn): Promise<boolean> {
    const { store, emit } = this.deps;
    const message: HubMessage = { id: "msg-" + this.newId(), threadId: this.threadId, from: agentId, kind: turn.kind, textKey: turn.textKey, text: turn.text, at: this.now() };
    const previous = await store.hub();
    const next = postMessage(previous, message);
    if (next === previous) return false;
    await store.commitHub(previous, next);
    this.turns += 1;
    this.spoken.set(agentId, (this.spoken.get(agentId) ?? 0) + 1);
    const thread = next.threads.find((item) => item.id === this.threadId);
    if (thread) emit({ type: "message", message, thread });
    return true;
  }

  async join(agentId: AgentId) {
    const { store, emit } = this.deps;
    const previous = await store.hub();
    const next = joinThread(previous, this.threadId, agentId);
    if (next === previous) return;
    await store.commitHub(previous, next);
    const thread = next.threads.find((item) => item.id === this.threadId);
    if (thread) emit({ type: "thread", thread });
  }

  async close() {
    const { store, emit } = this.deps;
    const previous = await store.hub();
    const next = closeThread(previous, this.threadId);
    await store.commitHub(previous, next);
    const thread = next.threads.find((item) => item.id === this.threadId);
    if (thread) emit({ type: "thread", thread });
  }

  async patchTask(patch: Partial<Pick<Task, "status" | "progress">>): Promise<Task | undefined> {
    const { store, emit } = this.deps;
    const current = await store.getTask(this.taskId);
    if (!current) return undefined;
    const task = { ...current, ...patch };
    await store.saveTask(task);
    emit({ type: "task", task });
    return task;
  }

  async activity(type: "assigned" | "submitted" | "approved" | "returned", agentId: AgentId) {
    this.deps.emit({ type: "activity", activity: await this.deps.store.addActivity({ type, agentId }, this.now()) });
  }

  async review(ownerId: AgentId) {
    const { dept } = this.deps;
    const reviewer = dept.reviewer.id;
    await this.join(reviewer);
    const turn = await this.turn(
      reviewer,
      "Đối chiếu kết quả cuối của owner với yêu cầu ban đầu. Kiểm tra tính đầy đủ, các khẳng định có căn cứ trong thread, giả định và điểm chưa chắc chắn. Nêu rõ tiêu chí chưa đạt; không tuyên bố đã xác minh nếu không có bằng chứng. Trình bày kết luận và phần cần người dùng kiểm tra.",
      "review",
      { allowed: REVIEW_KINDS },
    );
    await this.say(reviewer, turn);
    await this.patchTask({ status: "review", progress: 100 });
    await this.activity("submitted", ownerId);
  }

  /** Any failure ends in a visible message and a task waiting for the user, never a silent hang. */
  async guard(ownerId: AgentId, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      console.error("[agents] run failed:", error instanceof Error ? error.message : "unknown error");
      try {
        await this.say(ownerId, { kind: "question", textKey: "hub.msg.llmError", ask: [] });
      } catch {
        // The thread may already be closed; the task state below is what matters.
      }
      // A failed model run must never appear in the approval queue as a completed review.
      await this.patchTask({ status: "failed", progress: 0 });
      this.deps.emit({ type: "error", code: "agent" });
    }
  }

  /** Decision by the department lead. Falls back to the fixed sentence when the model fails. */
  async decide(approve: boolean, note?: string) {
    const { dept } = this.deps;
    const ceo = dept.ceo.id;
    await this.join(ceo);
    const demoKey = approve ? "hub.msg.approved" : "hub.msg.returned";
    const instruction = approve
      ? "Người dùng đã phê duyệt kết quả. Ghi quyết định ngắn gọn cho Trung tâm dữ liệu."
      : "Người dùng yêu cầu sửa lại. Ghi quyết định ngắn gọn và nói rõ owner cần làm gì.";
    let turn: Turn;
    try {
      turn = await this.turn(ceo, instruction, "decision", { allowed: DECISION_KINDS, demoKey, note });
    } catch {
      turn = { kind: "decision", textKey: demoKey, ask: [] };
    }
    await this.say(ceo, turn);
  }
}

export interface NewTaskInput {
  title: string;
  ownerId: AgentId;
  areas?: AgentId[];
}

export async function runNewTask(deps: RunDeps, input: NewTaskInput): Promise<Task> {
  const { store, dept, emit } = deps;
  const now = deps.now ?? Date.now;
  const id = (deps.newId ?? (() => randomUUID().slice(0, 8)))();
  const task: Task = { ...createTask({ id: "task-" + id, title: input.title, ownerId: input.ownerId, createdAt: now() }), runMode: deps.llm ? "ai" : "demo", provider: deps.llm ? deps.provider ?? "openai-compatible" : undefined, model: deps.llm ? deps.model : undefined };
  const threadId = "thread-" + task.id;
  const participants = relevantAgents(task.title ?? "", input.ownerId, input.areas, dept);

  await store.saveTask(task);
  const previous = await store.hub();
  const next = openThread(previous, { id: threadId, taskId: task.id, topicTitle: task.title, participants });
  await store.commitHub(previous, next);
  emit({ type: "task", task });
  const thread = next.threads.find((item) => item.id === threadId);
  if (thread) emit({ type: "thread", thread });

  const run = new Run(deps, task.id, threadId, task.title ?? "");
  await run.activity("assigned", input.ownerId);

  await run.guard(input.ownerId, async () => {
    const owner = input.ownerId;
    await run.patchTask({ progress: 20 });
    const plan = await run.turn(owner, "Đọc nhiệm vụ trong thẻ <task>, đưa kế hoạch ngắn và nêu rõ cần hỏi hoặc bàn giao ai (trường ask).", "plan");
    await run.say(owner, plan);

    // The lead and the reviewer do not answer in the middle: one coordinates, the other judges at the end.
    const skip = new Set<AgentId>([dept.ceo.id, dept.reviewer.id, owner]);
    const queue: AgentId[] = [];
    for (const agentId of [...participants, ...plan.ask]) {
      if (!skip.has(agentId) && !queue.includes(agentId) && dept.agents.some((agent) => agent.id === agentId)) queue.push(agentId);
    }

    const budget = run.maxTurns - 2; // keep room for the summary and the review
    for (let index = 0; index < queue.length; index += 1) {
      if (run.turns >= budget) break;
      const agentId = queue[index];
      if ((run.spoken.get(agentId) ?? 0) >= MAX_TURNS_PER_AGENT) continue;
      await run.join(agentId);
      const turn = await run.turn(
        agentId,
        "Trả lời hoặc đặt câu hỏi cho owner bằng kiến thức của vai trò bạn. Nếu cần bàn giao hoặc hỏi thêm ai thì ghi vào ask.",
        index === 0 ? "question" : "handoff",
      );
      await run.say(agentId, turn);
      for (const askId of turn.ask) {
        if (!skip.has(askId) && !queue.includes(askId)) queue.push(askId);
      }
      await run.patchTask({ progress: Math.min(85, 20 + 15 * (index + 1)) });
    }

    const summary = await run.turn(owner, "Tổng hợp ý kiến của đồng đội thành câu trả lời hoặc kết quả cuối cho người dùng.", "answer");
    await run.say(owner, summary);
    await run.review(owner);
  });

  return (await store.getTask(task.id)) ?? task;
}

export type ResolveAction = "approve" | "changes";

/** Caller must have checked that the task exists and is in review. */
export async function runResolve(deps: RunDeps, taskId: string, action: ResolveAction, note?: string): Promise<Task | undefined> {
  const { store } = deps;
  const current = await store.getTask(taskId);
  if (!current) return undefined;
  const run = new Run(deps, current.id, "thread-" + current.id, current.title ?? "");
  const owner = current.ownerId;

  if (action === "approve") {
    await run.patchTask({ status: approveTask(current).status, progress: 100 });
    await run.activity("approved", owner);
    await run.decide(true);
    await run.close();
    return await store.getTask(taskId);
  }

  const reopened = requestTaskChanges(current);
  await run.patchTask({ status: reopened.status, progress: reopened.progress });
  await run.activity("returned", owner);
  await run.guard(owner, async () => {
    await run.decide(false, note);
    const revision = await run.turn(owner, "Sửa lại kết quả theo yêu cầu của người dùng và quyết định ở trên, rồi trả lời bản cập nhật.", "answer", { note });
    await run.say(owner, revision);
    await run.review(owner);
  });
  return await store.getTask(taskId);
}

/** Tasks only move from review. Used by the routes before they start streaming. */
export function canResolve(task: Task | undefined): task is Task {
  return task?.status === "review";
}

export type { Department };
