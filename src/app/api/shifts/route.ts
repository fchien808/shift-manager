import { NextResponse } from "next/server";
import { listPersistedShifts } from "@/lib/shift-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const shifts = listPersistedShifts();
  return NextResponse.json({ shifts });
}
