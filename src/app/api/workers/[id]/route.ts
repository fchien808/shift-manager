import { NextResponse } from "next/server";
import { workerRegistry } from "@/workers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const spec = workerRegistry.get(id);
  if (!spec) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ worker: spec });
}
