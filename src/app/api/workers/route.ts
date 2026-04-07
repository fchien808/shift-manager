import { NextResponse } from "next/server";
import { workerRegistry } from "@/workers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workers = workerRegistry.list().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    purpose: s.purpose,
    tags: s.tags,
    tier: s.tier,
    status: s.status,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    version: s.version,
    provenance: s.provenance,
    metrics: s.metrics,
    outputFormat: s.outputFormat,
  }));
  return NextResponse.json({ workers });
}
