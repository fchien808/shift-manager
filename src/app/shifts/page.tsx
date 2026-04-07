"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ShiftSummary {
  id: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  productName?: string;
  oneLiner?: string;
  goal?: string;
  totalCost?: number;
  totalTokens?: number;
  error?: string;
}

export default function ShiftsIndexPage() {
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shifts")
      .then((r) => r.json())
      .then((d) => setShifts(d.shifts ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="container">
      <div className="shift-header">
        <div>
          <h1>Past Shifts</h1>
          <div className="goal">Every shift this Shift Manager has run.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/workers" className="btn">
            Workers
          </Link>
          <Link href="/" className="btn">
            + New shift
          </Link>
        </div>
      </div>

      {loading && <div style={{ color: "var(--muted)" }}>Loading…</div>}

      {!loading && shifts.length === 0 && (
        <div className="panel" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ color: "var(--muted)", marginBottom: 16 }}>
            No shifts yet. Start one to see it here.
          </div>
          <Link href="/" className="btn">
            Start a shift →
          </Link>
        </div>
      )}

      {shifts.map((s) => (
        <Link
          key={s.id}
          href={`/shift/${s.id}${s.status === "done" ? "/report" : ""}`}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div
            className="panel"
            style={{
              marginBottom: 12,
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 20,
              alignItems: "center",
              transition: "all 120ms ease",
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {s.productName ?? s.goal ?? s.id}
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  marginTop: 4,
                  maxWidth: 640,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.oneLiner ?? s.goal ?? "—"}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 6 }}>
                {new Date(s.startedAt).toLocaleString()} · {s.id}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
              {s.totalCost != null && (
                <div
                  style={{
                    fontWeight: 700,
                    color: "var(--text)",
                    fontSize: 14,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${s.totalCost.toFixed(4)}
                </div>
              )}
              {s.totalTokens != null && (
                <div>{s.totalTokens.toLocaleString()} tokens</div>
              )}
            </div>
            <div>
              <span className={`status-pill ${mapStatus(s.status)}`}>
                {s.status}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </main>
  );
}

function mapStatus(s: string) {
  if (s === "done") return "completed";
  if (s === "failed") return "failed";
  if (s === "planning" || s === "executing") return "running";
  return "pending";
}
