"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  ShiftEvent,
  ShiftPlan,
  TokenUsage,
  ModelTier,
} from "@/types/shift";
import type { PlannedTask } from "@/types/worker-spec";

type LaneStatus = "pending" | "running" | "completed" | "failed" | "retrying";

interface LaneState {
  task: PlannedTask;
  status: LaneStatus;
  usage: TokenUsage[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

interface LogLine {
  ts: number;
  tag: string;
  text: string;
}

export default function ShiftPage({ params }: { params: { id: string } }) {
  const shiftId = params.id;
  const [plan, setPlan] = useState<ShiftPlan | null>(null);
  const [lanes, setLanes] = useState<Record<string, LaneState>>({});
  const [log, setLog] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [plannerThought, setPlannerThought] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());

  // Tick elapsed clock
  useEffect(() => {
    const id = setInterval(() => {
      if (!done) setElapsed(Date.now() - startRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [done]);

  // SSE subscription
  useEffect(() => {
    const es = new EventSource(`/api/shift/${shiftId}/stream`);
    es.onmessage = (msg) => {
      let ev: ShiftEvent | { type: "__heartbeat__" } | { type: "__done__" };
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (ev.type === "__heartbeat__") return;
      if (ev.type === "__done__") {
        setDone(true);
        es.close();
        return;
      }
      handleEvent(ev);
    };
    es.onerror = () => {
      // Let the browser reconnect; if the stream actually ended the
      // __done__ message already closed it above.
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  function appendLog(tag: string, text: string) {
    setLog((l) => [...l, { ts: Date.now(), tag, text }].slice(-200));
  }

  function handleEvent(ev: ShiftEvent) {
    switch (ev.type) {
      case "plan_created": {
        setPlan(ev.plan);
        setLanes((prev) => {
          const initial: Record<string, LaneState> = {};
          for (const t of ev.plan.tasks) {
            initial[t.id] = { task: t, status: "pending", usage: [] };
          }
          // Preserve any synthetic entries (e.g. __planning__) that arrived
          // before plan_created so their token usage stays counted.
          for (const [k, v] of Object.entries(prev)) {
            if (!initial[k]) initial[k] = v;
          }
          return initial;
        });
        appendLog("plan", `DAG created · ${ev.plan.tasks.length} tasks`);
        break;
      }
      case "task_started": {
        setLanes((ls) => ({
          ...ls,
          [ev.taskId]: {
            ...ls[ev.taskId],
            status: "running",
            startedAt: Date.now(),
          },
        }));
        appendLog(`▶ ${ev.tier}`, `${ev.taskId} started`);
        break;
      }
      case "task_progress": {
        if (ev.taskId === "__planning__") {
          setPlannerThought(ev.message);
        }
        appendLog("…", `${ev.taskId}: ${ev.message}`);
        break;
      }
      case "task_completed": {
        setLanes((ls) => ({
          ...ls,
          [ev.taskId]: {
            ...ls[ev.taskId],
            status: "completed",
            completedAt: Date.now(),
            usage: [...(ls[ev.taskId]?.usage ?? []), ...ev.usage],
          },
        }));
        const u = ev.usage[0];
        appendLog(
          "✔",
          `${ev.taskId} · ${u ? `${u.inputTokens}in/${u.outputTokens}out · $${u.costUsd.toFixed(4)}` : ""}`
        );
        break;
      }
      case "task_retrying": {
        setLanes((ls) => ({
          ...ls,
          [ev.taskId]: { ...ls[ev.taskId], status: "retrying" },
        }));
        appendLog("↻", `${ev.taskId} retrying · ${ev.reason.slice(0, 80)}`);
        break;
      }
      case "task_failed": {
        setLanes((ls) => ({
          ...ls,
          [ev.taskId]: {
            ...ls[ev.taskId],
            status: "failed",
            error: ev.error,
            completedAt: Date.now(),
          },
        }));
        appendLog("✗", `${ev.taskId} failed: ${ev.error.slice(0, 120)}`);
        break;
      }
      case "verifier_review": {
        appendLog(
          "🔍",
          `Verifier: ${ev.result.passed ? "PASSED" : "ISSUES"} · ${ev.result.issues.length} note(s)`
        );
        break;
      }
      case "blocker_raised": {
        appendLog("⚠", `[${ev.blocker.severity}] ${ev.blocker.description}`);
        break;
      }
      case "shift_completed": {
        appendLog("🎉", "Shift completed");
        setDone(true);
        break;
      }
      case "shift_failed": {
        setFailed(ev.error);
        setDone(true);
        appendLog("💥", `Shift failed: ${ev.error}`);
        break;
      }
    }
  }

  const orderedTasks = useMemo(() => {
    if (!plan) return [];
    return plan.tasks;
  }, [plan]);

  const cost = useMemo(() => summarizeCost(lanes), [lanes]);

  return (
    <main className="container">
      <div className="shift-header">
        <div>
          <h1>Shift in progress</h1>
          <div className="goal">
            {plan?.goal ?? (plannerThought ?? "Opus planner is decomposing the shift…")}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 24,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
            }}
          >
            {formatElapsed(elapsed)}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>elapsed</div>
        </div>
      </div>

      {failed && (
        <div className="error-banner">Shift failed: {failed}</div>
      )}

      <div className="shift-grid">
        <div>
          {plan && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <h2>Task Graph</h2>
              <DagView plan={plan} lanes={lanes} />
            </div>
          )}

          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>Worker Lanes</h2>
            {!plan && (
              <div style={{ color: "var(--muted)", padding: "12px 0" }}>
                <span className="planner-pulse">●</span>{" "}
                {plannerThought ?? "Planner is running…"}
              </div>
            )}
            {orderedTasks.map((t) => {
              const lane = lanes[t.id];
              return <Lane key={t.id} task={t} lane={lane} />;
            })}
          </div>

          <div className="panel">
            <h2>Event Log</h2>
            <div className="event-log">
              {log.map((l, i) => (
                <div className="ev" key={i}>
                  <span className="ts">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>{" "}
                  <span className="tag">{l.tag}</span> {l.text}
                </div>
              ))}
              {log.length === 0 && (
                <div style={{ color: "var(--muted)" }}>Waiting for events…</div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="panel cost-card">
            <h2>Cost Dashboard</h2>
            <div className="big-number">${cost.total.toFixed(4)}</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14 }}>
              {cost.totalTokens.toLocaleString()} tokens this shift
            </div>
            <TierRow name="Opus" tier="opus" tokens={cost.byTier.opus.tokens} cost={cost.byTier.opus.cost} />
            <TierRow name="Sonnet" tier="sonnet" tokens={cost.byTier.sonnet.tokens} cost={cost.byTier.sonnet.cost} />
            <TierRow name="Haiku" tier="haiku" tokens={cost.byTier.haiku.tokens} cost={cost.byTier.haiku.cost} />

            <div className="comparison">
              <div>Opus-only counterfactual</div>
              <div style={{ marginTop: 4 }}>
                <span className="ratio">{cost.opusOnlyRatio.toFixed(1)}×</span>{" "}
                more expensive (~${cost.opusOnlyEstimate.toFixed(2)})
              </div>
            </div>
          </div>

          {done && !failed && (
            <div className="panel" style={{ marginTop: 16, textAlign: "center" }}>
              <div style={{ marginBottom: 12, fontSize: 13 }}>
                Shift complete.
              </div>
              <Link href={`/shift/${shiftId}/report`} className="btn" style={{ display: "inline-block" }}>
                View Shift Report →
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ============================================================
// DAG Visualization
// Computes a simple topological layering and draws nodes + edges
// as SVG. No external graph library - keeps the bundle small and
// the layout deterministic so the demo always looks the same.
// ============================================================
function DagView({
  plan,
  lanes,
}: {
  plan: ShiftPlan;
  lanes: Record<string, LaneState>;
}) {
  const layout = useMemo(() => computeDagLayout(plan.tasks), [plan.tasks]);

  const NODE_W = 150;
  const NODE_H = 46;
  const H_GAP = 24;
  const V_GAP = 48;

  // Figure out total canvas size
  const maxPerLevel = Math.max(
    ...layout.levels.map((level) => level.length),
    1
  );
  const width = maxPerLevel * (NODE_W + H_GAP) + H_GAP;
  const height =
    layout.levels.length * (NODE_H + V_GAP) + V_GAP;

  // Compute positions keyed by task id
  const positions: Record<string, { x: number; y: number }> = {};
  layout.levels.forEach((level, li) => {
    const rowW = level.length * (NODE_W + H_GAP) - H_GAP;
    const startX = (width - rowW) / 2;
    level.forEach((taskId, i) => {
      positions[taskId] = {
        x: startX + i * (NODE_W + H_GAP),
        y: V_GAP / 2 + li * (NODE_H + V_GAP),
      };
    });
  });

  // Build edges from task dependencies
  const edges: Array<{ from: string; to: string }> = [];
  for (const t of plan.tasks) {
    for (const dep of t.dependsOn) {
      if (positions[dep] && positions[t.id]) {
        edges.push({ from: dep, to: t.id });
      }
    }
  }

  function tierColor(tier: string) {
    if (tier === "opus") return "var(--opus)";
    if (tier === "sonnet") return "var(--sonnet)";
    return "var(--haiku)";
  }

  return (
    <div style={{ overflowX: "auto", padding: "4px 0" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", minWidth: "100%" }}
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3a4253" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((e, i) => {
          const from = positions[e.from];
          const to = positions[e.to];
          if (!from || !to) return null;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const midY = (y1 + y2) / 2;
          const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2 - 2}`;
          const toLane = lanes[e.to];
          const active =
            toLane?.status === "running" || toLane?.status === "retrying";
          return (
            <path
              key={i}
              d={path}
              fill="none"
              stroke={active ? "var(--accent)" : "#3a4253"}
              strokeWidth={active ? 2 : 1.25}
              opacity={active ? 0.95 : 0.7}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {/* Nodes */}
        {plan.tasks.map((t) => {
          const pos = positions[t.id];
          if (!pos) return null;
          const lane = lanes[t.id];
          const status = lane?.status ?? "pending";
          const stroke = tierColor(t.tier);
          const isRunning = status === "running" || status === "retrying";
          const isDone = status === "completed";
          const isFailed = status === "failed";
          return (
            <g key={t.id} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                fill={isRunning ? "rgba(255,107,53,0.08)" : "var(--panel-2)"}
                stroke={
                  isRunning
                    ? "var(--accent)"
                    : isDone
                    ? "rgba(74,222,128,0.6)"
                    : isFailed
                    ? "var(--danger)"
                    : stroke + "44"
                }
                strokeWidth={isRunning ? 2 : 1.25}
              >
                {isRunning && (
                  <animate
                    attributeName="stroke-opacity"
                    values="1;0.4;1"
                    dur="1.6s"
                    repeatCount="indefinite"
                  />
                )}
              </rect>
              {/* Tier dot */}
              <circle cx={12} cy={NODE_H / 2} r={4} fill={stroke} />
              {/* Task type */}
              <text
                x={22}
                y={NODE_H / 2 - 3}
                fontSize={11}
                fontWeight={600}
                fill="var(--text)"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {truncate(t.workerId.replace(/-/g, " "), 16)}
              </text>
              {/* Tier label */}
              <text
                x={22}
                y={NODE_H / 2 + 11}
                fontSize={9}
                fill="var(--muted)"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                letterSpacing="0.04em"
              >
                {t.tier.toUpperCase()}
              </text>
              {/* Status check/X */}
              {isDone && (
                <text
                  x={NODE_W - 12}
                  y={NODE_H / 2 + 4}
                  fontSize={13}
                  textAnchor="end"
                  fill="var(--haiku)"
                >
                  ✓
                </text>
              )}
              {isFailed && (
                <text
                  x={NODE_W - 12}
                  y={NODE_H / 2 + 4}
                  fontSize={13}
                  textAnchor="end"
                  fill="var(--danger)"
                >
                  ✗
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function computeDagLayout(tasks: PlannedTask[]): {
  levels: string[][];
} {
  const byId: Record<string, PlannedTask> = {};
  for (const t of tasks) byId[t.id] = t;

  const memo: Record<string, number> = {};
  function levelOf(id: string): number {
    if (memo[id] != null) return memo[id];
    const t = byId[id];
    if (!t || t.dependsOn.length === 0) {
      memo[id] = 0;
      return 0;
    }
    const l = 1 + Math.max(...t.dependsOn.map((d) => levelOf(d)));
    memo[id] = l;
    return l;
  }

  const levels: string[][] = [];
  for (const t of tasks) {
    const l = levelOf(t.id);
    while (levels.length <= l) levels.push([]);
    levels[l].push(t.id);
  }
  return { levels };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function Lane({ task, lane }: { task: PlannedTask; lane?: LaneState }) {
  const status = lane?.status ?? "pending";
  const activeClass =
    status === "running" || status === "retrying"
      ? "active"
      : status === "completed"
      ? "done"
      : status === "failed"
      ? "failed"
      : "";
  const usage = lane?.usage[0];
  const duration =
    lane?.startedAt && lane?.completedAt
      ? ((lane.completedAt - lane.startedAt) / 1000).toFixed(1) + "s"
      : lane?.startedAt
      ? "…"
      : "";

  return (
    <div className={`lane ${activeClass}`}>
      <div>
        <span className={`tier-badge ${task.tier}`}>{task.tier}</span>
      </div>
      <div className="lane-body">
        <div className="task-id">
          {task.id} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {task.workerId}</span>
        </div>
        <div className="task-desc">{task.description}</div>
      </div>
      <div className="lane-meta">
        <span className={`status-pill ${status}`}>{status}</span>
        <div style={{ marginTop: 4 }}>
          {duration && <span>{duration}</span>}
          {usage && (
            <span className="cost" style={{ marginLeft: 8 }}>
              ${usage.costUsd.toFixed(4)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TierRow({
  name,
  tier,
  tokens,
  cost,
}: {
  name: string;
  tier: ModelTier;
  tokens: number;
  cost: number;
}) {
  return (
    <div className="tier-row">
      <div className="tier-name">
        <span className={`swatch ${tier}`} />
        {name}
      </div>
      <div className="tier-value">
        {tokens.toLocaleString()} tok · ${cost.toFixed(4)}
      </div>
    </div>
  );
}

function summarizeCost(lanes: Record<string, LaneState>) {
  const byTier = {
    opus: { tokens: 0, cost: 0 },
    sonnet: { tokens: 0, cost: 0 },
    haiku: { tokens: 0, cost: 0 },
  };
  for (const l of Object.values(lanes)) {
    for (const u of l.usage) {
      byTier[u.tier].tokens += u.inputTokens + u.outputTokens;
      byTier[u.tier].cost += u.costUsd;
    }
  }
  const totalTokens = byTier.opus.tokens + byTier.sonnet.tokens + byTier.haiku.tokens;
  const total = byTier.opus.cost + byTier.sonnet.cost + byTier.haiku.cost;
  const estOutput = totalTokens * 0.4;
  const estInput = totalTokens * 0.6;
  const opusOnlyEstimate = (estOutput / 1_000_000) * 75 + (estInput / 1_000_000) * 15;
  const opusOnlyRatio = total > 0 ? opusOnlyEstimate / total : 0;
  return { byTier, total, totalTokens, opusOnlyEstimate, opusOnlyRatio };
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
