import { afterEach, describe, expect, it, vi } from "vitest";
import { readSseStream, type AgentEvent, type ChatRequestBody } from "@/lib/agent/events";

/** Route handler tests: no-key behaviour, validation, and the dev mock stream. */

const body: ChatRequestBody = {
  datasetId: "ecommerce",
  dataset: { name: "Northwind Goods", description: "Shop" },
  schema: {
    tables: [
      {
        name: "orders",
        rowCount: 10,
        columns: [{ name: "order_id", type: "integer", primaryKey: true }],
        sampleRows: [[1]],
      },
    ],
  },
  messages: [{ role: "user", content: "How has monthly revenue trended?" }],
};

async function post(payload: unknown, ip = "1.1.1.1") {
  vi.resetModules();
  const { POST } = await import("@/app/api/chat/route");
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(payload),
    }),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/chat", () => {
  it("explains when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("QUERYMIND_MOCK", "");
    const res = await post(body);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "missing_api_key" } });
  });

  it("rejects malformed transcripts", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const res = await post({ ...body, messages: [{ role: "assistant", content: "hi" }] });
    expect(res.status).toBe(400);
    const res2 = await post({ ...body, messages: [{ role: "user", content: [{ type: "image", source: {} }] }] });
    expect(res2.status).toBe(400);
  });

  it("streams a scripted tool call in dev mock mode", async () => {
    vi.stubEnv("QUERYMIND_MOCK", "1");
    vi.stubEnv("NODE_ENV", "development");
    const res = await post(body);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events: AgentEvent[] = [];
    await readSseStream(res.body!, (e) => events.push(e));
    const done = events.at(-1);
    expect(done?.type).toBe("message_done");
    if (done?.type === "message_done") {
      expect(done.stopReason).toBe("tool_use");
      expect(done.content.find((b) => b.type === "tool_use")).toMatchObject({ name: "run_sql" });
    }
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
  });

  it("never enables mock mode in production", async () => {
    vi.stubEnv("QUERYMIND_MOCK", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await post(body);
    expect(res.status).toBe(503);
  });

  it("rate limits per client IP", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const send = () =>
      POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "x-forwarded-for": "9.9.9.9" },
          body: "{}",
        }),
      );
    expect((await send()).status).toBe(503);
    expect((await send()).status).toBe(503);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
