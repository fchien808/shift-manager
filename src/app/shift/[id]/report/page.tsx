"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  LaunchKit,
  ShiftPlan,
  ShiftState,
  SocialPost,
} from "@/types/shift";

// Core seed workers that make up the standard Launch Kit. Any task whose
// workerId is NOT in this set is treated as an "Extra Insight" (either a
// synthesized worker from Phase C or a planning-time artifact worker) and
// rendered above the launch kit in the Shift Report.
const CORE_WORKER_IDS = new Set([
  "positioning",
  "marketing-copy",
  "website",
  "social-campaign",
  "cs-docs",
  "verification",
]);

interface ReportData {
  id: string;
  status: string;
  plan?: ShiftPlan;
  state?: ShiftState;
  launchKit?: LaunchKit;
  cost?: {
    byTier: Record<"opus" | "sonnet" | "haiku", { tokens: number; cost: number }>;
    total: { tokens: number; cost: number };
    opusOnlyEstimate: number;
  };
  error?: string;
}

interface ExtraInsight {
  taskId: string;
  workerId: string;
  label: string;
  output: unknown;
}

export default function ReportPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/shift/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setData(d);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <main className="container">Loading report…</main>;
  if (error || !data)
    return (
      <main className="container">
        <div className="error-banner">Could not load report: {error}</div>
        <Link href="/">← Back</Link>
      </main>
    );

  const lk = data.launchKit;
  const cost = data.cost;

  // Collect outputs from non-core workers (synthesized via Phase C or added
  // as planning-time worker calls). These are surfaced as Extra Insights.
  // Prefer state.plan (the final plan after any re-planning) over the
  // top-level plan (which may be the original pre-synthesis plan).
  const extraInsights: ExtraInsight[] = [];
  const activePlan = data.state?.plan ?? data.plan;
  if (activePlan && data.state) {
    for (const task of activePlan.tasks) {
      if (CORE_WORKER_IDS.has(task.workerId)) continue;
      const result = data.state.results[task.id];
      if (!result || result.status !== "completed" || result.output == null) continue;
      extraInsights.push({
        taskId: task.id,
        workerId: task.workerId,
        label: task.label || task.workerId,
        output: result.output,
      });
    }
  }

  return (
    <main className="container">
      <div className="shift-header">
        <div>
          <h1>Shift Report</h1>
          <div className="goal">
            {lk?.positioning.productName ?? "Launch Kit"}
            {" · "}
            Shift {params.id}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/shift/${params.id}`} className="btn btn-ghost">
            ← Live view
          </Link>
          <Link href="/" className="btn">
            New shift
          </Link>
        </div>
      </div>

      {cost && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <h2>Shift Cost</h2>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                ${cost.total.cost.toFixed(4)}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {cost.total.tokens.toLocaleString()} tokens
              </div>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Opus {cost.byTier.opus.tokens.toLocaleString()} ·{" "}
              Sonnet {cost.byTier.sonnet.tokens.toLocaleString()} ·{" "}
              Haiku {cost.byTier.haiku.tokens.toLocaleString()}
            </div>
            <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>
              Opus-only counterfactual:{" "}
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                ${cost.opusOnlyEstimate.toFixed(2)} (
                {(cost.opusOnlyEstimate / Math.max(cost.total.cost, 0.0001)).toFixed(1)}×)
              </span>
            </div>
          </div>
        </div>
      )}

      {extraInsights.length > 0 && (
        <section className="report-section">
          <h2>
            Strategic Insights
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--muted)",
                marginLeft: 10,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {extraInsights.length} worker
              {extraInsights.length === 1 ? "" : "s"} synthesized for this shift
            </span>
          </h2>
          {extraInsights.map((ins) => (
            <ExtraInsightCard key={ins.taskId} insight={ins} />
          ))}
        </section>
      )}

      {!lk && (
        <div className="error-banner">No launch kit produced. {data.error}</div>
      )}

      {lk && (
        <>
          <section className="report-section">
            <h2>Positioning Brief</h2>
            <div className="panel">
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
                {lk.positioning.productName}
              </div>
              <div style={{ color: "var(--muted)", marginBottom: 12 }}>
                {lk.positioning.oneLiner}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Field label="Target user" value={lk.positioning.targetUser} />
                <Field label="Tone" value={lk.positioning.tone} />
                <Field
                  label="Accent color"
                  value={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          background: lk.positioning.accentColor,
                          border: "1px solid var(--border)",
                        }}
                      />
                      {lk.positioning.accentColor}
                    </span>
                  }
                />
                <Field label="Value prop" value={lk.positioning.valueProp} />
              </div>
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                  }}
                >
                  Differentiators
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {lk.positioning.differentiators.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="report-section">
            <WebsitePreview html={lk.website.html} />
          </section>

          <section className="report-section">
            <h2>Marketing Copy</h2>
            <div className="panel">
              <div style={{ fontSize: 22, fontWeight: 600 }}>
                {lk.marketingCopy.headline}
              </div>
              <div style={{ color: "var(--muted)", marginTop: 6 }}>
                {lk.marketingCopy.subhead}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 16,
                  marginTop: 18,
                }}
              >
                {lk.marketingCopy.valueProps.map((vp, i) => (
                  <div key={i} style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{vp.title}</div>
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>{vp.body}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, fontSize: 13, color: "var(--muted)" }}>
                CTA: <strong style={{ color: "var(--text)" }}>{lk.marketingCopy.cta.primary}</strong>
                {" · "}
                {lk.marketingCopy.cta.secondary}
              </div>
            </div>
          </section>

          <section className="report-section">
            <h2>Social Launch Campaign</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
            >
              {lk.socialCampaign.posts.map((p, i) => (
                <SocialCard key={i} post={p} />
              ))}
            </div>
          </section>

          <section className="report-section">
            <h2>Customer Docs</h2>
            <div className="copy-grid">
              <div className="panel">
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Getting Started
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontFamily: "inherit",
                    fontSize: 13,
                    color: "var(--muted)",
                    margin: 0,
                  }}
                >
                  {lk.csDocs.gettingStarted}
                </pre>
              </div>
              <div className="panel">
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  FAQ ({lk.csDocs.faq.length})
                </div>
                {lk.csDocs.faq.map((f, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{f.question}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{f.answer}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="report-section">
            <h2>Verifier Review</h2>
            <div className="panel">
              <div style={{ marginBottom: 12 }}>
                Status:{" "}
                <strong style={{ color: lk.verification.passed ? "var(--haiku)" : "var(--warn)" }}>
                  {lk.verification.passed ? "PASSED" : "ISSUES FLAGGED"}
                </strong>
              </div>
              {lk.verification.issues.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>No issues flagged.</div>
              ) : (
                lk.verification.issues.map((iss, i) => (
                  <div key={i} style={{ marginBottom: 10, fontSize: 13 }}>
                    <strong>[{iss.severity}]</strong> {iss.workerId}: {iss.description}
                    {iss.suggestedFix && (
                      <div style={{ color: "var(--muted)", marginTop: 2 }}>
                        Fix: {iss.suggestedFix}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function WebsitePreview({ html }: { html: string }) {
  const [mode, setMode] = useState<"preview" | "html">("preview");
  const [copied, setCopied] = useState(false);

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // best effort
    }
  }

  function downloadHtml() {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "landing-page.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Landing Page</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div
            style={{
              display: "inline-flex",
              background: "var(--panel-2)",
              borderRadius: 8,
              padding: 3,
              border: "1px solid var(--border)",
            }}
          >
            <TabButton active={mode === "preview"} onClick={() => setMode("preview")}>
              Preview
            </TabButton>
            <TabButton active={mode === "html"} onClick={() => setMode("html")}>
              HTML
            </TabButton>
          </div>
          <button className="btn btn-ghost" onClick={copyHtml}>
            {copied ? "Copied ✓" : "Copy HTML"}
          </button>
          <button className="btn btn-ghost" onClick={downloadHtml}>
            Download .html
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        Drop this file into any CMS or static host. Single file, Tailwind via CDN.
      </div>
      {mode === "preview" ? (
        <iframe
          className="website-frame"
          srcDoc={html}
          title="Landing page"
          sandbox="allow-scripts"
        />
      ) : (
        <pre
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
            maxHeight: 720,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--text)",
            margin: 0,
            whiteSpace: "pre",
          }}
        >
          {html}
        </pre>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "var(--panel)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        border: "none",
        padding: "6px 12px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ExtraInsightCard({ insight }: { insight: ExtraInsight }) {
  const [viewRaw, setViewRaw] = useState(false);
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {titleize(insight.label)}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              marginTop: 2,
            }}
          >
            worker: {insight.workerId} · synthesized
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setViewRaw((v) => !v)}
          style={{ fontSize: 11 }}
        >
          {viewRaw ? "Structured view" : "View raw JSON"}
        </button>
      </div>
      {viewRaw ? (
        <pre
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            maxHeight: 480,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          {JSON.stringify(insight.output, null, 2)}
        </pre>
      ) : (
        <GenericOutputRenderer value={insight.output} depth={0} />
      )}
    </div>
  );
}

function GenericOutputRenderer({
  value,
  depth,
}: {
  value: unknown;
  depth: number;
}) {
  if (value == null) {
    return <span style={{ color: "var(--muted)" }}>—</span>;
  }
  if (typeof value === "string") {
    // Preserve line breaks for prose.
    return (
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
        }}
      >
        {value}
      </div>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span style={{ fontSize: 13 }}>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: "var(--muted)", fontSize: 12 }}>(empty)</span>;
    }
    const allScalar = value.every(
      (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    );
    if (allScalar) {
      return (
        <ul style={{ margin: "4px 0 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          {value.map((v, i) => (
            <li key={i}>{String(v)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div
        style={{
          display: "grid",
          gap: 10,
          marginTop: 4,
        }}
      >
        {value.map((v, i) => (
          <div
            key={i}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <GenericOutputRenderer value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div
        style={{
          display: "grid",
          gap: depth === 0 ? 14 : 8,
          marginTop: depth === 0 ? 0 : 4,
        }}
      >
        {entries.map(([k, v]) => (
          <div key={k}>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 4,
              }}
            >
              {titleize(k)}
            </div>
            <GenericOutputRenderer value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span style={{ fontSize: 13 }}>{String(value)}</span>;
}

function titleize(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

function SocialCard({ post }: { post: SocialPost }) {
  return (
    <div className="social-card">
      {post.imageUrl ? (
        <img src={post.imageUrl} alt={post.platform} />
      ) : (
        <div
          style={{
            height: 200,
            background: "var(--panel-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          (no image)
        </div>
      )}
      <div className="body">
        <div className="platform">{post.platform}</div>
        <div className="title">{post.title}</div>
        <div className="text">{post.body}</div>
      </div>
    </div>
  );
}
