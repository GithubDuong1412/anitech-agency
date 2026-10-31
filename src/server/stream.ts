import type { RunEvent } from "@/lib/state";

/**
 * Stream run events as NDJSON. The work keeps going if the browser disconnects:
 * everything is saved to the database as it happens, so a reload shows the result.
 */
export function ndjson(work: (emit: (event: RunEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: RunEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await work(emit);
      } catch (error) {
        console.error("[agents] stream failed:", error instanceof Error ? error.message : "unknown error");
        emit({ type: "error", code: "server" });
      } finally {
        emit({ type: "done" });
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
