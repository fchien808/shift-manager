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
          <div className="hero-left">
            <div className="hero-eyebrow">
              <span className="hero-eyebrow-dot" />
              Research preview · Tiered multi-agent orchestration
            </div>
            <h1 className="hero-headline">
              Start the shift at midnight.{" "}
              <span className="hero-headline-accent">
                Review finished work at 8am.
              </span>
            </h1>
            <p className="hero-sub">
              Hand off a full shift to a team of AI agents. Opus plans, Sonnet
              workers execute in parallel, Haiku verifies. You get a finished
              report — no babysitting, no browser tab left open.
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
              <a href="/how-it-works" className="btn btn-ghost-light">
                See how it works
              </a>
            </div>
          </div>

          {/* Shift Report preview card */}
          <aside className="hero-preview" aria-hidden="true">
            <div className="hero-preview-head">
              <span className="hero-preview-title">Shift Report</span>
              <span className="hero-preview-time">6:42 am</span>
            </div>
            <div className="hero-preview-cost-row">
              <span>Launch Kit Generation</span>
              <span className="hero-preview-cost-value">
                <span className="now">$0.47</span>
                <span className="old">$2.82</span>
              </span>
            </div>
            <div className="hero-preview-items">
              <div className="hero-preview-item">
                <span className="check">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="label">Positioning document</span>
                <span className="tag">Sonnet-1</span>
              </div>
              <div className="hero-preview-item">
                <span className="check">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="label">Landing page copy</span>
                <span className="tag">Sonnet-2</span>
              </div>
              <div className="hero-preview-item">
                <span className="check">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="label">Email sequence (5x)</span>
                <span className="tag">Sonnet-3</span>
              </div>
              <div className="hero-preview-item">
                <span className="check">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="label">Social launch posts</span>
                <span className="tag">Sonnet-4</span>
              </div>
            </div>
            <div className="hero-preview-verify">
              <span className="star">★</span>
              <span>Verified by Haiku</span>
              <span className="pass">4 of 4 passed</span>
            </div>
            <div className="hero-preview-bar" />
            <div className="hero-preview-footer">
              <span>☾ 12:00 am</span>
              <span>agents working</span>
              <span>6:42 am ☀</span>
            </div>
          </aside>
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
            {/* Opus Planner */}
            <div className="pipeline-step pipeline-opus">
              <span className="pipeline-tag pipeline-tag-opus">
                Opus Planner
              </span>
              <h3>Decompose the goal</h3>
              <p>
                Reads available workers, builds a parallelizable task graph,
                synthesizes new workers if needed.
              </p>
              <code className="pipeline-code">goal → task_graph.json</code>
            </div>

            <div className="pipeline-arrow" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </div>

            {/* Sonnet Workers — 2x2 grid */}
            <div className="pipeline-sonnet-group">
              <div className="pipeline-sonnet-title">Sonnet Workers</div>
              <div className="worker-grid">
                <div className="worker-card">
                  <div className="worker-card-head">
                    <span className="wid">worker-1</span>
                    <span className="dur">2m 14s</span>
                  </div>
                  <div className="worker-card-title">Positioning doc</div>
                  <div className="worker-card-bar" />
                </div>
                <div className="worker-card">
                  <div className="worker-card-head">
                    <span className="wid">worker-2</span>
                    <span className="dur">1m 48s</span>
                  </div>
                  <div className="worker-card-title">Landing page</div>
                  <div className="worker-card-bar" />
                </div>
                <div className="worker-card">
                  <div className="worker-card-head">
                    <span className="wid">worker-3</span>
                    <span className="dur">2m 31s</span>
                  </div>
                  <div className="worker-card-title">Email sequence</div>
                  <div className="worker-card-bar" />
                </div>
                <div className="worker-card">
                  <div className="worker-card-head">
                    <span className="wid">worker-4</span>
                    <span className="dur">1m 12s</span>
                  </div>
                  <div className="worker-card-title">Social posts</div>
                  <div className="worker-card-bar" />
                </div>
              </div>
              <div className="pipeline-sonnet-footer">
                tasks run simultaneously — total time = longest worker
              </div>
            </div>

            <div className="pipeline-arrow" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </div>

            {/* Haiku Verifier */}
            <div className="pipeline-step pipeline-haiku">
              <span className="pipeline-tag pipeline-tag-haiku">
                Haiku Verifier
              </span>
              <h3>Verify &amp; assemble</h3>
              <p>
                Checks every output for quality and consistency. Passes get
                assembled; failures flagged with context.
              </p>
              <code className="pipeline-code">outputs[] → shift_report</code>
            </div>

            <div className="pipeline-arrow" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </div>

            {/* Shift Report endpoint */}
            <div className="pipeline-report">
              <div className="pipeline-report-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="13" y2="17" />
                </svg>
              </div>
              <h4>Shift Report</h4>
              <div className="ready">ready at 6:42am</div>
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
