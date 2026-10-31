"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { type Agent, type MapScene } from "@/lib/roster";

export type MapZoomApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

type Props = {
  agents: readonly Agent[];
  statuses: Record<string, string>;
  selectedAgentId: string;
  onAgentOpen?: (id: Agent["id"]) => void;
  /** Agents currently talking through the hub. */
  talkingIds?: readonly string[];
  /** Increments every time the hub syncs; flashes all links once. */
  syncPulse?: number;
  onHubOpen?: () => void;
  hubLabel?: string;
  /** Background, center piece, and link geometry for this floor. */
  scene: MapScene;
  /** Buttons for these actions live outside the map. */
  zoomApiRef?: RefObject<MapZoomApi | null>;
  onZoomChange?: (zoom: number) => void;
};

// Curved path (quadratic) from the hub to a point, bowed upward.
function curvePath(to: { x: number; y: number }, scene: MapScene): string {
  const { hub } = scene.centerMark;
  const aspect = scene.width / scene.height;
  const dx = (to.x - hub.x) * aspect;
  const dy = to.y - hub.y;
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len;
  let py = dx / len;
  if (py > 0) { px = -px; py = -py; }
  const bow = 0.28 * len;
  const cx = hub.x + (to.x - hub.x) / 2 + (px * bow) / aspect;
  const cy = hub.y + dy / 2 + py * bow;
  const X = scene.width / 100;
  const Y = scene.height / 100;
  return `M ${(hub.x * X).toFixed(1)} ${(hub.y * Y).toFixed(1)} Q ${(cx * X).toFixed(1)} ${(cy * Y).toFixed(1)} ${(to.x * X).toFixed(1)} ${(to.y * Y).toFixed(1)}`;
}

// Size of the dot travelling along an active link (SVG units, the map is 819 x 461).
const DOT_RADIUS = 4;

const MIN_ZOOM = 1;
const MAX_ZOOM = 3.5;

export default function TempleMap({ agents, statuses, selectedAgentId, onAgentOpen, talkingIds = [], syncPulse = 0, onHubOpen, hubLabel = "Data hub", scene, zoomApiRef, onZoomChange }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  const clampPan = (p: { x: number; y: number }, z: number) => {
    const el = frameRef.current;
    if (!el) return p;
    const maxX = (el.clientWidth * (z - 1)) / 2;
    const maxY = (el.clientHeight * (z - 1)) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  };

  const applyZoom = (next: number) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    setZoom(z);
    setPan((p) => clampPan(p, z));
  };

  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);

  useEffect(() => {
    if (!zoomApiRef) return;
    zoomApiRef.current = {
      zoomIn: () => applyZoom(zoom * 1.25),
      zoomOut: () => applyZoom(zoom / 1.25),
      reset: () => { setZoom(1); setPan({ x: 0, y: 0 }); },
    };
  });

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setZoom((current) => {
        setPan((p) => clampPan(p, current));
        return current;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => {
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current * Math.exp(-event.deltaY * 0.0015)));
        setPan((p) => clampPan(p, z));
        return z;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
    if (d.moved) setPan(clampPan({ x: d.px + dx, y: d.py + dy }, zoom));
  };
  const onPointerUp = () => {
    window.setTimeout(() => { drag.current = null; }, 0);
  };

  return (
    <div
      ref={frameRef}
      className="temple-map"
      role="img"
      aria-label={scene.ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="temple-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="temple-bg" src={scene.background} alt="" draggable={false} />
        <svg className="temple-links" viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden="true">
          <g key={syncPulse} className={syncPulse > 0 ? "links-pulse" : undefined}>
            {agents.map((agent) => {
              const feet = agent.map;
              const target = { x: feet.x, y: feet.y - feet.height * 0.9 };
              const d = curvePath(target, scene);
              const talking = talkingIds.includes(agent.id);
              return (
                <g key={agent.id}>
                  <path d={d} className={talking ? "is-active" : "is-idle"} style={{ stroke: agent.color }} />
                  {talking && (
                    <circle r={DOT_RADIUS} className="link-dot" style={{ fill: agent.color }}>
                      <animateMotion dur="1.3s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <button
          type="button"
          className={"temple-center" + (talkingIds.length > 0 ? " is-busy" : "")}
          style={{ left: scene.centerMark.x + "%", top: scene.centerMark.y + "%", height: scene.centerMark.height + "cqh" }}
          aria-label={hubLabel}
          onClick={() => { if (!drag.current?.moved) onHubOpen?.(); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={scene.center} alt="" draggable={false} />
        </button>
        {agents.map((agent) => {
          const feet = agent.map;
          const fixed = feet.label;
          const pos = fixed ?? { x: feet.x, y: feet.y - feet.height - 2 };
          const accent = agent.color;
          const status = statuses[agent.id] ?? "ready";
          const selected = selectedAgentId === agent.id;
          return (
            <div key={agent.id} className="temple-anchor-group">
              <button
                type="button"
                className={"temple-char" + (selected ? " is-selected" : "") + (talkingIds.includes(agent.id) ? " is-talking" : "")}
                style={{ left: feet.x + "%", top: feet.y + "%" }}
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => { if (!drag.current?.moved) onAgentOpen?.(agent.id); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={agent.assets.sprite} alt="" draggable={false} style={{ height: feet.height + "cqh" }} />
              </button>
            <div className="temple-anchor" style={{ left: pos.x + "%", top: pos.y + "%", transform: `translate(-50%, ${fixed ? "-50%" : "-100%"}) scale(${1 / zoom})` }}>
              <button
                type="button"
                className={"temple-label" + (selected ? " is-selected" : "")}
                style={{ ["--accent" as string]: accent }}
                onClick={() => { if (!drag.current?.moved) onAgentOpen?.(agent.id); }}
                aria-label={`${agent.title} — ${agent.name}`}
              >
                <span className={"presence-dot temple-dot " + status} />
                <span className="temple-text">
                  <b className="temple-name">{agent.name}</b>
                  <small>{agent.title}</small>
                </span>
              </button>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
