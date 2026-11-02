"use client";

import { useEffect, useRef, useState } from "react";
import { type Agent, type AgentId, agentName, avatarStyle } from "@/lib/roster";
import { HubState, syncedCount } from "@/lib/hub";
import type { Task } from "@/lib/tasks";

type Props = {
  open: boolean;
  onClose: () => void;
  hub: HubState;
  agents: ReadonlyArray<Agent>;
  talkingIds: readonly AgentId[];
  /** Agents whose reply is still being written. */
  thinkingIds: readonly AgentId[];
  /** When set, the dialog shows only this task's conversation. */
  taskId?: string | null;
  task?: Task | null;
  running?: boolean;
  onRetry?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onPurge?: () => void;
  t: (key: string) => string;
};

export default function HubDialog({ open, onClose, hub, agents, talkingIds, thinkingIds, taskId, task, running, onRetry, onDelete, onRestore, onPurge, t }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const threadsRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"all" | AgentId>("all");

  useEffect(() => {
    if (!open || thinkingIds.length === 0) return;
    const list = threadsRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [open, thinkingIds]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const nameOf = (id: AgentId) => agentName(id);
  const agentOf = (id: AgentId) => agents.find((agent) => agent.id === id);
  const focused = Boolean(taskId);
  const threads = hub.threads.filter((thread) => {
    if (taskId) return thread.taskId === taskId;
    return filter === "all" || thread.participants.includes(filter);
  });
  const focusedThread = threads[0];
  const dialogTitle = focusedThread
    ? (focusedThread.topicKey ? t("tasks." + focusedThread.topicKey) : focusedThread.topicTitle ?? t("hub.title"))
    : t("hub.title");
  const synced = syncedCount(hub);

  function people(ids: readonly AgentId[], muted = false) {
    return (
      <ul className={"hub-people" + (muted ? " is-muted" : "")}>
        {ids.map((id) => {
          const agent = agentOf(id);
          return (
            <li key={id}>
              {agent && <span className="mini-agent" style={avatarStyle(agent)}>{agent.name.slice(0, 1)}</span>}
              {nameOf(id)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <dialog
      className="modal hub-modal"
      ref={ref}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      aria-labelledby="hub-dialog-title"
    >
      {open && (
        <div className="hub-body">
          <div className="modal-head hub-head">
            <div>
              <span className="section-kicker">{t("hub.kicker")}</span>
              <h2 id="hub-dialog-title">{dialogTitle}</h2>
              {!focused && <p className="hub-sub">{t("hub.subtitle")}</p>}
            </div>
            <button className="modal-close" type="button" aria-label={t("profile.close")} onClick={onClose}>×</button>
          </div>

          {!focused && <div className="hub-stats">
            <div><span>{t("hub.version")}</span><b>v{hub.version}</b></div>
            <div><span>{t("hub.synced")}</span><b>{synced}/{agents.length}</b></div>
            <div><span>{t("hub.threads")}</span><b>{hub.threads.length}</b></div>
          </div>}

          {!focused && <div className="hub-chips" role="group" aria-label={t("hub.filter")}>
            <button type="button" className={"hub-chip" + (filter === "all" ? " selected" : "")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("hub.all")}</button>
            {agents.map((agent) => (
              <button
                type="button"
                key={agent.id}
                className={"hub-chip" + (filter === agent.id ? " selected" : "") + (talkingIds.includes(agent.id) ? " talking" : "")}
                aria-pressed={filter === agent.id}
                title={"v" + hub.knownVersion[agent.id]}
                onClick={() => setFilter(agent.id)}
              >
                <span className="mini-agent" style={avatarStyle(agent)}>{agent.name.slice(0, 1)}</span>
                {agent.name}
              </button>
            ))}
          </div>}

          <div className="hub-threads" ref={threadsRef}>
            {threads.length === 0 && <div className="empty-state">{t("hub.empty")}</div>}
            {threads.slice().reverse().map((thread) => {
              const messages = hub.messages.filter((message) => message.threadId === thread.id);
              const typingHere = thinkingIds.filter((id) => thread.participants.includes(id));
              const watchers = agents.filter((agent) => !thread.participants.includes(agent.id));
              const title = thread.topicKey ? t("tasks." + thread.topicKey) : thread.topicTitle ?? "";
              return (
                <article className={"hub-thread " + thread.status} key={thread.id}>
                  <header>
                    <strong>{title}</strong>
                    <span className="hub-thread-status">{t("hub.status." + thread.status)}</span>
                  </header>
                  <div className="hub-meta">
                    <span>{t("hub.participants")}</span>
                    {people(thread.participants)}
                  </div>
                  {!focused && <div className="hub-meta is-muted">
                    <span>{t("hub.watching")}</span>
                    {watchers.length === 0 ? <em>-</em> : people(watchers.map((agent) => agent.id), true)}
                  </div>}
                  <ol className="hub-messages">
                    {messages.length === 0 && <li className="hub-message-empty">{t("hub.noMessages")}</li>}
                    {messages.map((message) => {
                      const speaker = agentOf(message.from);
                      return (
                        <li key={message.id} className={"hub-message " + message.kind}>
                          <span className="mini-agent" style={speaker ? avatarStyle(speaker) : undefined}>{nameOf(message.from).slice(0, 1)}</span>
                          <div>
                            <div className="hub-message-meta">
                              <b>{nameOf(message.from)}</b>
                              <em>{t("hub.kind." + message.kind)}</em>
                            </div>
                            <p>{message.text ?? t(message.textKey ?? "")}</p>
                          </div>
                        </li>
                      );
                    })}
                    {typingHere.map((id) => {
                      const speaker = agentOf(id);
                      return (
                        <li key={"typing-" + id} className="hub-typing">
                          <span className="mini-agent" style={speaker ? avatarStyle(speaker) : undefined}>{nameOf(id).slice(0, 1)}</span>
                          <span className="typing-dots" aria-label={t("hub.typing")}><i /><i /><i /></span>
                        </li>
                      );
                    })}
                  </ol>
                </article>
              );
            })}
          </div>
          {focused && task && task.deletedAt && (
            <div className="hub-actions">
              <button type="button" disabled={running} onClick={onRestore}>{t("trash.restore")}</button>
              <button className="danger" type="button" disabled={running} onClick={onPurge}>{t("trash.purge")}</button>
            </div>
          )}
          {focused && task && !task.deletedAt && (
            <div className="hub-actions">
              {task.status === "failed" && <button type="button" disabled={running} onClick={onRetry}>{t("tasks.retry")}</button>}
              <button className="danger" type="button" disabled={running} onClick={onDelete}>{t("tasks.delete")}</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
