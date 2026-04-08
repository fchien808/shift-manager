import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const shifts = await getStore().listShifts();
  return NextResponse.json({ shifts });
}
