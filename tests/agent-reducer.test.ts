import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/lib/agent/events";
import {
  agentReducer,
  createConversation,
  initialAgentState,
  pendingToolUseIds,
  type AgentAction,
  type AgentState,
} from "@/lib/agent/state";
import { buildChatTurns } from "@/lib/agent/view";

const run = (actions: AgentAction[], state = initialAgentState(createConversation("c1", "ecommerce", 0))): AgentState =>
  actions.reduce(agentReducer, state);

const toolUse = (id: string, sql = "SELECT 1"): ContentBlock => ({
  type: "tool_use",
  id,
  name: "run_sql",
  input: { sql },
});

describe("agentReducer", () => {
  it("starts a turn from a user message and titles the conversation", () => {
    const state = run([{ type: "user_message", text: "  How many orders?  ", now: 1 }]);
    expect(state.status).toBe("streaming");
    expect(state.conversation.title).toBe("How many orders?");
    expect(state.conversation.messages).toEqual([{ role: "user", content: "  How many orders?  " }]);
  });

  it("ignores new questions while busy", () => {
    const busy = run([{ type: "user_message", text: "first", now: 1 }]);
    expect(agentReducer(busy, { type: "user_message", text: "second", now: 2 })).toBe(busy);
  });

  it("accumulates streamed deltas into a draft", () => {
    const state = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "request_started" },
      { type: "stream_event", event: { type: "block_start", index: 0, block: "thinking" } },
      { type: "stream_event", event: { type: "thinking_delta", index: 0, text: "Plan" } },
      { type: "stream_event", event: { type: "block_start", index: 1, block: "text" } },
      { type: "stream_event", event: { type: "text_delta", index: 1, text: "Hello " } },
      { type: "stream_event", event: { type: "text_delta", index: 1, text: "world" } },
      { type: "stream_event", event: { type: "tool_use_start", index: 2, id: "t1", name: "run_sql" } },
      { type: "stream_event", event: { type: "tool_input_delta", index: 2, partialJson: '{"sql":"SEL' } },
    ]);
    expect(state.iteration).toBe(1);
    expect(state.draft).toEqual([
      { index: 0, kind: "thinking", text: "Plan" },
      { index: 1, kind: "text", text: "Hello world" },
      { index: 2, kind: "tool_use", text: '{"sql":"SEL', id: "t1", name: "run_sql" },
    ]);
  });

  it("runs a full tool round trip and returns to idle", () => {
    const content: ContentBlock[] = [{ type: "text", text: "Let me check.", citations: null }, toolUse("t1")];
    const state = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "request_started" },
      { type: "assistant_message", content, stopReason: "tool_use", now: 2 },
    ]);
    expect(state.status).toBe("running_tools");
    expect(state.draft).toBeNull();
    expect(pendingToolUseIds(state.conversation.messages)).toEqual(["t1"]);

    const done = run(
      [
        { type: "tool_started", run: { id: "t1", name: "run_sql", status: "running", input: {} } },
        { type: "tool_finished", run: { id: "t1", name: "run_sql", status: "success", input: {}, durationMs: 3 } },
        { type: "tool_results", results: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }], now: 3 },
        { type: "request_started" },
        {
          type: "assistant_message",
          content: [{ type: "text", text: "42 orders.", citations: null }],
          stopReason: "end_turn",
          now: 4,
        },
        { type: "finished" },
      ],
      state,
    );
    expect(done.status).toBe("idle");
    expect(done.iteration).toBe(2);
    expect(done.conversation.runs.t1?.status).toBe("success");
    expect(done.conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("keeps assistant content verbatim (thinking signatures included)", () => {
    const thinking: ContentBlock = { type: "thinking", thinking: "hmm", signature: "sig-123" };
    const state = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "assistant_message", content: [thinking, toolUse("t1")], stopReason: "tool_use", now: 2 },
    ]);
    expect(state.conversation.messages[1]).toEqual({ role: "assistant", content: [thinking, toolUse("t1")] });
  });

  it("repairs dangling tool calls when the user stops", () => {
    const state = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "assistant_message", content: [toolUse("t1"), toolUse("t2")], stopReason: "tool_use", now: 2 },
      { type: "tool_started", run: { id: "t1", name: "run_sql", status: "running", input: {} } },
      { type: "stopped", now: 3 },
    ]);
    expect(state.status).toBe("idle");
    const last = state.conversation.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: true }),
      expect.objectContaining({ type: "tool_result", tool_use_id: "t2", is_error: true }),
    ]);
    expect(state.conversation.runs.t1?.status).toBe("cancelled");
    expect(state.conversation.notices.at(-1)?.kind).toBe("stopped");
  });

  it("keeps partial streamed text when stopped mid-answer", () => {
    const state = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "request_started" },
      { type: "stream_event", event: { type: "text_delta", index: 0, text: "Revenue grew" } },
      { type: "stopped", now: 2 },
    ]);
    expect(state.conversation.messages.at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Revenue grew" }],
    });
  });

  it("records failures as an error notice and stays usable", () => {
    const failed = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "failed", code: "upstream_overloaded", message: "Overloaded", now: 2 },
    ]);
    expect(failed.status).toBe("error");
    expect(failed.error).toEqual({ code: "upstream_overloaded", message: "Overloaded" });
    const next = agentReducer(failed, { type: "user_message", text: "retry", now: 3 });
    expect(next.status).toBe("streaming");
    expect(next.error).toBeNull();
  });
});

describe("buildChatTurns", () => {
  it("folds tool results away and groups an assistant turn across messages", () => {
    const state = run([
      { type: "user_message", text: "q", now: 1 },
      { type: "assistant_message", content: [toolUse("t1")], stopReason: "tool_use", now: 2 },
      { type: "tool_results", results: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }], now: 3 },
      {
        type: "assistant_message",
        content: [{ type: "text", text: "Done", citations: null }],
        stopReason: "end_turn",
        now: 4,
      },
    ]);
    const turns = buildChatTurns(state.conversation.messages, state.conversation.notices, null);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    const assistant = turns[1]!;
    expect(assistant.role === "assistant" && assistant.items.map((i) => i.kind)).toEqual(["tool", "text"]);
  });
});
