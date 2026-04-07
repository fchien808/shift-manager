"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const DEFAULT_PROPOSAL = `# Claude Shift Manager - Product Proposal

## Problem
Knowledge workers increasingly need agents that can run for hours on batchable, overnight work - research, analysis, content generation - but today's agent products force synchronous babysitting.

## Solution
A delegation platform where users hand off multi-hour "shifts" to a team of Claude agents. An Opus planner decomposes the shift into a DAG. Sonnet workers run tasks in parallel. A Haiku verifier checks brand consistency and quality. Results are assembled into a shift report ready to review.

## Target User
Founders, marketers, and operators who need a batch of coordinated deliverables (positioning, website, launch kit, customer docs) ready by morning without babysitting an agent loop.

## Differentiators
- Tiered multi-agent architecture keeps costs 3-6x lower than Opus-only
- Async-first: start the shift, close the laptop, wake up to a shift report
- Structured worker contracts + verifier pass = reliable multi-hour runs
- Transparent cost dashboard showing per-tier spend vs. the Opus-only counterfactual

## Demo Shift Types (v1)
- Launch Kit generation (this demo)
- Competitive research + brief
- Content campaign (blog + social + email)
`;

export default function LandingPage() {
  const router = useRouter();
  const [proposal, setProposal] = useState(DEFAULT_PROPOSAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startShift() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productProposal: proposal }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const { shiftId } = await res.json();
      router.push(`/shift/${shiftId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <nav
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "flex-end",
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <Link href="/shifts" style={{ color: "var(--muted)" }}>
          Shifts
        </Link>
        <Link href="/workers" style={{ color: "var(--muted)" }}>
          Workers
        </Link>
      </nav>
      <div className="hero">
        <div className="hero-eyebrow">Claude Shift Manager</div>
        <h1>Hand your launch to a team of Claude agents.</h1>
        <p>
          Paste a product proposal. Opus plans, Sonnet builds, Haiku verifies
          — in parallel, on their own. Close the laptop and come back to a
          full Launch Kit.
        </p>
        <div className="hero-pills">
          <div className="hero-pill">
            <span className="hero-pill-dot opus" />
            <div>
              <div className="hero-pill-label">Opus</div>
              <div className="hero-pill-body">Plans the DAG, synthesizes new workers</div>
            </div>
          </div>
          <div className="hero-pill">
            <span className="hero-pill-dot sonnet" />
            <div>
              <div className="hero-pill-label">Sonnet</div>
              <div className="hero-pill-body">Drafts every artifact in parallel</div>
            </div>
          </div>
          <div className="hero-pill">
            <span className="hero-pill-dot haiku" />
            <div>
              <div className="hero-pill-label">Haiku</div>
              <div className="hero-pill-body">Verifies brand consistency</div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel start-card">
        <h2>Shift Input · Product Proposal</h2>
        <textarea
          className="proposal"
          value={proposal}
          onChange={(e) => setProposal(e.target.value)}
          spellCheck={false}
        />
        {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
        <div className="row">
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            Shift type: <strong style={{ color: "var(--text)" }}>Launch Kit Generation</strong>
            {" · "}
            Est. duration: <strong style={{ color: "var(--text)" }}>~3 minutes</strong>
          </div>
          <button className="btn" disabled={loading} onClick={startShift}>
            {loading ? "Starting shift…" : "Start shift →"}
          </button>
        </div>
      </div>
    </main>
  );
}
