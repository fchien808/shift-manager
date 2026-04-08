import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { summarizeCost } from "@/orchestrator/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const store = getStore();
  const rec = await store.getShift(params.id);
  if (!rec) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }
  const cost = rec.state ? summarizeCost(rec.state) : null;
  return NextResponse.json({
    id: rec.id,
    status: rec.status,
    plan: rec.plan,
    events: rec.events,
    state: rec.state,
    launchKit: rec.launchKit,
    cost,
    error: rec.error,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
  });
}
