import type Anthropic from "@anthropic-ai/sdk";

/**
 * Wire protocol between /api/chat and the browser (Server-Sent Events).
 * Each SSE `data:` line is one JSON-encoded `AgentEvent`.
 *
 * The server forwards a compact view of Claude's stream for live rendering
 * and finishes every turn with `message_done`, which carries the complete,
 * unmodified assistant content. The client appends that content verbatim to
 * the conversation (thinking blocks included), so history stays append-only.
 */

export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
export type ToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
export type StopReason = NonNullable<Anthropic.Beta.BetaMessage["stop_reason"]>;

export type AgentErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "upstream_rate_limited"
  | "upstream_overloaded"
  | "upstream_error"
  | "bad_request"
  | "invalid_tool_input"
  | "network"
  | "max_iterations"
  | "incomplete_stream"
  | "unknown";

export type AgentEvent =
  | { type: "block_start"; index: number; block: "text" | "thinking" }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; text: string }
  | { type: "tool_use_start"; index: number; id: string; name: string }
  | { type: "tool_input_delta"; index: number; partialJson: string }
  | { type: "fallback"; from: string; to: string }
  | {
      type: "message_done";
      stopReason: StopReason | null;
      content: ContentBlock[];
      model: string;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; code: AgentErrorCode; message: string };

export type MessageDoneEvent = Extract<AgentEvent, { type: "message_done" }>;

export function encodeSseEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Incrementally parse an SSE byte stream into AgentEvents.
 * Handles events split across chunks and multiple events per chunk.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = flushEvents(buffer, onEvent);
    }
    buffer += decoder.decode();
    flushEvents(`${buffer}\n\n`, onEvent);
  } finally {
    reader.releaseLock();
  }
}

function flushEvents(buffer: string, onEvent: (event: AgentEvent) => void): string {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    onEvent(JSON.parse(data) as AgentEvent);
  }
  return rest;
}

/** Shape of the JSON body POSTed to /api/chat. */
export interface ChatRequestBody {
  datasetId: string;
  dataset: { name: string; description: string };
  schema: PromptSchema;
  messages: MessageParam[];
}

/** Compact schema description sent with every request and rendered into the system prompt. */
export interface PromptSchema {
  tables: {
    name: string;
    description?: string;
    rowCount: number;
    columns: { name: string; type: string; primaryKey?: boolean; references?: string; description?: string }[];
    sampleRows: (string | number | boolean | null)[][];
  }[];
}
