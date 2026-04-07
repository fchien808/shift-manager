"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface WorkerSummary {
  id: string;
  name: string;
  description: string;
  purpose: string;
  tags: string[];
  tier: "opus" | "sonnet" | "haiku";
  status: "active" | "draft" | "deprecated";
  createdBy: "seed" | "synthesis";
  createdAt: number;
  version: number;
  provenance?: { shiftId: string; sourceRequest: string; designedBy: string };
  metrics?: { uses: number; successes: number; lastUsedAt?: number };
  outputFormat: "json" | "html";
}

interface WorkerDetail extends WorkerSummary {
  systemPrompt: string;
  userTemplate: string;
  inputSchema: unknown;
  outputSchema: unknown;
  maxTokens: number;
  temperature: number;
}

type Filter = "all" | "active" | "draft" | "seed" | "synthesized";

export default function WorkersPage() {
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<WorkerDetail | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/workers");
    const data = await res.json();
    setWorkers(data.workers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/workers/${id}`);
    const data = await res.json();
    if (data.worker) setSelected(data.worker as WorkerDetail);
  };

  const approve = async (id: string) => {
    setApproving(id);
    try {
      await fetch(`/api/workers/${id}/approve`, { method: "POST" });
      await load();
      if (selected?.id === id) {
        const r = await fetch(`/api/workers/${id}`);
        const d = await r.json();
        if (d.worker) setSelected(d.worker as WorkerDetail);
      }
    } finally {
      setApproving(null);
    }
  };

  const filtered = workers.filter((w) => {
    if (filter === "all") return true;
    if (filter === "active") return w.status === "active";
    if (filter === "draft") return w.status === "draft";
    if (filter === "seed") return w.createdBy === "seed";
    if (filter === "synthesized") return w.createdBy === "synthesis";
    return true;
  });

  const draftCount = workers.filter((w) => w.status === "draft").length;
  const synthCount = workers.filter((w) => w.createdBy === "synthesis").length;

  return (
    <main className="container">
      <div className="shift-header">
        <div>
          <h1>Workers</h1>
          <div className="goal">
            {workers.length} worker{workers.length === 1 ? "" : "s"} in the
            registry · {synthCount} synthesized · {draftCount} pending approval
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/shifts" className="btn">
            Shifts
          </Link>
          <Link href="/" className="btn">
            + New shift
          </Link>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {(["all", "active", "draft", "seed", "synthesized"] as Filter[]).map(
          (f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="btn"
              style={{
                background: filter === f ? "var(--text)" : "transparent",
                color: filter === f ? "var(--bg)" : "var(--text)",
                border: "1px solid var(--border)",
                textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          )
        )}
      </div>

      {loading && <div style={{ color: "var(--muted)" }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className="panel" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ color: "var(--muted)" }}>No workers match this filter.</div>
        </div>
      )}

      {filtered.map((w) => (
        <div
          key={w.id}
          className="panel"
          style={{
            marginBottom: 12,
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 20,
            alignItems: "center",
            cursor: "pointer",
          }}
          onClick={() => openDetail(w.id)}
        >
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 15,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              {w.name}
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--muted)",
                  fontWeight: 400,
                }}
              >
                {w.id} · v{w.version}
              </span>
            </div>
            <div
              style={{
                color: "var(--muted)",
                fontSize: 12,
                marginTop: 4,
                maxWidth: 720,
              }}
            >
              {w.description}
            </div>
            <div
              style={{
                color: "var(--muted)",
                fontSize: 11,
                marginTop: 6,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span>{w.createdBy === "seed" ? "Seed" : "Synthesized"}</span>
              <span>·</span>
              <span>{w.tier}</span>
              {w.metrics && w.metrics.uses > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {w.metrics.successes}/{w.metrics.uses} ok
                  </span>
                </>
              )}
              {w.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div>
            <span className={`status-pill ${mapPill(w.status)}`}>
              {w.status}
            </span>
          </div>
          <div>
            {w.status === "draft" && (
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  approve(w.id);
                }}
                disabled={approving === w.id}
              >
                {approving === w.id ? "Approving…" : "Approve"}
              </button>
            )}
          </div>
        </div>
      ))}

      {selected && (
        <DetailDrawer
          worker={selected}
          onClose={() => setSelected(null)}
          onApprove={() => approve(selected.id)}
          approving={approving === selected.id}
        />
      )}
    </main>
  );
}

function mapPill(s: string) {
  if (s === "active") return "completed";
  if (s === "draft") return "pending";
  return "failed";
}

function DetailDrawer({
  worker,
  onClose,
  onApprove,
  approving,
}: {
  worker: WorkerDetail;
  onClose: () => void;
  onApprove: () => void;
  approving: boolean;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          background: "var(--bg)",
          borderLeft: "1px solid var(--border)",
          overflowY: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{worker.name}</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "var(--font-mono, monospace)",
                marginTop: 4,
              }}
            >
              {worker.id} · v{worker.version} · {worker.tier} ·{" "}
              {worker.createdBy}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {worker.status === "draft" && (
              <button className="btn" onClick={onApprove} disabled={approving}>
                {approving ? "Approving…" : "Approve"}
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <Section label="Purpose">{worker.purpose}</Section>

        {worker.provenance && (
          <Section label="Provenance">
            <div style={{ fontSize: 12 }}>
              Synthesized from shift{" "}
              <code>{worker.provenance.shiftId}</code> by{" "}
              {worker.provenance.designedBy}.
              <div
                style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}
              >
                {worker.provenance.sourceRequest}
              </div>
            </div>
          </Section>
        )}

        <Section label="Tags">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {worker.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </Section>

        <Section label="Configuration">
          <div
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--muted)",
            }}
          >
            tier={worker.tier} · maxTokens={worker.maxTokens} · temperature=
            {worker.temperature} · format={worker.outputFormat}
          </div>
        </Section>

        <Section label="System Prompt">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 12,
              background: "var(--panel, #0a0a0a)",
              border: "1px solid var(--border)",
              padding: 12,
              borderRadius: 6,
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            {worker.systemPrompt}
          </pre>
        </Section>

        <Section label="User Template">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 12,
              background: "var(--panel, #0a0a0a)",
              border: "1px solid var(--border)",
              padding: 12,
              borderRadius: 6,
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {worker.userTemplate}
          </pre>
        </Section>

        <Section label="Input Schema">
          <pre
            style={{
              fontSize: 11,
              background: "var(--panel, #0a0a0a)",
              border: "1px solid var(--border)",
              padding: 12,
              borderRadius: 6,
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {JSON.stringify(worker.inputSchema, null, 2)}
          </pre>
        </Section>

        <Section label="Output Schema">
          <pre
            style={{
              fontSize: 11,
              background: "var(--panel, #0a0a0a)",
              border: "1px solid var(--border)",
              padding: 12,
              borderRadius: 6,
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {JSON.stringify(worker.outputSchema, null, 2)}
          </pre>
        </Section>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
