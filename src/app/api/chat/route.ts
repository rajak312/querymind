import { encodeSseEvent, type AgentErrorCode, type AgentEvent } from "@/lib/agent/events";
import { hasApiKey, streamClaudeTurn, toAgentError } from "@/lib/server/claude";
import { isMockEnabled, streamMockTurn } from "@/lib/server/mock";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";
import { MAX_BODY_BYTES, parseChatRequest } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long enough for a thinking-heavy turn; each tool round trip is its own request.
export const maxDuration = 300;

const perMinute = createRateLimiter({ limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 30, windowMs: 60_000 });
const perDay = createRateLimiter({ limit: Number(process.env.RATE_LIMIT_PER_DAY) || 400, windowMs: 86_400_000 });

function jsonError(status: number, code: AgentErrorCode, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * POST /api/chat — one assistant turn of the agent loop.
 *
 * The browser sends the transcript + schema; we stream Claude's response back
 * as SSE. Tools are executed client-side, so this route holds no state and
 * the API key never leaves the server.
 */
export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  for (const limiter of [perMinute, perDay]) {
    const verdict = limiter(ip);
    if (!verdict.ok) {
      return jsonError(429, "rate_limited", "You're sending requests too quickly. Please wait a moment.", {
        "retry-after": String(verdict.retryAfterSeconds),
      });
    }
  }

  const mock = isMockEnabled();
  if (!mock && !hasApiKey()) {
    return jsonError(
      503,
      "missing_api_key",
      "This deployment has no ANTHROPIC_API_KEY configured, so the AI analyst is unavailable. The SQL editor still works.",
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return jsonError(413, "bad_request", "The conversation is too long. Start a new chat.");

  let json: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES)
      return jsonError(413, "bad_request", "The conversation is too long. Start a new chat.");
    json = JSON.parse(text);
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body.");
  }
  const parsed = parseChatRequest(json);
  if (!parsed.ok) return jsonError(400, "bad_request", `Invalid request: ${parsed.error}`);

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };
      try {
        if (mock) await streamMockTurn(parsed.data, send, abort.signal);
        else await streamClaudeTurn(parsed.data, send, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) {
          const { code, message } = toAgentError(error);
          console.error("[api/chat]", code, error);
          send({ type: "error", code, message });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a client disconnect
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
