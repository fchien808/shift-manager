/**
 * End-to-end test script for the Shift Manager orchestrator.
 *
 * Reads the Shift Manager product proposal from disk (the meta demo input),
 * runs the full planner -> workers -> verifier -> assembly pipeline,
 * and dumps the resulting Launch Kit to ./artifacts/
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npm run orchestrator:test
 *
 * Optional:
 *   FAL_API_KEY=...  - enables real image generation (otherwise uses placeholders)
 */

import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import { planShift } from "../src/orchestrator/planner";
import { runShift, summarizeCost } from "../src/orchestrator/supervisor";
import { ShiftEvent } from "../src/types/shift";

const PROPOSAL_PATH = path.resolve(
  __dirname,
  "../../02_Product_Proposal.md"
);
const ARTIFACTS_DIR = path.resolve(__dirname, "../artifacts");

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  console.log("📖 Loading product proposal from", PROPOSAL_PATH);
  const productProposal = await fs.readFile(PROPOSAL_PATH, "utf-8");
  console.log(`   Loaded ${productProposal.length} chars\n`);

  const shiftId = `shift-${Date.now()}`;
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  const shiftDir = path.join(ARTIFACTS_DIR, shiftId);
  await fs.mkdir(shiftDir, { recursive: true });

  // ============ PLANNING ============
  console.log("🧠 [Opus] Planning shift...");
  const planStart = Date.now();
  const { plan, usage: plannerUsage, artifacts: planningArtifacts } = await planShift(shiftId, productProposal);
  const planMs = Date.now() - planStart;
  console.log(`   Plan created in ${(planMs / 1000).toFixed(1)}s`);
  console.log(`   Goal: ${plan.goal}`);
  console.log(`   Tasks: ${plan.tasks.length}`);
  if (planningArtifacts.length > 0) {
    console.log(`   Planning artifacts: ${planningArtifacts.length}`);
    planningArtifacts.forEach((a) => {
      console.log(`     - ${a.id} from ${a.workerId}`);
    });
  }
  plan.tasks.forEach((t) => {
    console.log(`     - [${t.tier}] ${t.id} (${t.workerId}) deps=[${t.dependsOn.join(",")}]`);
  });
  console.log();

  await fs.writeFile(
    path.join(shiftDir, "plan.json"),
    JSON.stringify(plan, null, 2)
  );

  // ============ EXECUTION ============
  console.log("🚀 Executing shift...\n");
  const execStart = Date.now();

  const onEvent = (event: ShiftEvent) => {
    const ts = ((Date.now() - execStart) / 1000).toFixed(1);
    switch (event.type) {
      case "task_started":
        console.log(`   [+${ts}s] ▶️  [${event.tier}] ${event.taskId} started`);
        break;
      case "task_completed": {
        const u = event.usage[0];
        console.log(
          `   [+${ts}s] ✅ ${event.taskId} completed (${u.inputTokens}in/${u.outputTokens}out = $${u.costUsd.toFixed(4)})`
        );
        break;
      }
      case "task_failed":
        console.log(`   [+${ts}s] ❌ ${event.taskId} FAILED: ${event.error}`);
        break;
      case "task_retrying":
        console.log(`   [+${ts}s] 🔄 ${event.taskId} retrying: ${event.reason}`);
        break;
      case "verifier_review":
        console.log(
          `   [+${ts}s] 🔍 Verifier: ${event.result.passed ? "PASSED" : "FAILED"} (${event.result.issues.length} issues)`
        );
        event.result.issues.forEach((i) => {
          console.log(`          [${i.severity}] ${i.workerId}: ${i.description}`);
        });
        break;
      case "blocker_raised":
        console.log(
          `   [+${ts}s] ⚠️  BLOCKER [${event.blocker.severity}]: ${event.blocker.description}`
        );
        break;
      case "shift_completed":
        console.log(`   [+${ts}s] 🎉 Shift completed`);
        break;
      case "shift_failed":
        console.log(`   [+${ts}s] 💥 Shift failed: ${event.error}`);
        break;
    }
  };

  const { state, launchKit } = await runShift({
    shiftId,
    productProposal,
    plan,
    plannerUsage,
    planningArtifacts,
    onEvent,
  });

  const execMs = Date.now() - execStart;
  console.log(`\n⏱️  Total execution time: ${(execMs / 1000).toFixed(1)}s\n`);

  // ============ COST SUMMARY ============
  const cost = summarizeCost(state);
  console.log("💰 Cost Summary");
  console.log(
    `   Opus:   ${cost.byTier.opus.tokens.toLocaleString()} tokens  ($${cost.byTier.opus.cost.toFixed(4)})`
  );
  console.log(
    `   Sonnet: ${cost.byTier.sonnet.tokens.toLocaleString()} tokens  ($${cost.byTier.sonnet.cost.toFixed(4)})`
  );
  console.log(
    `   Haiku:  ${cost.byTier.haiku.tokens.toLocaleString()} tokens  ($${cost.byTier.haiku.cost.toFixed(4)})`
  );
  console.log(`   TOTAL:  ${cost.total.tokens.toLocaleString()} tokens  ($${cost.total.cost.toFixed(4)})`);
  console.log(
    `   Opus-only estimate: $${cost.opusOnlyEstimate.toFixed(4)}  (${(cost.opusOnlyEstimate / cost.total.cost).toFixed(1)}x)`
  );
  console.log();

  // ============ ARTIFACT OUTPUT ============
  if (launchKit) {
    console.log("💾 Writing artifacts to", shiftDir);
    await fs.writeFile(
      path.join(shiftDir, "launch-kit.json"),
      JSON.stringify(launchKit, null, 2)
    );
    await fs.writeFile(
      path.join(shiftDir, "website.html"),
      launchKit.website.html
    );
    await fs.writeFile(
      path.join(shiftDir, "marketing-copy.md"),
      formatMarketingCopy(launchKit.marketingCopy)
    );
    await fs.writeFile(
      path.join(shiftDir, "social-campaign.md"),
      formatSocialCampaign(launchKit.socialCampaign)
    );
    await fs.writeFile(
      path.join(shiftDir, "cs-docs.md"),
      formatCsDocs(launchKit.csDocs)
    );
    await fs.writeFile(
      path.join(shiftDir, "shift-state.json"),
      JSON.stringify(state, null, 2)
    );
    console.log(`   Artifacts written:`);
    console.log(`     - plan.json`);
    console.log(`     - launch-kit.json`);
    console.log(`     - website.html  ← open this in a browser`);
    console.log(`     - marketing-copy.md`);
    console.log(`     - social-campaign.md`);
    console.log(`     - cs-docs.md`);
    console.log(`     - shift-state.json`);
  }

  if (state.blockers.length > 0) {
    console.log(`\n⚠️  ${state.blockers.length} blocker(s) raised:`);
    state.blockers.forEach((b) => {
      console.log(`   [${b.severity}] ${b.taskId}: ${b.description}`);
      if (b.proposedResolution) {
        console.log(`       fix: ${b.proposedResolution}`);
      }
    });
  }
}

function formatMarketingCopy(copy: {
  headline: string;
  subhead: string;
  valueProps: Array<{ title: string; body: string }>;
  cta: { primary: string; secondary: string };
  faq: Array<{ question: string; answer: string }>;
}): string {
  return [
    `# Marketing Copy`,
    ``,
    `## Headline`,
    copy.headline,
    ``,
    `## Subhead`,
    copy.subhead,
    ``,
    `## Value Propositions`,
    ...copy.valueProps.map((vp) => `### ${vp.title}\n${vp.body}`),
    ``,
    `## CTAs`,
    `- Primary: **${copy.cta.primary}**`,
    `- Secondary: ${copy.cta.secondary}`,
    ``,
    `## FAQ`,
    ...copy.faq.map((f) => `### ${f.question}\n${f.answer}`),
  ].join("\n");
}

function formatSocialCampaign(campaign: {
  posts: Array<{
    platform: string;
    title: string;
    body: string;
    imagePrompt: string;
    imageUrl?: string;
  }>;
}): string {
  return [
    `# Social Campaign`,
    ``,
    ...campaign.posts.flatMap((p) => [
      `## ${p.platform.toUpperCase()}`,
      `**${p.title}**`,
      ``,
      p.body,
      ``,
      `_Image prompt: ${p.imagePrompt}_`,
      p.imageUrl ? `![${p.platform} image](${p.imageUrl})` : "",
      ``,
    ]),
  ].join("\n");
}

function formatCsDocs(docs: {
  gettingStarted: string;
  faq: Array<{ question: string; answer: string }>;
  troubleshooting: Array<{ issue: string; resolution: string }>;
}): string {
  return [
    `# Customer Service Documentation`,
    ``,
    `## Getting Started`,
    docs.gettingStarted,
    ``,
    `## FAQ`,
    ...docs.faq.map((f) => `### ${f.question}\n${f.answer}`),
    ``,
    `## Troubleshooting`,
    ...docs.troubleshooting.map((t) => `### ${t.issue}\n${t.resolution}`),
  ].join("\n");
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err);
  process.exit(1);
});
