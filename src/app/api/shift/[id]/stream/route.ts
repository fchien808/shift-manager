import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import type { ShiftEvent } from "@/types/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hold the SSE connection open for the full duration of a long shift.
// Matches the POST route's maxDuration so the live view survives a 3-4min run.
export const maxDuration = 800;

/**
 * Server-sent events stream for a running shift.
 *
 * On connect: replay buffered history from the store, then subscribe for
 * new events. With the Redis backend this works across Lambda instances
 * because the store subscription polls Redis. With the in-memory backend
 * it works via direct listener callbacks on the same process.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const store = getStore();
  const rec = await store.getShift(params.id);
  if (!rec) {
    return new Response("Shift not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (
        event: ShiftEvent | { type: "__heartbeat__" } | { type: "__done__" }
      ) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Replay history
      for (const e of rec.events) send(e);

      // If already terminal, close immediately
      if (rec.status === "done" || rec.status === "failed") {
        send({ type: "__done__" });
        closed = true;
        try {
          controller.close();
        } catch {}
        return;
      }

      const unsubscribe = await store.subscribe(params.id, {
        onEvent: (ev) => send(ev),
        onDone: () => {
          send({ type: "__done__" });
          closed = true;
          try {
            controller.close();
          } catch {}
        },
      });

      // Heartbeat to keep proxies from timing out the connection
      const heartbeat = setInterval(
        () => send({ type: "__heartbeat__" }),
        15000
      );

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
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
