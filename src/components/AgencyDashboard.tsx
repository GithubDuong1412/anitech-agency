"use client";

import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, CEO, REVIEWER, agentByRole, type AgentId, avatarStyle, getAgent } from "@/lib/roster";
import { matchedAreas, ownerCandidates, relevantAgents } from "@/lib/routing";
import { type Task, type TaskStatus, approveTask, createTask, requestTaskChanges } from "@/lib/tasks";
import { isLocale, Locale, localeOptions, translate } from "@/i18n";

import { HubState, closeThread, conversationScript, createHub, joinThread, openThread, postMessage } from "@/lib/hub";

import HubDialog from "./HubDialog";
import TempleMap, { type MapZoomApi } from "./TempleMap";

type ActivityRecord = {
  id: string;
  type: "seed" | "assigned" | "arrived" | "submitted" | "approved" | "returned";
  agentId?: AgentId;
  messageKey?: string;
};

const initialTasks: Task[] = [
  { id: "task-1", titleKey: "catalogApi", ownerId: "sasuke", status: "active", progress: 64, createdAt: 0 },
  { id: "task-2", titleKey: "checkoutTests", ownerId: "goku", status: "review", progress: 100, createdAt: 0 },
];

const initialActivity: ActivityRecord[] = [
  { id: "activity-1", type: "seed", agentId: "sasuke", messageKey: "activity.seedApi" },
  { id: "activity-2", type: "seed", agentId: "goku", messageKey: "activity.seedReview" },
  { id: "activity-3", type: "seed", agentId: "levi", messageKey: "activity.seedTests" },
];

function buildInitialHub(): HubState {
  let hub = createHub();
  hub = openThread(hub, { id: "thread-task-1", taskId: "task-1", topicKey: "catalogApi", participants: ["sasuke", "natsu"] });
  hub = postMessage(hub, { id: "hub-seed-1", threadId: "thread-task-1", from: "sasuke", kind: "plan", textKey: "hub.msg.plan", at: 0 });
  hub = postMessage(hub, { id: "hub-seed-2", threadId: "thread-task-1", from: "natsu", kind: "question", textKey: "hub.msg.question", at: 0 });
  hub = openThread(hub, { id: "thread-task-2", taskId: "task-2", topicKey: "checkoutTests", participants: ["levi", "goku"] });
  hub = postMessage(hub, { id: "hub-seed-3", threadId: "thread-task-2", from: "levi", kind: "handoff", textKey: "hub.msg.handoff", at: 0 });
  hub = postMessage(hub, { id: "hub-seed-4", threadId: "thread-task-2", from: "goku", kind: "review", textKey: "hub.msg.review", at: 0 });
  return hub;
}

function agentStatus(agentId: AgentId, tasks: Task[]): "ready" | TaskStatus {
  const owned = tasks.filter((task) => task.ownerId === agentId);
  if (owned.some((task) => task.status === "active")) return "active";
  if (owned.some((task) => task.status === "review")) return "review";
  if (owned.some((task) => task.status === "complete")) return "complete";
  return "ready";
}

const EASE = [0.22, 1, 0.36, 1] as const;
const rise = (index: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.06 + index * 0.07, duration: 0.4, ease: EASE } });

export default function AgencyDashboard() {
  const [locale, setLocale] = useState<Locale>("vi");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activities, setActivities] = useState<ActivityRecord[]>(initialActivity);
  const [filter, setFilter] = useState<"all" | "active" | "review">("all");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(CEO.id);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [profileAgentId, setProfileAgentId] = useState<AgentId | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const seniorId = agentByRole("senior").id;
  const [areas, setAreas] = useState<AgentId[]>([]);
  const [areasTouched, setAreasTouched] = useState(false);
  const [ownerChoice, setOwnerChoice] = useState(seniorId);
  const [toast, setToast] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hub, setHub] = useState<HubState>(buildInitialHub);
  const [hubOpen, setHubOpen] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapExpanded, setMapExpanded] = useState(false);
  const mapZoomApi = useRef<MapZoomApi | null>(null);
  const [talkingIds, setTalkingIds] = useState<AgentId[]>([]);
  const [syncPulse, setSyncPulse] = useState(0);
  const hubCounterRef = useRef(1);
  const talkTimerRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const profileDialogRef = useRef<HTMLDialogElement>(null);
  const taskCounterRef = useRef(3);
  const activityCounterRef = useRef(4);
  const timeoutRef = useRef<number[]>([]);

  const t = useCallback((key: string) => translate(locale, key), [locale]);
  const detectedKey = useMemo(() => matchedAreas(taskTitle).join("|"), [taskTitle]);
  const candidates = useMemo(() => ownerCandidates(areas), [areas]);
  const teammates = useMemo(() => {
    const related = new Set(areas);
    for (const id of areas) {
      for (const collaborator of getAgent(id)?.collaborators ?? []) related.add(collaborator);
    }
    return relevantAgents(taskTitle, ownerChoice, areas).filter((id) => id !== ownerChoice && related.has(id));
  }, [taskTitle, ownerChoice, areas]);
  const statuses = useMemo(() => {
    const next: Record<AgentId, "ready" | TaskStatus> = {};
    for (const agent of AGENTS) next[agent.id] = agentStatus(agent.id, tasks);
    return next;
  }, [tasks]);
  const activeCount = tasks.filter((task) => task.status === "active").length;
  const reviewCount = tasks.filter((task) => task.status === "review").length;
  const visibleTasks = tasks.filter((task) => filter === "all" || task.status === filter);
  const handleZoomChange = useCallback((value: number) => setMapZoom(value), []);
  const handleAgentOpen = useCallback((agentId: AgentId) => {
    setSelectedAgentId(agentId);
    setProfileAgentId(agentId);
  }, []);

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("agency-locale");
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const initialPreferenceFrame = window.requestAnimationFrame(() => {
      if (savedLocale && isLocale(savedLocale)) setLocale(savedLocale);
      setReducedMotion(preference.matches);
    });
    const updatePreference = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    preference.addEventListener("change", updatePreference);
    const timers = timeoutRef.current;
    return () => {
      window.cancelAnimationFrame(initialPreferenceFrame);
      preference.removeEventListener("change", updatePreference);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (areasTouched) return;
    setAreas(detectedKey ? detectedKey.split("|") : []);
  }, [detectedKey, areasTouched]);

  useEffect(() => {
    if (!candidates.some((agent) => agent.id === ownerChoice)) setOwnerChoice(seniorId);
  }, [candidates, ownerChoice, seniorId]);

  useEffect(() => {
    if (!mapExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setMapExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    document.getElementById("overview")?.scrollIntoView({ block: "start" });
    return () => window.removeEventListener("keydown", onKey);
  }, [mapExpanded]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (taskDialogOpen && !dialog.open) dialog.showModal();
    if (!taskDialogOpen && dialog.open) dialog.close();
  }, [taskDialogOpen]);

  useEffect(() => {
    const dialog = profileDialogRef.current;
    if (!dialog) return;
    if (profileAgentId && !dialog.open) dialog.showModal();
    if (!profileAgentId && dialog.open) dialog.close();
  }, [profileAgentId]);

  function assignToProfileAgent() {
    if (!profileAgentId) return;
    if (profileAgentId === CEO.id) {
      setOwnerChoice(seniorId);
    } else {
      setOwnerChoice(profileAgentId);
      setAreas((current) => current.includes(profileAgentId) ? current : [...current, profileAgentId]);
      setAreasTouched(true);
    }
    setProfileAgentId(null);
    setTaskDialogOpen(true);
  }

  function announce(message: string) {
    setToast(message);
    const timer = window.setTimeout(() => setToast(""), 3200);
    timeoutRef.current.push(timer);
  }

  function recordActivity(type: ActivityRecord["type"], agentId?: AgentId, messageKey?: string) {
    const id = "activity-" + activityCounterRef.current++;
    setActivities((current) => [{ id, type, agentId, messageKey }, ...current].slice(0, 6));
  }

  /** Run a hub action: update the shared hub, flash the sync pulse and light up the speakers. */
  function hubSay(from: AgentId, update: (state: HubState) => HubState, talking: AgentId[]) {
    setHub(update);
    setSyncPulse((value) => value + 1);
    setTalkingIds(talking);
    if (talkTimerRef.current !== null) window.clearTimeout(talkTimerRef.current);
    talkTimerRef.current = window.setTimeout(() => setTalkingIds([]), 2200);
    void from;
  }

  function scheduleHubConversation(threadId: string, ownerId: AgentId, participants: AgentId[]) {
    conversationScript(ownerId, participants).forEach((step, index) => {
      const timer = window.setTimeout(() => {
        const id = "hub-msg-" + hubCounterRef.current++;
        const speakers = index === 0 ? [step.from] : [participants[0], step.from];
        hubSay(step.from, (state) => postMessage(state, { id, threadId, from: step.from, kind: step.kind, textKey: step.textKey, at: Date.now() }), Array.from(new Set(speakers)));
      }, 900 + index * 1300);
      timeoutRef.current.push(timer);
    });
  }

  function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    const ownerId = candidates.some((agent) => agent.id === ownerChoice) ? ownerChoice : seniorId;
    const task = createTask({ id: "task-" + taskCounterRef.current++, title, ownerId });
    setTasks((current) => [...current, task]);
    setTaskDialogOpen(false);
    setTaskTitle("");
    setAreas([]);
    setAreasTouched(false);
    setOwnerChoice(seniorId);
    setSelectedAgentId(ownerId);
    recordActivity("assigned", ownerId);
    announce(t("messages.taskCreated"));

    const threadId = "thread-" + task.id;
    const participants = relevantAgents(title, ownerId, areas);
    hubSay(ownerId, (state) => openThread(state, { id: threadId, taskId: task.id, topicTitle: title, participants }), participants);
    scheduleHubConversation(threadId, ownerId, participants);

    const timer = window.setTimeout(() => {
      setTasks((current) => current.map((item) => item.id === task.id && item.status === "active"
        ? { ...item, status: "review", progress: 100 }
        : item));
      recordActivity("submitted", ownerId);
      const id = "hub-msg-" + hubCounterRef.current++;
      hubSay(REVIEWER.id, (state) => postMessage(joinThread(state, threadId, REVIEWER.id), { id, threadId, from: REVIEWER.id, kind: "review", textKey: "hub.msg.review", at: Date.now() }), [REVIEWER.id, ownerId]);
    }, 5600);
    timeoutRef.current.push(timer);
  }

  function resolveTask(task: Task, approve: boolean) {
    setTasks((current) => current.map((item) => {
      if (item.id !== task.id) return item;
      return approve ? approveTask(item) : requestTaskChanges(item);
    }));
    setSelectedAgentId(task.ownerId);
    recordActivity(approve ? "approved" : "returned", task.ownerId);
    announce(approve ? t("messages.taskApproved") : t("messages.taskReturned"));

    const threadId = "thread-" + task.id;
    const id = "hub-msg-" + hubCounterRef.current++;
    hubSay(CEO.id, (state) => {
      const withCeo = postMessage(joinThread(state, threadId, CEO.id), { id, threadId, from: CEO.id, kind: "decision", textKey: approve ? "hub.msg.approved" : "hub.msg.returned", at: Date.now() });
      return approve ? closeThread(withCeo, threadId) : withCeo;
    }, [CEO.id, task.ownerId]);
  }

  function openApprovalQueue() {
    if (reviewCount === 0) {
      announce(t("messages.noApproval"));
      return;
    }
    setFilter("review");
    document.getElementById("work-queue")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }

  const selectedAgent = getAgent(selectedAgentId) ?? CEO;
  const profileAgent = profileAgentId ? getAgent(profileAgentId) ?? null : null;
  const profileStatus = profileAgent ? statuses[profileAgent.id] : "ready";
  const profileStatusText = profileStatus === "ready" || profileStatus === "complete" ? t("roster.statusReady") : profileStatus === "active" ? t("roster.statusWorking") : t("roster.statusReview");
  const profileTasks = profileAgent ? tasks.filter((task) => task.ownerId === profileAgent.id) : [];

  const agentLabel = (id?: AgentId) => (id ? getAgent(id)?.name : undefined);

  function renderActivity(entry: ActivityRecord) {
    if (entry.type === "seed" && entry.messageKey) return t(entry.messageKey);
    if (entry.type === "assigned") return <>{t("activity.assigned")} <b>{agentLabel(entry.agentId)}</b></>;
    if (entry.type === "arrived") return <><b>{agentLabel(entry.agentId)}</b> {t("activity.arrived")}</>;
    if (entry.type === "submitted") return <><b>{agentLabel(entry.agentId)}</b> {t("activity.submitted")}</>;
    if (entry.type === "approved") return <><b>{agentLabel(entry.agentId)}</b> · {t("tasks.approve")}</>;
    return <><b>{agentLabel(entry.agentId)}</b> · {t("tasks.requestChanges")}</>;
  }

  return (
    <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><div className="min-h-screen">
      <aside className="sidebar" aria-label={t("navigation.controlRoom")}>
        <a className="brand" href="#overview" aria-label={t("app.brand")}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><strong>{t("app.brand")}</strong><small>{t("app.subtitle")}</small></span>
        </a>
        <div className="workspace-label">{t("navigation.workspace")}</div>
        <nav className="main-nav" aria-label={t("navigation.workspace")}>
          <a className="nav-item active" href="#overview"><span className="nav-icon" aria-hidden="true">◫</span><span>{t("navigation.controlRoom")}</span><span className="nav-count">01</span></a>
          <a className="nav-item" href="#agents"><span className="nav-icon" aria-hidden="true">◉</span><span>{t("navigation.agentRoster")}</span><span className="nav-count">{String(AGENTS.length).padStart(2, "0")}</span></a>
          <a className="nav-item" href="#work-queue"><span className="nav-icon" aria-hidden="true">▤</span><span>{t("navigation.workQueue")}</span><span className="nav-count">{String(tasks.length).padStart(2, "0")}</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card"><span className="connection-dot" /><span><b>DEMO</b><small>Model API · offline</small></span><span className="connection-slash">/</span></div>
          <div className="profile-row"><span className="profile-avatar" style={avatarStyle(CEO)} aria-hidden="true">{CEO.name.slice(0, 1)}</span><span><b>{CEO.name}</b><small>{t("executive.accessTag")}</small></span>
            <label className="sr-only" htmlFor="locale-select">{t("app.localeLabel")}</label>
            <select id="locale-select" className="locale-select" value={locale} onChange={(event) => {
              const nextLocale = event.currentTarget.value;
              if (isLocale(nextLocale)) {
                setLocale(nextLocale);
                window.localStorage.setItem("agency-locale", nextLocale);
              }
            }}>
              {localeOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select>
          </div>
        </div>
      </aside>

      <main id="overview" className={"@container/main ml-sidebar px-[clamp(1.25rem,2.4vw,3.5rem)] pb-5 max-[900px]:ml-sidebar-compact max-[620px]:ml-0 max-[620px]:px-3.5 max-[620px]:pb-[4.9rem]" + (mapExpanded ? " is-map-focus" : "")}>
        <header className="topbar">
          <div className="breadcrumbs"><span>{t("app.brand")}</span><span className="crumb-sep">/</span><b>{t("navigation.controlRoom")}</b></div>
          <span className="live-label"><i />{t("dashboard.livePreview")}</span>
        </header>

        <section className="dashboard-intro intro-row flex items-end justify-between gap-3 pt-7 pb-5 max-[620px]:items-start max-[620px]:gap-2 max-[620px]:pt-5 max-[620px]:pb-4">
          <div><div className="eyebrow">{t("dashboard.companyLabel")}</div><h1>{t("app.pageTitle")}</h1><p>{t("app.pageSubtitle")}</p></div>
          <button className="primary-button" type="button" onClick={() => setTaskDialogOpen(true)}><span aria-hidden="true">＋</span>{t("dashboard.createTask")}</button>
        </section>

        <section className="dashboard-status mb-6 grid grid-cols-2 items-center gap-x-2 gap-y-2.5 rounded-card border border-line-soft bg-card px-4 py-2.5 @2xl/main:grid-cols-[minmax(11rem,1.5fr)_repeat(3,minmax(6.5rem,.8fr))] @2xl/main:gap-1 max-[620px]:mb-[1.125rem] max-[620px]:p-2.5" aria-label={t("navigation.controlRoom")}>
          <div className="status-lead col-span-full flex items-center gap-2.5 border-b border-[#34403f] pb-2 @2xl/main:col-auto @2xl/main:border-0 @2xl/main:pb-0"><span className="status-icon" aria-hidden="true">↗</span><span><strong>{activeCount > 0 ? t("dashboard.teamWorking") : reviewCount > 0 ? t("dashboard.awaitingApproval") : t("dashboard.teamReady")}</strong><small>{activeCount > 0 ? t("dashboard.teamWorkingDetail") : t("dashboard.teamReadyDetail")}</small></span></div>
          <div className="status-metric flex min-h-9 flex-col justify-center gap-0.5 @2xl/main:border-l @2xl/main:border-[#34413e] @2xl/main:pl-3"><span>{t("dashboard.activeTasks")}</span><b>{String(activeCount).padStart(2, "0")}</b></div>
          <div className="status-metric flex min-h-9 flex-col justify-center gap-0.5 @2xl/main:border-l @2xl/main:border-[#34413e] @2xl/main:pl-3"><span>{t("dashboard.approvalCount")}</span><b className="approval-number">{String(reviewCount).padStart(2, "0")}</b></div>
          <div className="status-metric flex min-h-9 flex-col justify-center gap-0.5 @2xl/main:border-l @2xl/main:border-[#34413e] @2xl/main:pl-3"><span>{t("dashboard.teamOnline")}</span><b>{String(AGENTS.length).padStart(2, "0")} / {String(AGENTS.length).padStart(2, "0")}</b></div>
        </section>

        <div className="dashboard-grid grid grid-cols-1 items-start gap-[clamp(1rem,1.6vw,1.75rem)] @4xl/main:grid-cols-[minmax(0,1fr)_var(--spacing-rail)]">
          <section className="office-column" aria-labelledby="office-heading">
            <div className="section-heading">
              <div><span className="section-kicker">{t("office.kicker")}</span><h2 id="office-heading">{t("office.title")}</h2></div>
              <div className="map-toolbar">
                <span className="map-hint"><span className="key-cap">3D</span>{t("office.hint")}</span>
                <button type="button" className={"map-expand" + (mapExpanded ? " is-on" : "")} aria-pressed={mapExpanded} aria-label={mapExpanded ? t("office.zoomExit") : t("office.zoomAll")} onClick={() => setMapExpanded((value) => !value)}>
                  {mapExpanded
                    ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2.75V6.5H2.75M9.5 2.75V6.5h3.75M6.5 13.25V9.5H2.75M9.5 13.25V9.5h3.75" /></svg>
                    : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 6.5H2.75V2.75H6.5M9.5 6.5h3.75V2.75H9.5M6.5 9.5H2.75v3.75H6.5M9.5 9.5h3.75v3.75H9.5" /></svg>}
                </button>
              </div>
              <div className="map-zoom-row">
                <div className="scene-zoom-controls" role="group" aria-label={t("office.zoomLabel")}>
                  <button type="button" className="zoom-btn" onClick={() => mapZoomApi.current?.zoomOut()} aria-label={t("office.zoomOut")}>−</button>
                  <span className="zoom-readout">{Math.round(mapZoom * 100)}%</span>
                  <button type="button" className="zoom-btn" onClick={() => mapZoomApi.current?.zoomIn()} aria-label={t("office.zoomIn")}>＋</button>
                  <button type="button" className="zoom-btn zoom-reset" onClick={() => mapZoomApi.current?.reset()}>{t("office.zoomReset")}</button>
                </div>
              </div>
            </div>
            <div className="map-frame is-temple" id="office-map">
              <TempleMap agents={AGENTS} statuses={statuses} selectedAgentId={selectedAgentId} onAgentOpen={handleAgentOpen} talkingIds={talkingIds} syncPulse={syncPulse} onHubOpen={() => setHubOpen(true)} hubLabel={t("hub.title")} t={t} zoomApiRef={mapZoomApi} onZoomChange={handleZoomChange} />
              <div className="map-overlay map-overlay-bottom"><span><i className="legend-dot ready" />{t("office.legendReady")}<i className="legend-dot working" />{t("office.legendWorking")}<i className="legend-dot review" />{t("office.legendReview")}</span></div>
            </div>

            <section className="mt-6" id="agents">
              <div className="section-heading roster-heading"><div><span className="section-kicker">{t("roster.kicker")}</span><h2>{t("roster.title")}</h2></div><button className="text-button" type="button" onClick={() => setSelectedAgentId(CEO.id)}>{t("roster.viewAll")} <span aria-hidden="true">↗</span></button></div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-2 @2xl/main:grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
                {AGENTS.map((agent, index) => {
                  const status = statuses[agent.id];
                  const statusText = status === "ready" || status === "complete" ? t("roster.statusReady") : status === "active" ? t("roster.statusWorking") : t("roster.statusReview");
                  return <m.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + index * 0.05, duration: 0.35, ease: EASE }} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} className={"agent-card @container/card" + (selectedAgentId === agent.id ? " selected" : "")} type="button" key={agent.id} onClick={() => setSelectedAgentId(agent.id)} aria-pressed={selectedAgentId === agent.id}>
                    <span className="agent-avatar" style={avatarStyle(agent)}><span>{agent.name.slice(0, 1)}</span><i className={"presence-dot " + status} /></span>
                    <span className="agent-info"><b>{agent.name}</b><small>{t("roles." + agent.role)}</small><span className="agent-status @max-[7.5rem]/card:hidden"><i className={"status-bullet " + status} />{statusText}</span></span>
                  </m.button>;
                })}
              </div>
            </section>
          </section>

          <aside className="dashboard-rail @container/rail grid grid-cols-1 items-start gap-3.5 @xl/rail:grid-cols-2 max-[620px]:gap-2.5">
            <m.section {...rise(0)} className="ceo-card" aria-labelledby="ceo-card-title">
              <div className="card-topline"><span className="section-kicker">{t("executive.kicker")}</span><span className="access-tag">{t("executive.accessTag")}</span></div>
              <div className="ceo-profile"><span className="ceo-avatar" style={avatarStyle(CEO)} aria-hidden="true">{CEO.name.slice(0, 1)}</span><div><h2 id="ceo-card-title">{CEO.name}</h2><p>{t("executive.subtitle")}</p></div></div>
              <div className="ceo-note"><span className="note-mark" aria-hidden="true">“</span><p>{t("executive.note")}</p></div>
              <button className="outline-button" type="button" onClick={openApprovalQueue}><span>{t("executive.review")}</span><span className="button-badge">{reviewCount}</span></button>
            </m.section>

            <m.section {...rise(1)} className="queue-card @container/queue" id="work-queue" aria-labelledby="queue-title">
              <div className="section-heading compact-heading"><div><span className="section-kicker">{t("queue.kicker")}</span><h2 id="queue-title">{t("queue.title")}</h2></div><button className="small-add" type="button" aria-label={t("dashboard.createTask")} onClick={() => setTaskDialogOpen(true)}>＋</button></div>
              <div className="queue-tabs" role="group" aria-label={t("queue.title")}>
                {(["all", "active", "review"] as const).map((option) => <button className={"queue-tab" + (filter === option ? " selected" : "")} type="button" key={option} aria-pressed={filter === option} onClick={() => setFilter(option)}>
                  {t("queue." + option)}{option === "all" ? <span>{String(tasks.length).padStart(2, "0")}</span> : option === "review" ? <span>{reviewCount}</span> : <span>{activeCount}</span>}
                </button>)}
              </div>
              <div className="task-list">
                {visibleTasks.length === 0 && <div className="empty-state">{t("queue.empty")}</div>}
                <AnimatePresence initial={false} mode="popLayout">{visibleTasks.slice().reverse().map((task) => {
                  const owner = getAgent(task.ownerId);
                  const taskTitle = task.titleKey === "custom" ? task.title ?? "" : t("tasks." + task.titleKey);
                  return <m.article layout="position" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.28, ease: EASE }} className={"task-item " + task.status} key={task.id}>
                    <span className="task-marker" />
                    <div className="task-copy"><strong>{taskTitle}</strong><small><span className="mini-agent" style={owner ? avatarStyle(owner) : undefined}>{owner?.name.slice(0, 1)}</span>{owner?.name} · {owner ? t("roles." + owner.role) : ""}</small></div>
                    <span className="task-state @max-[17rem]/queue:max-w-16 @max-[17rem]/queue:text-[0.65rem]">{t("taskStatus." + task.status)}</span>
                    <div className="task-progress"><m.span initial={false} animate={{ width: task.progress + "%" }} transition={{ duration: 0.5, ease: EASE }} /></div>
                    {task.status === "review" && <div className="task-actions"><button type="button" onClick={() => resolveTask(task, true)}>{t("tasks.approve")}</button><button type="button" onClick={() => resolveTask(task, false)}>{t("tasks.requestChanges")}</button></div>}
                  </m.article>;
                })}</AnimatePresence>
              </div>
              <button className="queue-link" type="button" onClick={() => setFilter("all")}><span>{t("queue.open")}</span><span aria-hidden="true">→</span></button>
            </m.section>

            <m.section {...rise(2)} className="profile-card" aria-labelledby="profile-title">
              <div className="section-heading compact-heading"><div><span className="section-kicker">{t("roster.team")}</span><h2 id="profile-title">{selectedAgent.name}</h2></div><span className={"profile-status " + statuses[selectedAgent.id]}>{statuses[selectedAgent.id] === "ready" || statuses[selectedAgent.id] === "complete" ? t("roster.statusReady") : statuses[selectedAgent.id] === "active" ? t("roster.statusWorking") : t("roster.statusReview")}</span></div>
              <p className="profile-role">{t("roles." + selectedAgent.role)}</p>
              <div className="profile-divider" />
              <div className="profile-detail"><span>{t("roster.focus")}</span><b>{t("focus." + selectedAgent.role)}</b></div>
              <p className="profile-description">{t("profiles." + selectedAgent.role)}</p>
            </m.section>

            <m.section {...rise(3)} className="activity-card @xl/rail:col-start-2 @xl/rail:row-span-2 @xl/rail:row-start-1" aria-labelledby="activity-title">
              <div className="section-heading compact-heading"><div><span className="section-kicker">{t("activity.kicker")}</span><h2 id="activity-title">{t("activity.title")}</h2></div><span className="activity-live"><i />{t("activity.live")}</span></div>
              <ol className="activity-list">
                {activities.map((entry) => <li key={entry.id}><span className="activity-pin" /><div><p>{renderActivity(entry)}</p><time>{t("activity.justNow")}</time></div></li>)}
              </ol>
            </m.section>
            <div className="privacy-note @xl/rail:col-span-full"><span aria-hidden="true">◈</span><p>{t("messages.prototype")}</p></div>
          </aside>
        </div>
        <footer className="app-footer"><span>ANITECH AGENCY / AGENT OPERATIONS</span><span>BUILD 0.1.0 · PRIVATE PROTOTYPE</span></footer>
      </main>

      <dialog className="modal task-modal" ref={dialogRef} onClose={() => { setTaskDialogOpen(false); setAreasTouched(false); }} aria-labelledby="task-dialog-title">
        <form onSubmit={handleTaskSubmit}>
          <div className="modal-head"><div><span className="section-kicker">{t("tasks.newAssignment")}</span><h2 id="task-dialog-title">{t("tasks.modalTitle")}</h2></div><button className="modal-close" type="button" aria-label={t("tasks.cancel")} onClick={() => setTaskDialogOpen(false)}>×</button></div>
          <label htmlFor="task-input">{t("tasks.label")}</label>
          <textarea id="task-input" value={taskTitle} onChange={(event) => setTaskTitle(event.currentTarget.value)} rows={4} maxLength={240} required placeholder={t("tasks.placeholder")} />
          <div className="modal-hint"><span>{t("tasks.hint")}</span><span>{taskTitle.length} / 240</span></div>
          <fieldset className="task-fieldset">
            <legend>{t("tasks.areaLabel")}</legend>
            <div className="task-areas">
              {AGENTS.filter((agent) => agent.id !== CEO.id).map((agent) => {
                const selected = areas.includes(agent.id);
                return (
                  <button className={"task-choice" + (selected ? " selected" : "")} type="button" key={agent.id} aria-pressed={selected} onClick={() => {
                    setAreasTouched(true);
                    setAreas((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id]);
                  }}>
                    <span className="mini-agent" style={avatarStyle(agent)}>{agent.name.slice(0, 1)}</span>
                    <span>{agent.name}<small>{t("roles." + agent.role)}</small></span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="task-fieldset">
            <span id="owner-label">{t("tasks.ownerLabel")}</span>
            <div className="task-owners" role="radiogroup" aria-labelledby="owner-label">
              {candidates.map((agent) => (
                <button className={"task-choice" + (ownerChoice === agent.id ? " selected" : "")} type="button" key={agent.id} role="radio" aria-checked={ownerChoice === agent.id} onClick={() => setOwnerChoice(agent.id)}>
                  <span className="mini-agent" style={avatarStyle(agent)}>{agent.name.slice(0, 1)}</span>
                  <span>{agent.name}<small>{agent.id === seniorId ? t("tasks.defaultOwner") : t("roles." + agent.role)}</small></span>
                </button>
              ))}
            </div>
            <p className="modal-hint task-together">{teammates.length > 0 ? <>{t("tasks.together")} {teammates.map((id) => getAgent(id)?.name).filter(Boolean).join(", ")}</> : t("tasks.togetherNone")}</p>
          </div>
          <div className="modal-actions"><button className="cancel-button" type="button" onClick={() => setTaskDialogOpen(false)}>{t("tasks.cancel")}</button><button className="primary-button" type="submit"><span aria-hidden="true">↗</span>{t("tasks.dispatch")}</button></div>
        </form>
      </dialog>
      <dialog className="modal profile-modal" ref={profileDialogRef} onClose={() => setProfileAgentId(null)} aria-labelledby="profile-dialog-title">
        {profileAgent && <div className="profile-modal-body">
          <div className="modal-head">
            <div className="profile-modal-id">
              <span className="agent-avatar profile-modal-avatar" style={avatarStyle(profileAgent)}><span>{profileAgent.name.slice(0, 1)}</span><i className={"presence-dot " + profileStatus} /></span>
              <div>
                <span className="section-kicker">{t("profile.kicker")}</span>
                <h2 id="profile-dialog-title">{profileAgent.name}</h2>
                <p className="profile-modal-role">{t("roles." + profileAgent.role)}</p>
              </div>
            </div>
            <button className="modal-close" type="button" aria-label={t("profile.close")} onClick={() => setProfileAgentId(null)}>×</button>
          </div>
          <div className="profile-modal-grid">
            <div className="profile-detail"><span>{t("profile.office")}</span><b>{t("office.rooms." + profileAgent.role)}</b></div>
            <div className="profile-detail"><span>{t("profile.status")}</span><b className={"profile-status-text " + profileStatus}>{profileStatusText}</b></div>
            <div className="profile-detail profile-detail-wide"><span>{t("roster.focus")}</span><b>{t("focus." + profileAgent.role)}</b></div>
          </div>
          <p className="profile-description">{t("profiles." + profileAgent.role)}</p>
          <div className="profile-detail"><span>{t("profile.tasks")}</span></div>
          <ul className="profile-task-list">
            {profileTasks.length === 0 && <li className="profile-task-empty">{t("profile.noTasks")}</li>}
            {profileTasks.map((task) => <li key={task.id} className={task.status}>
              <span>{task.titleKey === "custom" ? task.title ?? "" : t("tasks." + task.titleKey)}</span>
              <small>{t("taskStatus." + task.status)}</small>
            </li>)}
          </ul>
          <div className="modal-actions">
            <button className="cancel-button" type="button" onClick={() => setProfileAgentId(null)}>{t("profile.close")}</button>
            <button className="primary-button" type="button" onClick={assignToProfileAgent}><span aria-hidden="true">＋</span>{t("profile.assign")}</button>
          </div>
        </div>}
      </dialog>
      <HubDialog open={hubOpen} onClose={() => setHubOpen(false)} hub={hub} agents={AGENTS} talkingIds={talkingIds} t={t} />
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
    </LazyMotion></MotionConfig>
  );
}
