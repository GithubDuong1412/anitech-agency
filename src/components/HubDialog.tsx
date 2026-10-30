"use client";

import { useEffect, useRef, useState } from "react";
import { type Agent, type AgentId, agentName, avatarStyle } from "@/lib/roster";
import { HubState, syncedCount } from "@/lib/hub";

type Props = {
  open: boolean;
  onClose: () => void;
  hub: HubState;
  agents: ReadonlyArray<Agent>;
  talkingIds: readonly AgentId[];
  t: (key: string) => string;
};

export default function HubDialog({ open, onClose, hub, agents, talkingIds, t }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<"all" | AgentId>("all");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const nameOf = (id: AgentId) => agentName(id);
  const agentOf = (id: AgentId) => agents.find((agent) => agent.id === id);
  const threads = hub.threads.filter((thread) => filter === "all" || thread.participants.includes(filter));
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
              <h2 id="hub-dialog-title">{t("hub.title")}</h2>
              <p className="hub-sub">{t("hub.subtitle")}</p>
            </div>
            <button className="modal-close" type="button" aria-label={t("profile.close")} onClick={onClose}>×</button>
          </div>

          <div className="hub-stats">
            <div><span>{t("hub.version")}</span><b>v{hub.version}</b></div>
            <div><span>{t("hub.synced")}</span><b>{synced}/{agents.length}</b></div>
            <div><span>{t("hub.threads")}</span><b>{hub.threads.length}</b></div>
          </div>

          <div className="hub-chips" role="group" aria-label={t("hub.filter")}>
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
          </div>

          <div className="hub-threads">
            {threads.length === 0 && <div className="empty-state">{t("hub.empty")}</div>}
            {threads.slice().reverse().map((thread) => {
              const messages = hub.messages.filter((message) => message.threadId === thread.id);
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
                  <div className="hub-meta is-muted">
                    <span>{t("hub.watching")}</span>
                    {watchers.length === 0 ? <em>-</em> : people(watchers.map((agent) => agent.id), true)}
                  </div>
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
                            <p>{t(message.textKey)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </dialog>
  );
}
