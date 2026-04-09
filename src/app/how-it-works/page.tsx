import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works — Shift Manager",
  description:
    "A complete walkthrough of a shift — from the moment you paste your proposal to the report landing in your inbox.",
};

const TIMELINE_STEPS = [
  {
    time: "0:00",
    title: "You paste a proposal",
    body: "Plain text — a product brief, a creative direction, a research question. No special format. The input is the only thing you write for the entire shift.",
    extra: (
      <div className="timeline-code">
        <span className="arrow">→</span>
        <span>
          &quot;Build a launch kit for a delegation platform that runs AI agents overnight...&quot;
        </span>
      </div>
    ),
  },
  {
    time: "0:05",
    title: "Opus reads the worker registry",
    body: "Opus surveys every available worker — their capabilities, contracts, and output formats. It identifies which workers to assign and whether any capability gaps need new workers synthesized.",
    extra: (
      <div className="timeline-chips">
        <span className="tl-chip">
          <span className="dot" />positioning-writer
        </span>
        <span className="tl-chip">
          <span className="dot" />landing-page-writer
        </span>
        <span className="tl-chip">
          <span className="dot" />email-sequence-writer
        </span>
        <span className="tl-chip">
          <span className="dot" />social-post-writer
        </span>
      </div>
    ),
  },
  {
    time: "0:10",
    title: "Task graph is built",
    body: "Opus decomposes the goal into a parallelizable DAG. Tasks that don't depend on each other run simultaneously. The task graph is the blueprint for the entire shift.",
    extra: (
      <div className="timeline-graph">
        <div className="tg-node tg-goal">goal</div>
        <div className="tg-col">
          <div className="tg-node tg-sonnet">positioning</div>
          <div className="tg-node tg-sonnet">landing-copy</div>
          <div className="tg-node tg-sonnet">emails</div>
          <div className="tg-node tg-sonnet">social</div>
        </div>
        <div className="tg-node tg-verify">verify</div>
        <div className="tg-node tg-report">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
      </div>
    ),
  },
  {
    time: "0:12",
    title: "Workers execute in parallel",
    body: "Four Sonnet workers start simultaneously. Each runs against its structured contract with defined inputs, output format, and quality requirements. A 4-task shift takes the time of its longest worker — not the sum.",
    extra: (
      <div className="worker-grid" style={{ maxWidth: 540 }}>
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
    ),
  },
  {
    time: "2:43",
    title: "Haiku verifies every output",
    body: "Each file is checked against its contract's verification rules — minimum word count, required sections, brand voice. Haiku assigns a clear pass or fail with reasoning.",
    extra: (
      <div className="pass-list">
        {["positioning.md", "landing-copy.md", "emails.md", "social-posts.md"].map(
          (name) => (
            <div className="pass-row" key={name}>
              <span className="check">✓</span>
              <span className="name">{name}</span>
              <span className="pass">PASS</span>
            </div>
          )
        )}
      </div>
    ),
  },
  {
    time: "2:58",
    title: "Shift report assembled",
    body: "All verified deliverables are assembled into a single shift report with per-task timing, cost breakdown (tiered vs. Opus-only counterfactual), and links to every output file.",
    extra: (
      <div className="report-summary">
        <div className="report-summary-head">
          <span className="title">Shift Report</span>
          <span className="price">$0.47</span>
        </div>
        <div className="report-summary-meta">
          <div>4 deliverables · 4 of 4 verified</div>
          <div>Total time: 2m 58s · vs Opus-only: $2.82</div>
        </div>
      </div>
    ),
  },
];

const COST_ROWS = [
  { phase: "Planning", opus: "$0.42", shift: "$0.42", tier: "Opus" },
  { phase: "Execution (4 tasks)", opus: "$2.10", shift: "$0.03", tier: "Sonnet" },
  { phase: "Verification", opus: "$0.30", shift: "$0.02", tier: "Haiku" },
];

const FAQS = [
  {
    q: "How long does a shift take?",
    a: "Most shifts complete in 2-5 minutes. A 4-deliverable launch kit typically finishes in ~3 minutes. The total time equals the longest individual worker, not the sum.",
  },
  {
    q: "What if a worker fails?",
    a: "Haiku flags the failure with context — what went wrong and what was expected. The failure is included in your shift report with a clear explanation. Nothing is silently dropped.",
  },
  {
    q: "Can I define custom workers?",
    a: "In v1, Opus can synthesize new workers on demand when a capability gap exists. Custom worker definitions are planned for v2.",
  },
  {
    q: "What does the shift report include?",
    a: "Every verified deliverable, per-task timing, a cost breakdown comparing tiered spend vs. the Opus-only counterfactual, and verification results for each output.",
  },
  {
    q: "Is my data used for training?",
    a: "No. Shift Manager uses the Anthropic API with zero-retention data policies. Your proposals and outputs are not used to train any model.",
  },
];

export default function HowItWorksPage() {
  return (
    <main>
      {/* HERO */}
      <section className="hero how-hero">
        <div className="hero-grid-bg" />
        <div className="hero-glow" />
        <div className="how-hero-content">
          <h1 className="how-hero-title">
            From proposal to{" "}
            <span className="hero-headline-accent">finished report</span> in ~3
            minutes.
          </h1>
          <p className="how-hero-sub">
            A complete walkthrough of what happens when you start a shift —
            from the moment you paste your proposal to the report landing in
            your inbox.
          </p>
        </div>
      </section>

      {/* TIMELINE */}
      <section className="section">
        <div className="section-inner section-inner-narrow">
          <div className="section-head">
            <h2 className="section-title">A shift, step by step</h2>
            <p className="section-sub">
              Follow a real shift from the moment you paste a proposal to the
              report landing in your inbox.
            </p>
          </div>
          <ol className="timeline">
            {TIMELINE_STEPS.map((step) => (
              <li className="timeline-item" key={step.time}>
                <div className="timeline-stamp">{step.time}</div>
                <div className="timeline-body">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  {step.extra}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* COST TABLE */}
      <section className="section section-alt">
        <div className="section-inner section-inner-narrow">
          <div className="section-head">
            <h2 className="section-title">Why tiered is cheaper</h2>
            <p className="section-sub">
              Running Opus end-to-end means paying the most expensive model for
              every token — even simple generation and verification work.
            </p>
          </div>
          <div className="cost-table-wrap">
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Opus-only</th>
                  <th className="shift-col">Shift Manager</th>
                </tr>
              </thead>
              <tbody>
                {COST_ROWS.map((r) => (
                  <tr key={r.phase}>
                    <td>{r.phase}</td>
                    <td className="dim">{r.opus}</td>
                    <td className="good">
                      <span className="val">{r.shift}</span>{" "}
                      <span className="tier">{r.tier}</span>
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="dim strike">$2.82</td>
                  <td className="good">
                    <strong className="val">$0.47</strong>{" "}
                    <span className="tier">6× cheaper</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="cost-footnote">
              Costs are per-shift estimates for a 4-deliverable launch kit.
              Your actual costs are displayed in a transparent per-tier
              dashboard.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div className="section-inner section-inner-narrow">
          <div className="section-head">
            <h2 className="section-title">Common questions</h2>
          </div>
          <div className="faq-list">
            {FAQS.map((f) => (
              <div className="faq-item" key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section section-alt">
        <div className="section-inner cta-block">
          <h2 className="section-title">Ready to hand off your next shift?</h2>
          <p className="section-sub">
            Paste a product proposal and get a verified launch kit in ~3
            minutes.
          </p>
          <div className="cta-buttons">
            <Link href="/#start" className="btn btn-primary">
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
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
