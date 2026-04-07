import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runShiftToCompletion } from "@/lib/run-shift-background";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro allows up to 300s. A full shift with synthesis + re-plan can
// push 3-4 minutes, so we max it out.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const productProposal: string = body.productProposal ?? "";
  if (!productProposal || productProposal.length < 50) {
    return NextResponse.json(
      { error: "productProposal must be at least 50 characters" },
      { status: 400 }
    );
  }
  const shiftId = `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Kick off the shift and keep the Lambda alive until it finishes via
  // `waitUntil`. This lets us return the shiftId immediately (so the client
  // can navigate to the live view) while the orchestrator keeps running in
  // the same function instance — critical on Vercel where unawaited promises
  // would otherwise be killed as soon as the HTTP response is sent.
  const shiftPromise = runShiftToCompletion(shiftId, productProposal);
  waitUntil(shiftPromise);

  return NextResponse.json({ shiftId });
}
