import { NextRequest } from "next/server";
import { shiftStore } from "@/lib/shift-store";
import type { ShiftEvent } from "@/types/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hold the SSE connection open for the full duration of a long shift.
// Matches the POST route's maxDuration so the live view survives a 3-4min run.
export const maxDuration = 300;

/**
 * Server-sent events stream for a running shift.
 *
 * Replays buffered events on connect, then streams new ones live until
 * the shift completes. The client can reconnect at any time - the event
 * buffer means it won't miss anything.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rec = shiftStore.get(params.id);
  if (!rec) {
    return new Response("Shift not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: ShiftEvent | { type: "__heartbeat__" } | { type: "__done__" }) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // stream already closed
        }
      };

      // Replay history
      for (const e of rec.events) send(e);

      // If already done, finalize immediately
      if (rec.status === "done" || rec.status === "failed") {
        send({ type: "__done__" });
        try {
          controller.close();
        } catch {}
        return;
      }

      const listener = (event: ShiftEvent) => send(event);
      rec.listeners.add(listener);

      const onDone = () => {
        send({ type: "__done__" });
        rec.listeners.delete(listener);
        rec.doneListeners.delete(onDone);
        try {
          controller.close();
        } catch {}
      };
      rec.doneListeners.add(onDone);

      // Heartbeat to keep proxies from timing out the connection
      const heartbeat = setInterval(() => send({ type: "__heartbeat__" }), 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        rec.listeners.delete(listener);
        rec.doneListeners.delete(onDone);
      };

      _req.signal?.addEventListener?.("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
