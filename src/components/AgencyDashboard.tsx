"use client";

import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type AgentId, type Department, type DepartmentId, DEPARTMENT_IDS, IT, SOCIAL, avatarStyle, getAgent, getDepartment } from "@/lib/roster";
import { matchedAreas, ownerCandidates } from "@/lib/routing";
import { type Task, type TaskStatus } from "@/lib/tasks";
import { isLocale, Locale, localeOptions, translate } from "@/i18n";

import { type HubState, applyRemote } from "@/lib/hub";
import type { ActivityRecord, DeptSnapshot, RunEvent } from "@/lib/state";
import { seedSnapshot } from "@/lib/seed";

import HubDialog from "./HubDialog";
import TempleMap, { type MapZoomApi } from "./TempleMap";

type DeptRuntime = {
  tasks: Task[];
  activities: ActivityRecord[];
  hub: HubState;
  selectedAgentId: AgentId;
  filter: "all" | "active" | "review";
  areas: AgentId[];
  areasTouched: boolean;
  ownerTouched: boolean;
  ownerChoice: AgentId;
  talkingIds: AgentId[];
  syncPulse: number;
};

function seedRuntime(department: Department): DeptRuntime {
  // Shown until the database answers; identical to what a fresh database is seeded with.
  const seed = seedSnapshot(department.id);
  return {
    ...seed,
    selectedAgentId: department.ceo.id,
    filter: "all",
    areas: [],
    areasTouched: false,
    ownerTouched: false,
    ownerChoice: department.fallback.id,
    talkingIds: [],
    syncPulse: 0,
  };
}

function agentStatus(agentId: AgentId, tasks: Task[]): "ready" | TaskStatus {
  const owned = tasks.filter((task) => task.ownerId === agentId);
  if (owned.some((task) => task.status === "failed")) return "failed";
  if (owned.some((task) => task.status === "active")) return "active";
  if (owned.some((task) => task.status === "review")) return "review";
  if (owned.some((task) => task.status === "complete")) return "complete";
  return "ready";
}

function statusesFor(department: Department, tasks: Task[]) {
  const next: Record<AgentId, "ready" | TaskStatus> = {};
  for (const agent of department.agents) next[agent.id] = agentStatus(agent.id, tasks);
  return next;
}

function departmentOf(agentId: AgentId): Department {
  return IT.agents.some((agent) => agent.id === agentId) ? IT : SOCIAL;
}

function workspaceLabelKey(id: DepartmentId): string {
  return id === "it" ? "office.workspaceIt" : "office.workspaceSocial";
}

const EASE = [0.22, 1, 0.36, 1] as const;
const rise = (index: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.06 + index * 0.07, duration: 0.4, ease: EASE } });

export default function AgencyDashboard() {
  const [locale, setLocale] = useState<Locale>("vi");
  const [workspace, setWorkspace] = useState<DepartmentId>("it");
  const [runtime, setRuntime] = useState<Record<DepartmentId, DeptRuntime>>(() => ({
    it: seedRuntime(IT),
    social: seedRuntime(SOCIAL),
  }));
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [profileAgentId, setProfileAgentId] = useState<AgentId | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [toast, setToast] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [model, setModel] = useState<{ llm: boolean; model: string | null; mode?: "ai" | "demo"; db?: "mysql" | "sqlite" } | null>(null);
  const [running, setRunning] = useState<Record<DepartmentId, boolean>>({ it: false, social: false });
  const [zoomByDept, setZoomByDept] = useState<Record<DepartmentId, number>>({ it: 1, social: 1 });
  const itZoomRef = useRef<MapZoomApi | null>(null);
  const socialZoomRef = useRef<MapZoomApi | null>(null);
  const talkTimers = useRef<Partial<Record<DepartmentId, number>>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const profileDialogRef = useRef<HTMLDialogElement>(null);
  const timeoutRef = useRef<number[]>([]);

  const department = getDepartment(workspace);
  const snap = runtime[workspace];
  const { tasks, activities, hub, selectedAgentId, filter, talkingIds } = snap;
  const agents = department.agents;
  const ceo = department.ceo;
  const fallback = department.fallback;

  const patch = useCallback((id: DepartmentId, update: (current: DeptRuntime) => DeptRuntime) => {
    setRuntime((all) => {
      const next = update(all[id]);
      return next === all[id] ? all : { ...all, [id]: next };
    });
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(locale, key, params), [locale]);
  const detectedAreas = matchedAreas(taskTitle, department);
  const areas = snap.areasTouched ? snap.areas : detectedAreas;
  const candidates = ownerCandidates(areas, department);
  const ownerChoice = snap.ownerTouched && candidates.some((agent) => agent.id === snap.ownerChoice)
    ? snap.ownerChoice
    : candidates[0]?.id ?? fallback.id;
  const teammates = areas.filter((id) => id !== ownerChoice && id !== ceo.id);
  const statuses = statusesFor(department, tasks);
  const activeCount = tasks.filter((task) => task.status === "active").length;
  const reviewCount = tasks.filter((task) => task.status === "review").length;
  const reviewCountFor = (id: DepartmentId) => runtime[id].tasks.filter((task) => task.status === "review").length;
  const pendingTotal = DEPARTMENT_IDS.reduce((sum, id) => sum + reviewCountFor(id), 0);
  const visibleTasks = tasks.filter((task) => filter === "all" || task.status === filter);
  const mapZoom = zoomByDept[workspace];
  const activeZoomRef = workspace === "it" ? itZoomRef : socialZoomRef;
  const handleAgentOpen = useCallback((deptId: DepartmentId, agentId: AgentId) => {
    patch(deptId, (current) => ({ ...current, selectedAgentId: agentId }));
    setProfileAgentId(agentId);
  }, [patch]);

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
    const talk = talkTimers.current;
    return () => {
      window.cancelAnimationFrame(initialPreferenceFrame);
      preference.removeEventListener("change", updatePreference);
      timers.forEach((timer) => window.clearTimeout(timer));
      for (const timer of Object.values(talk)) {
        if (timer !== undefined) window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setMapExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    document.getElementById("overview")?.scrollIntoView({ block: "start" });
    return () => window.removeEventListener("keydown", onKey);
  }, [mapExpanded]);

  const pageLocked = hubOpen || taskDialogOpen || profileAgentId !== null;

  useEffect(() => {
    if (!pageLocked) return;
    const root = document.documentElement;
    const body = document.body;
    const y = window.scrollY;
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = "";
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.paddingRight = "";
      window.scrollTo(0, y);
    };
  }, [pageLocked]);

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
    const dept = departmentOf(profileAgentId);
    setWorkspace(dept.id);
    patch(dept.id, (current) => {
      if (profileAgentId === dept.ceo.id) return { ...current, ownerChoice: dept.fallback.id };
      return {
        ...current,
        ownerChoice: profileAgentId,
        ownerTouched: true,
        areas: current.areas.includes(profileAgentId) ? current.areas : [...current.areas, profileAgentId],
        areasTouched: true,
      };
    });
    setProfileAgentId(null);
    setTaskDialogOpen(true);
  }

  function announce(message: string) {
    setToast(message);
    const timer = window.setTimeout(() => setToast(""), 3200);
    timeoutRef.current.push(timer);
  }

  /** Light up the speakers on the map for a moment and flash the hub pulse. */
  function flash(deptId: DepartmentId, talking: AgentId[]) {
    patch(deptId, (current) => ({ ...current, talkingIds: talking, syncPulse: current.syncPulse + 1 }));
    const previous = talkTimers.current[deptId];
    if (previous !== undefined) window.clearTimeout(previous);
    talkTimers.current[deptId] = window.setTimeout(() => {
      patch(deptId, (current) => ({ ...current, talkingIds: [] }));
    }, 2200);
  }

  /** Apply one thing the server just saved. The database is the source of truth; this only mirrors it as it streams in. */
  function applyEvent(deptId: DepartmentId, event: RunEvent) {
    if (event.type === "typing") {
      flash(deptId, [event.agentId]);
    } else if (event.type === "thread") {
      patch(deptId, (current) => ({ ...current, hub: applyRemote(current.hub, { thread: event.thread }) }));
    } else if (event.type === "message") {
      patch(deptId, (current) => ({ ...current, hub: applyRemote(current.hub, { thread: event.thread, message: event.message }) }));
      flash(deptId, [event.message.from]);
    } else if (event.type === "task") {
      patch(deptId, (current) => ({
        ...current,
        tasks: current.tasks.some((item) => item.id === event.task.id)
          ? current.tasks.map((item) => item.id === event.task.id ? event.task : item)
          : [...current.tasks, event.task],
      }));
    } else if (event.type === "activity") {
      patch(deptId, (current) => ({ ...current, activities: [event.activity, ...current.activities].slice(0, 6) }));
    } else if (event.type === "error") {
      announce(t("messages.agentError"));
    }
  }

  const loadState = useCallback(async (deptId: DepartmentId) => {
    try {
      const response = await fetch(`/api/departments/${deptId}/state`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as DeptSnapshot;
      patch(deptId, (current) => ({ ...current, tasks: data.tasks, activities: data.activities, hub: data.hub }));
    } catch {
      // Offline: keep showing what is on screen.
    }
  }, [patch]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      for (const id of DEPARTMENT_IDS) void loadState(id);
      fetch("/api/health", { cache: "no-store" })
        .then((response) => response.json() as Promise<{ llm: boolean; model: string | null; mode?: "ai" | "demo"; db?: "mysql" | "sqlite" }>)
        .then((data) => setModel(data))
        .catch(() => setModel(null));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadState]);

  /** Send a request that runs agents, then read the NDJSON events as they arrive. */
  async function runStream(deptId: DepartmentId, request: Promise<Response>): Promise<boolean> {
    setRunning((current) => ({ ...current, [deptId]: true }));
    try {
      const response = await request;
      if (!response.ok) {
        announce(t(response.status === 409 ? "messages.agentBusy" : response.status === 429 ? "messages.agentRateLimited" : "messages.agentError"));
        return false;
      }
      const reader = response.body?.getReader();
      if (!reader) return false;
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            try {
              applyEvent(deptId, JSON.parse(line) as RunEvent);
            } catch {
              // Skip a broken line; the final reload below repairs the view.
            }
          }
          newline = buffer.indexOf("\n");
        }
      }
      return true;
    } catch {
      announce(t("messages.agentError"));
      return false;
    } finally {
      setRunning((current) => ({ ...current, [deptId]: false }));
      await loadState(deptId);
    }
  }

  const post = (url: string, method: "POST" | "PATCH", body: unknown) =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || running[workspace]) return;
    const deptId = workspace;
    const dept = department;
    const ownerId = candidates.some((agent) => agent.id === ownerChoice) ? ownerChoice : dept.fallback.id;
    patch(deptId, (current) => ({
      ...current,
      selectedAgentId: ownerId,
      areas: [],
      areasTouched: false,
      ownerTouched: false,
      ownerChoice: dept.fallback.id,
    }));
    setTaskDialogOpen(false);
    setTaskTitle("");
    announce(t("messages.taskCreated"));
    void runStream(deptId, post(`/api/departments/${deptId}/tasks`, "POST", { title, ownerId, areas, locale }));
  }

  function resolveTask(task: Task, approve: boolean) {
    const deptId = workspace;
    if (running[deptId]) return;
    patch(deptId, (current) => ({ ...current, selectedAgentId: task.ownerId }));
    announce(approve ? t("messages.taskApproved") : t("messages.taskReturned"));
    void runStream(deptId, post(`/api/departments/${deptId}/tasks/${task.id}`, "PATCH", { action: approve ? "approve" : "changes", locale }));
  }


  function openApprovalQueue() {
    if (reviewCount === 0) {
      announce(t("messages.noApproval"));
      return;
    }
    patch(workspace, (current) => ({ ...current, filter: "review" }));
    document.getElementById("work-queue")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }

  function showWorkspace(next: DepartmentId) {
    setWorkspace(next);
    document.getElementById("office-map")?.scrollIntoView({ block: "nearest" });
  }

  function showAgent(agentId: AgentId) {
    patch(workspace, (current) => ({ ...current, selectedAgentId: agentId }));
    document.getElementById("agents")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
  }

  function showWorkQueue(event: { preventDefault: () => void }) {
    event.preventDefault();
    document.getElementById("work-queue")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? ceo;
  const profileAgent = profileAgentId ? getAgent(profileAgentId) ?? null : null;
  const profileDepartment = profileAgent ? departmentOf(profileAgent.id) : department;
  const profileStatus = profileAgent ? statusesFor(profileDepartment, runtime[profileDepartment.id].tasks)[profileAgent.id] : "ready";
  const profileStatusText = profileStatus === "ready" || profileStatus === "complete" ? t("roster.statusReady") : profileStatus === "failed" ? t("taskStatus.failed") : profileStatus === "active" ? t("roster.statusWorking") : t("roster.statusReview");
  const profileTasks = profileAgent ? runtime[profileDepartment.id].tasks.filter((task) => task.ownerId === profileAgent.id) : [];

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
          <div className="nav-group">
            <a className={"nav-item active" + (pendingTotal > 0 ? " has-alert" : "")} href="#overview"><span className="nav-icon" aria-hidden="true">◫</span><span>{t("navigation.controlRoom")}</span><span className="nav-count">{String(DEPARTMENT_IDS.length).padStart(2, "0")}</span>{pendingTotal > 0 && <span className="nav-alert nav-alert-compact"><span className="sr-only">{t("navigation.pendingApproval", { count: pendingTotal })}</span></span>}</a>
            <div className="nav-sub" role="tablist" aria-label={t("office.workspacesLabel")}>
              {DEPARTMENT_IDS.map((id) => {
                const pending = reviewCountFor(id);
                return <button type="button" role="tab" key={id} className={"nav-sub-item" + (workspace === id ? " is-on" : "")} aria-selected={workspace === id} aria-controls="office-map" onClick={() => showWorkspace(id)}><span className="nav-sub-label">{t(workspaceLabelKey(id))}</span>{pending > 0 && <span className="nav-alert"><span className="sr-only">{t("navigation.pendingApproval", { count: pending })}</span></span>}</button>;
              })}
            </div>
          </div>
          <div className="nav-group nav-group-agents">
            <a className="nav-item" href="#agents"><span className="nav-icon" aria-hidden="true">◉</span><span>{t("navigation.agentRoster")}</span><span className="nav-count">{String(agents.length).padStart(2, "0")}</span></a>
            <div className="nav-sub" aria-label={t("navigation.agentRoster")}>
              {agents.map((agent) => <button type="button" key={agent.id} className={"nav-sub-item" + (selectedAgentId === agent.id ? " is-on" : "")} aria-pressed={selectedAgentId === agent.id} onClick={() => showAgent(agent.id)}><span className="nav-sub-label">{agent.name}</span></button>)}
            </div>
          </div>
          <a className="nav-item" href="#work-queue" onClick={showWorkQueue}><span className="nav-icon" aria-hidden="true">▤</span><span>{t("navigation.workQueue")}</span><span className="nav-count">{String(tasks.length).padStart(2, "0")}</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card"><span className="connection-dot" /><span><b>DEMO</b><small>Model API · offline</small></span><span className="connection-slash">/</span></div>
          <div className="profile-row"><span className="profile-avatar" style={avatarStyle(ceo)} aria-hidden="true">{ceo.name.slice(0, 1)}</span><span><b>{ceo.name}</b><small>{t("executive.accessTag")}</small></span>
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
          <div className="status-lead col-span-full flex items-center gap-2.5 border-b border-[#34403f] pb-2 @2xl/main:col-auto @2xl/main:border-0 @2xl/main:pb-0"><span className="status-icon" aria-hidden="true">↗</span><span><strong>{activeCount > 0 ? t("dashboard.teamWorking") : reviewCount > 0 ? t("dashboard.awaitingApproval") : t("dashboard.teamReady")}</strong><small>{activeCount > 0 ? t("dashboard.teamWorkingDetail") : t("dashboard.teamReadyDetail", { count: agents.length - 1 })}</small></span></div>
          <div className="status-metric flex min-h-9 flex-col justify-center gap-0.5 @2xl/main:border-l @2xl/main:border-[#34413e] @2xl/main:pl-3"><span>{t("dashboard.activeTasks")}</span><b>{String(activeCount).padStart(2, "0")}</b></div>
          <div className="status-metric flex min-h-9 flex-col justify-center gap-0.5 @2xl/main:border-l @2xl/main:border-[#34413e] @2xl/main:pl-3"><span>{t("dashboard.approvalCount")}</span><b className="approval-number">{String(reviewCount).padStart(2, "0")}</b></div>
          <div className="status-metric flex min-h-9 flex-col justify-center gap-0.5 @2xl/main:border-l @2xl/main:border-[#34413e] @2xl/main:pl-3"><span>{t("dashboard.teamOnline")}</span><b>{String(agents.length).padStart(2, "0")} / {String(agents.length).padStart(2, "0")}</b></div>
        </section>

        <div className="dashboard-grid grid grid-cols-1 items-start gap-[clamp(1rem,1.6vw,1.75rem)] @4xl/main:grid-cols-[minmax(0,1fr)_var(--spacing-rail)]">
          <section className="office-column" aria-labelledby="office-heading">
            <div className="section-heading">
              <div><span className="section-kicker">{t("office.kicker")}</span><h2 id="office-heading">{t("office.title", { count: agents.length })}</h2></div>
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
                  <button type="button" className="zoom-btn" onClick={() => activeZoomRef.current?.zoomOut()} aria-label={t("office.zoomOut")}>−</button>
                  <span className="zoom-readout">{Math.round(mapZoom * 100)}%</span>
                  <button type="button" className="zoom-btn" onClick={() => activeZoomRef.current?.zoomIn()} aria-label={t("office.zoomIn")}>＋</button>
                  <button type="button" className="zoom-btn zoom-reset" onClick={() => activeZoomRef.current?.reset()}>{t("office.zoomReset")}</button>
                </div>
              </div>
            </div>
            <div className="map-workspace-tabs" role="tablist" aria-label={t("office.workspacesLabel")}>
              {DEPARTMENT_IDS.map((id) => <button type="button" role="tab" key={id} className={"map-workspace-tab" + (workspace === id ? " is-on" : "")} aria-selected={workspace === id} aria-controls="office-map" onClick={() => setWorkspace(id)}>{t(workspaceLabelKey(id))}</button>)}
            </div>
            <div className="map-slot">
            <div className="map-frame is-temple" id="office-map" style={{ ["--map-aspect" as string]: `${department.map.width} / ${department.map.height}`, ["--map-ratio" as string]: String(department.map.width / department.map.height) }}>
              {([IT, SOCIAL] as const).map((dept) => {
                const view = runtime[dept.id];
                const hidden = workspace !== dept.id;
                return (
                  <div key={dept.id} className={"map-layer" + (hidden ? " is-hidden" : "")} aria-hidden={hidden} inert={hidden}>
                    <TempleMap
                      agents={dept.agents}
                      statuses={statusesFor(dept, view.tasks)}
                      selectedAgentId={view.selectedAgentId}
                      onAgentOpen={(agentId) => handleAgentOpen(dept.id, agentId)}
                      talkingIds={view.talkingIds}
                      syncPulse={view.syncPulse}
                      onHubOpen={() => setHubOpen(true)}
                      hubLabel={t("hub.title")}
                      scene={dept.map}
                      zoomApiRef={dept.id === "it" ? itZoomRef : socialZoomRef}
                      onZoomChange={(value) => setZoomByDept((current) => current[dept.id] === value ? current : { ...current, [dept.id]: value })}
                    />
                    <div className="map-overlay map-overlay-bottom"><span><i className="legend-dot ready" />{t("office.legendReady")}<i className="legend-dot working" />{t("office.legendWorking")}<i className="legend-dot review" />{t("office.legendReview")}</span></div>
                  </div>
                );
              })}
            </div>
            </div>

            <section className="mt-6" id="agents">
              <div className="section-heading roster-heading"><div><span className="section-kicker">{t("roster.kicker")}</span><h2>{t("roster.title")}</h2></div><button className="text-button" type="button" onClick={() => patch(workspace, (current) => ({ ...current, selectedAgentId: ceo.id }))}>{t("roster.viewAll")} <span aria-hidden="true">↗</span></button></div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-2 @2xl/main:grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
                {agents.map((agent, index) => {
                  const status = statuses[agent.id];
                  const statusText = status === "ready" || status === "complete" ? t("roster.statusReady") : status === "failed" ? t("taskStatus.failed") : status === "active" ? t("roster.statusWorking") : t("roster.statusReview");
                  return <m.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + index * 0.05, duration: 0.35, ease: EASE }} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} className={"agent-card @container/card" + (selectedAgentId === agent.id ? " selected" : "")} type="button" key={agent.id} onClick={() => patch(workspace, (current) => ({ ...current, selectedAgentId: agent.id }))} aria-pressed={selectedAgentId === agent.id}>
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
              <div className="ceo-profile"><span className="ceo-avatar" style={avatarStyle(ceo)} aria-hidden="true">{ceo.name.slice(0, 1)}</span><div><h2 id="ceo-card-title">{ceo.name}</h2><p>{t("executive.subtitle")}</p></div></div>
              <div className="ceo-note"><span className="note-mark" aria-hidden="true">“</span><p>{t("executive.note")}</p></div>
              <button className="outline-button" type="button" onClick={openApprovalQueue}><span>{t("executive.review")}</span><span className="button-badge">{reviewCount}</span></button>
            </m.section>

            <m.section {...rise(1)} className="queue-card @container/queue" id="work-queue" aria-labelledby="queue-title">
              <div className="section-heading compact-heading"><div><span className="section-kicker">{t("queue.kicker")}</span><h2 id="queue-title">{t("queue.title")}</h2></div><button className="small-add" type="button" aria-label={t("dashboard.createTask")} onClick={() => setTaskDialogOpen(true)}>＋</button></div>
              <div className="queue-tabs" role="group" aria-label={t("queue.title")}>
                {(["all", "active", "review"] as const).map((option) => <button className={"queue-tab" + (filter === option ? " selected" : "")} type="button" key={option} aria-pressed={filter === option} onClick={() => patch(workspace, (current) => ({ ...current, filter: option }))}>
                  {t("queue." + option)}{option === "all" ? <span>{String(tasks.length).padStart(2, "0")}</span> : option === "review" ? <span>{reviewCount}</span> : <span>{activeCount}</span>}
                </button>)}
              </div>
              <div className="task-list">
                {visibleTasks.length === 0 && <div className="empty-state">{t("queue.empty")}</div>}
                <AnimatePresence initial={false} mode="popLayout">{visibleTasks.slice().reverse().map((task) => {
                  const owner = getAgent(task.ownerId);
                  const taskLabel = task.titleKey === "custom" ? task.title ?? "" : t("tasks." + task.titleKey);
                  return <m.article layout="position" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.28, ease: EASE }} className={"task-item " + task.status} key={task.id}>
                    <span className="task-marker" />
                    <div className="task-copy"><strong>{taskLabel}</strong>{task.runMode === "ai" && <small>{t("tasks.executionAi", { model: task.model ?? "" })}</small>}{task.runMode === "demo" && <small>{t("tasks.executionDemo")}</small>}<small><span className="mini-agent" style={owner ? avatarStyle(owner) : undefined}>{owner?.name.slice(0, 1)}</span>{owner?.name} · {owner ? t("roles." + owner.role) : ""}</small></div>
                    <span className="task-state @max-[17rem]/queue:max-w-16 @max-[17rem]/queue:text-[0.65rem]">{t("taskStatus." + task.status)}</span>
                    <div className="task-progress"><m.span initial={false} animate={{ width: task.progress + "%" }} transition={{ duration: 0.5, ease: EASE }} /></div>
                    {task.status === "review" && <div className="task-actions"><button type="button" disabled={running[workspace]} onClick={() => resolveTask(task, true)}>{t("tasks.approve")}</button><button type="button" disabled={running[workspace]} onClick={() => resolveTask(task, false)}>{t("tasks.requestChanges")}</button></div>}
                  </m.article>;
                })}</AnimatePresence>
              </div>
              <button className="queue-link" type="button" onClick={() => patch(workspace, (current) => ({ ...current, filter: "all" }))}><span>{t("queue.open")}</span><span aria-hidden="true">→</span></button>
            </m.section>

            <m.section {...rise(2)} className="profile-card" aria-labelledby="profile-title">
              <div className="section-heading compact-heading"><div><span className="section-kicker">{t("roster.team")}</span><h2 id="profile-title">{selectedAgent.name}</h2></div><span className={"profile-status " + statuses[selectedAgent.id]}>{statuses[selectedAgent.id] === "ready" || statuses[selectedAgent.id] === "complete" ? t("roster.statusReady") : statuses[selectedAgent.id] === "failed" ? t("taskStatus.failed") : statuses[selectedAgent.id] === "active" ? t("roster.statusWorking") : t("roster.statusReview")}</span></div>
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
            {!model?.llm && <div className="privacy-note @xl/rail:col-span-full"><span aria-hidden="true">◈</span><p>{t("messages.prototype")}</p></div>}
          </aside>
        </div>
        <footer className="app-footer"><span>ANITECH AGENCY / AGENT OPERATIONS</span><span>{model === null ? "" : model.llm ? t("footer.modelLive", { model: model.model ?? "" }) : t("footer.modelDemo")}{model?.db ? ` · ${t("footer.database", { engine: model.db === "mysql" ? "MySQL" : "SQLite" })}` : ""} · BUILD 0.1.0 · PRIVATE PROTOTYPE</span></footer>
      </main>

      <dialog className="modal task-modal" ref={dialogRef} onClose={() => { setTaskDialogOpen(false); patch(workspace, (current) => ({ ...current, areasTouched: false, ownerTouched: false })); }} aria-labelledby="task-dialog-title">
        <form onSubmit={handleTaskSubmit}>
          <div className="modal-head"><div><span className="section-kicker">{t("tasks.newAssignment")}</span><h2 id="task-dialog-title">{t("tasks.modalTitle")}</h2></div><button className="modal-close" type="button" aria-label={t("tasks.cancel")} onClick={() => setTaskDialogOpen(false)}>×</button></div>
          <label htmlFor="task-input">{t("tasks.label")}</label>
          <textarea id="task-input" value={taskTitle} onChange={(event) => setTaskTitle(event.currentTarget.value)} rows={4} maxLength={240} required placeholder={t(workspace === "social" ? "tasks.placeholderSocial" : "tasks.placeholder")} />
          <div className="modal-hint"><span>{t("tasks.hint", { fallback: fallback.name })}</span><span>{taskTitle.length} / 240</span></div>
          <fieldset className="task-fieldset">
            <legend>{t("tasks.areaLabel")}</legend>
            <div className="task-areas">
              {agents.filter((agent) => agent.id !== ceo.id).map((agent) => {
                const selected = areas.includes(agent.id);
                return (
                  <button className={"task-choice" + (selected ? " selected" : "")} type="button" key={agent.id} aria-pressed={selected} onClick={() => {
                    const nextAreas = areas.includes(agent.id) ? areas.filter((id) => id !== agent.id) : [...areas, agent.id];
                    patch(workspace, (current) => ({ ...current, areasTouched: true, areas: nextAreas }));
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
            <p className="task-owner-summary">
              <span>{t("tasks.leadLabel")}: <strong>{getAgent(ownerChoice)?.name}</strong></span>
              <span>{t("tasks.together")}: <strong>{teammates.length > 0 ? teammates.map((id) => getAgent(id)?.name).filter(Boolean).join(", ") : t("tasks.togetherEmpty")}</strong></span>
            </p>
            <div className="task-owners" role="radiogroup" aria-labelledby="owner-label">
              {candidates.map((agent) => (
                <button className={"task-choice" + (ownerChoice === agent.id ? " selected" : "")} type="button" key={agent.id} role="radio" aria-checked={ownerChoice === agent.id} onClick={() => patch(workspace, (current) => ({ ...current, ownerTouched: true, ownerChoice: agent.id }))}>
                  <span className="mini-agent" style={avatarStyle(agent)}>{agent.name.slice(0, 1)}</span>
                  <span>{agent.name}<small>{areas.length === 0 && agent.id === fallback.id ? t("tasks.defaultOwner", { name: fallback.name }) : t("roles." + agent.role)}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div className="modal-actions"><button className="cancel-button" type="button" onClick={() => setTaskDialogOpen(false)}>{t("tasks.cancel")}</button><button className="primary-button" type="submit" disabled={running[workspace]}><span aria-hidden="true">↗</span>{t("tasks.dispatch")}</button></div>
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
      <HubDialog open={hubOpen} onClose={() => setHubOpen(false)} hub={hub} agents={agents} talkingIds={talkingIds} t={t} />
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
    </LazyMotion></MotionConfig>
  );
}
