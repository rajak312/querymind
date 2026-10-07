import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeSseEvent, type AgentEvent, type ChatRequestBody } from "@/lib/agent/events";
import { runAgentLoop, type ToolExecution, type ValidatedToolUse } from "@/lib/agent/loop";
import { createAgentStore, createConversation, initialAgentState } from "@/lib/agent/state";

/**
 * The agent loop is exercised end to end against an MSW-mocked /api/chat that
 * streams Server-Sent Events exactly like the real route, including a
 * tool_use -> tool_result round trip.
 */

const ENDPOINT = "http://localhost/api/chat";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Stream events, deliberately split at awkward byte boundaries. */
function sse(events: AgentEvent[], chunkSize = 7): HttpResponse<ReadableStream> {
  const text = events.map(encodeSseEvent).join("");
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new HttpResponse(stream, { headers: { "content-type": "text/event-stream" } });
}

const toolTurn: AgentEvent[] = [
  { type: "block_start", index: 0, block: "text" },
  { type: "text_delta", index: 0, text: "Counting orders… " },
  { type: "tool_use_start", index: 1, id: "toolu_1", name: "run_sql" },
  { type: "tool_input_delta", index: 1, partialJson: '{"sql":"SELECT count(*) ' },
  { type: "tool_input_delta", index: 1, partialJson: 'AS n FROM orders"}' },
  {
    type: "message_done",
    stopReason: "tool_use",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "Count the orders.", signature: "sig-abc" },
      { type: "text", text: "Counting orders… ", citations: null },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "run_sql",
        input: { sql: "SELECT count(*) AS n FROM orders", purpose: "Order count" },
      },
    ],
  },
];

const answerTurn: AgentEvent[] = [
  { type: "block_start", index: 0, block: "text" },
  { type: "text_delta", index: 0, text: "There are **7,176** orders." },
  {
    type: "message_done",
    stopReason: "end_turn",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: "There are **7,176** orders.", citations: null }],
  },
];

function setup() {
  const store = createAgentStore(initialAgentState(createConversation("c1", "ecommerce", 0)));
  const executeTool = vi.fn(async (block: ValidatedToolUse): Promise<ToolExecution> => ({
    content: JSON.stringify({ columns: ["n (bigint)"], row_count: 1, rows: [[7176]] }),
    isError: false,
    run: { id: block.id, name: block.name, status: "success", input: block.input, durationMs: 2 },
  }));
  const controller = new AbortController();
  const options = {
    store,
    executeTool,
    signal: controller.signal,
    endpoint: ENDPOINT,
    buildRequest: () => ({
      datasetId: "ecommerce",
      dataset: { name: "Northwind Goods", description: "Shop" },
      schema: { tables: [] },
    }),
  };
  return { store, executeTool, controller, options };
}

describe("runAgentLoop (MSW-mocked /api/chat)", () => {
  it("completes a tool_use round trip and ends the turn", async () => {
    const bodies: ChatRequestBody[] = [];
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as ChatRequestBody;
        bodies.push(body);
        return sse(bodies.length === 1 ? toolTurn : answerTurn);
      }),
    );
    const { store, executeTool, options } = setup();
    store.dispatch({ type: "user_message", text: "How many orders?", now: 1 });
    await runAgentLoop(options);

    // Tool executed in the "browser" with validated input.
    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool.mock.calls[0]![0]).toMatchObject({
      id: "toolu_1",
      name: "run_sql",
      input: { sql: "SELECT count(*) AS n FROM orders" },
    });

    // Second request carries the verbatim assistant turn + the tool_result.
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.messages).toHaveLength(3);
    const firstTurn = toolTurn.at(-1) as Extract<AgentEvent, { type: "message_done" }>;
    expect(bodies[1]!.messages[1]).toEqual({ role: "assistant", content: firstTurn.content });
    expect(bodies[1]!.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: expect.stringContaining("7176") }],
    });

    const state = store.getState();
    expect(state.status).toBe("idle");
    expect(state.iteration).toBe(2);
    expect(state.conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(state.conversation.runs.toolu_1?.status).toBe("success");
  });

  it("returns invalid tool input to Claude as an error result instead of running it", async () => {
    let call = 0;
    server.use(
      http.post(ENDPOINT, () => {
        call++;
        if (call > 1) return sse(answerTurn);
        return sse([
          {
            type: "message_done",
            stopReason: "tool_use",
            model: "m",
            content: [{ type: "tool_use", id: "bad", name: "run_sql", input: { query: "SELECT 1" } }],
          },
        ]);
      }),
    );
    const { store, executeTool, options } = setup();
    store.dispatch({ type: "user_message", text: "q", now: 1 });
    await runAgentLoop(options);
    expect(executeTool).not.toHaveBeenCalled();
    const results = store.getState().conversation.messages[2]!.content as { is_error?: boolean; content: string }[];
    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0]!.content).toContain("INVALID_JSON");
    expect(store.getState().status).toBe("idle");
  });

  it("surfaces a missing API key as a typed error", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ error: { code: "missing_api_key", message: "No key configured" } }, { status: 503 }),
      ),
    );
    const { store, options } = setup();
    store.dispatch({ type: "user_message", text: "q", now: 1 });
    await runAgentLoop(options);
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toEqual({ code: "missing_api_key", message: "No key configured" });
  });

  it("handles a streamed error event", async () => {
    server.use(http.post(ENDPOINT, () => sse([{ type: "error", code: "upstream_overloaded", message: "Overloaded" }])));
    const { store, options } = setup();
    store.dispatch({ type: "user_message", text: "q", now: 1 });
    await runAgentLoop(options);
    expect(store.getState().error?.code).toBe("upstream_overloaded");
  });

  it("stops after the iteration guard and repairs the transcript", async () => {
    server.use(http.post(ENDPOINT, () => sse(toolTurn)));
    const { store, options } = setup();
    store.dispatch({ type: "user_message", text: "q", now: 1 });
    await runAgentLoop({ ...options, maxIterations: 3 });
    const state = store.getState();
    expect(state.error?.code).toBe("max_iterations");
    expect(state.iteration).toBe(3);
    // Every tool_use has a matching tool_result, so the next question can be sent.
    expect(state.conversation.messages.at(-1)!.role).toBe("user");
  });

  it("cancels cleanly when the user presses Stop mid-tool", async () => {
    server.use(http.post(ENDPOINT, () => sse(toolTurn)));
    const { store, controller, options } = setup();
    options.executeTool = vi.fn(async (block: ValidatedToolUse) => {
      controller.abort();
      return {
        content: "{}",
        isError: false,
        run: { id: block.id, name: block.name, status: "success" as const, input: {} },
      };
    });
    store.dispatch({ type: "user_message", text: "q", now: 1 });
    await runAgentLoop(options);
    const state = store.getState();
    expect(state.status).toBe("idle");
    expect(state.conversation.notices.at(-1)?.kind).toBe("stopped");
    const last = state.conversation.messages.at(-1)!;
    expect(last.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1", is_error: true }),
    ]);
  });

  it("shows a refusal notice", async () => {
    server.use(
      http.post(ENDPOINT, () => sse([{ type: "message_done", stopReason: "refusal", model: "m", content: [] }])),
    );
    const { store, options } = setup();
    store.dispatch({ type: "user_message", text: "q", now: 1 });
    await runAgentLoop(options);
    expect(store.getState().conversation.notices.at(-1)?.kind).toBe("refusal");
    // Nothing invalid (an empty assistant message) is added to the transcript.
    expect(store.getState().conversation.messages).toHaveLength(1);
    expect(store.getState().status).toBe("idle");
  });
});
