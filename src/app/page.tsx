"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_PROPOSAL = `# Shift Manager - Product Proposal

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
    <main>
      {/* HERO */}
      <section className="hero">
        <div className="hero-grid-bg" />
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="hero-eyebrow-dot" />
            Research preview · Tiered multi-agent orchestration
          </div>
          <h1 className="hero-headline">
            Start the shift at midnight.
            <br />
            <span className="hero-headline-accent">
              Review finished work at 8am.
            </span>
          </h1>
          <p className="hero-sub">
            Shift Manager delegates a full work shift to a tiered team of Claude
            agents — Opus plans, Sonnet workers execute in parallel, Haiku
            verifies quality — and delivers a single report to your inbox while
            you sleep. No babysitting. No browser tab left open.
          </p>
          <div className="hero-cta-row">
            <a href="#start" className="btn btn-primary">
              Start a shift
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
            <a href="#how-it-works" className="btn btn-ghost-light">
              See how it works
            </a>
          </div>
          <div className="hero-strip">
            <span className="hero-strip-label">Built for teams who ship</span>
            <div className="hero-strip-items">
              <span>Founders</span>
              <span className="dot-sep">·</span>
              <span>Marketers</span>
              <span className="dot-sep">·</span>
              <span>Operators</span>
              <span className="dot-sep">·</span>
              <span>Growth Teams</span>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="section section-alt">
        <div className="section-inner">
          <div className="section-head">
            <p className="section-eyebrow">Why Shift Manager</p>
            <h2 className="section-title">
              Everything you need. Nothing you have to watch.
            </h2>
          </div>
          <div className="value-grid">
            <div className="value-card">
              <div className="value-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <h3>3-6x Lower Cost</h3>
              <p>
                Running Opus end-to-end is expensive. Shift Manager uses a
                tiered architecture so you pay each model only for the work
                it&apos;s suited for. A transparent per-tier dashboard shows
                exactly what you spent vs. an Opus-only counterfactual.
              </p>
            </div>
            <div className="value-card">
              <div className="value-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
                  <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                  <line x1="6" y1="1" x2="6" y2="4" />
                  <line x1="10" y1="1" x2="10" y2="4" />
                  <line x1="14" y1="1" x2="14" y2="4" />
                </svg>
              </div>
              <h3>Close the Laptop</h3>
              <p>
                Kick off a shift, close the laptop, and go to sleep. The
                pipeline runs async — no human in the loop, no prompt-by-prompt
                hand-holding. Your shift either finishes or it tells you why it
                didn&apos;t.
              </p>
            </div>
            <div className="value-card">
              <div className="value-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </div>
              <h3>Reliable, Not a Gamble</h3>
              <p>
                Structured worker contracts define exactly what each Sonnet
                worker must produce, and a dedicated Haiku verifier pass checks
                every output before the report is assembled. You get a
                reviewable artifact, not a pile of scattered files.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="section">
        <div className="section-inner">
          <div className="section-head">
            <p className="section-eyebrow">The architecture</p>
            <h2 className="section-title">
              Opus plans. Sonnet executes. Haiku verifies.
            </h2>
            <p className="section-sub">
              Three models, each doing what it does best. One shift report when
              you wake up.
            </p>
          </div>
          <div className="pipeline">
            <div className="pipeline-line" />
            <div className="pipeline-step pipeline-opus">
              <div className="pipeline-bubble">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <span className="pipeline-tag pipeline-tag-opus">
                <span className="tabular">01</span> Opus Planner
              </span>
              <h3>Decompose the goal</h3>
              <p>
                Opus reads the registry of available workers, decomposes the
                shift into a parallelizable DAG, and synthesizes new workers if
                a capability gap exists.
              </p>
              <code className="pipeline-code">goal → task_graph.json</code>
            </div>
            <div className="pipeline-step pipeline-sonnet">
              <div className="pipeline-bubble">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="6" height="6" rx="1" />
                  <rect x="9" y="3" width="6" height="6" rx="1" />
                  <rect x="16" y="3" width="6" height="6" rx="1" />
                  <rect x="2" y="14" width="6" height="7" rx="1" />
                  <rect x="9" y="14" width="6" height="7" rx="1" />
                  <rect x="16" y="14" width="6" height="7" rx="1" />
                </svg>
              </div>
              <span className="pipeline-tag pipeline-tag-sonnet">
                <span className="tabular">02</span> Sonnet Workers
              </span>
              <h3>Execute in parallel</h3>
              <p>
                Multiple Sonnet workers run independent tasks simultaneously
                against structured contracts. A 6-task shift takes the time of
                its longest worker.
              </p>
              <code className="pipeline-code">tasks[0..n] → outputs[]</code>
            </div>
            <div className="pipeline-step pipeline-haiku">
              <div className="pipeline-bubble">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </div>
              <span className="pipeline-tag pipeline-tag-haiku">
                <span className="tabular">03</span> Haiku Verifier
              </span>
              <h3>Verify &amp; assemble</h3>
              <p>
                Haiku checks every output for quality and brand consistency.
                Passes get assembled into the shift report. Failures are
                flagged with context — never silently dropped.
              </p>
              <code className="pipeline-code">outputs[] → shift_report</code>
            </div>
          </div>
        </div>
      </section>

      {/* START FORM */}
      <section id="start" className="section section-alt">
        <div className="section-inner">
          <div className="section-head">
            <p className="section-eyebrow">Start a shift</p>
            <h2 className="section-title">Hand off your launch.</h2>
            <p className="section-sub">
              Paste a product proposal. Opus plans, Sonnet builds, Haiku
              verifies. ~3 minutes per shift.
            </p>
          </div>
          <div className="panel start-card">
            <h2>Shift input · Product proposal</h2>
            <textarea
              className="proposal"
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              spellCheck={false}
            />
            {error && (
              <div className="error-banner" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
            <div className="row">
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                Shift type:{" "}
                <strong style={{ color: "var(--text)" }}>
                  Launch Kit Generation
                </strong>
                {" · "}
                Est. duration:{" "}
                <strong style={{ color: "var(--text)" }}>~3 minutes</strong>
              </div>
              <button
                className="btn btn-primary"
                disabled={loading}
                onClick={startShift}
              >
                {loading ? "Starting shift…" : "Start shift →"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
