import Anthropic from "@anthropic-ai/sdk";
import type { AgentErrorCode, AgentEvent, ContentBlock } from "@/lib/agent/events";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { INSTRUCTIONS, renderSchema } from "./prompt";
import type { ParsedChatRequest } from "./validate";

/**
 * Claude Opus 5.5 is the default: the strongest current Opus for multi-step
 * analytical reasoning and tool use. Override with ANTHROPIC_MODEL.
 */
export const DEFAULT_MODEL = "claude-opus-5-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

/** Models that accept the server-side `fallbacks: "default"` refusal fallback. */
const FALLBACK_CAPABLE = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

/**
 * Per-turn output cap. A turn is either a few tool calls or a written answer,
 * so this is generous while bounding the cost of a public demo.
 */
const MAX_TOKENS = 16_000;

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

function getEffort(): Effort {
  const value = process.env.ANTHROPIC_EFFORT?.trim() as Effort | undefined;
  // Opus 5.5 defaults to "medium"; we set it explicitly so behaviour is obvious.
  return value && EFFORTS.includes(value) ? value : "medium";
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** Map SDK exceptions to stable error codes for the UI (most specific first). */
export function toAgentError(error: unknown): { code: AgentErrorCode; message: string } {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { code: "invalid_api_key", message: "The server's Anthropic API key was rejected." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      code: "upstream_rate_limited",
      message: "Claude is rate limited right now. Please try again in a minute.",
    };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { code: "bad_request", message: `Claude rejected the request: ${error.message}` };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return error.status === 529
      ? { code: "upstream_overloaded", message: "Claude is overloaded right now. Please try again shortly." }
      : { code: "upstream_error", message: "Claude had a temporary problem. Please try again." };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { code: "network", message: "Could not reach the Claude API." };
  }
  if (error instanceof Anthropic.APIError) {
    return { code: "upstream_error", message: error.message };
  }
  if (error instanceof Anthropic.AnthropicError) {
    // With eager input streaming the SDK raises a plain AnthropicError when a
    // tool input is not parseable JSON; the client re-issues the turn.
    return { code: "invalid_tool_input", message: "Claude produced an unreadable tool call. Retrying may help." };
  }
  return { code: "unknown", message: error instanceof Error ? error.message : "Unknown error" };
}

/**
 * Stream one assistant turn from Claude and forward it as AgentEvents.
 * The browser executes the tools and calls back for the next turn.
 */
export async function streamClaudeTurn(
  request: ParsedChatRequest,
  send: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const model = getModel();
  const stream = getClient().beta.messages.stream(
    {
      model,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: INSTRUCTIONS },
        // The schema is stable for the whole conversation: cache everything up to here.
        { type: "text", text: renderSchema(request.dataset, request.schema), cache_control: { type: "ephemeral" } },
      ],
      tools: TOOL_DEFINITIONS,
      messages: request.messages,
      // Opus 5.5 always thinks adaptively; "summarized" lets the UI show a readable reasoning trace.
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: getEffort() },
      ...(FALLBACK_CAPABLE.has(model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    },
    { signal },
  );

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "text") send({ type: "block_start", index: event.index, block: "text" });
        else if (block.type === "thinking") send({ type: "block_start", index: event.index, block: "thinking" });
        else if (block.type === "tool_use")
          send({ type: "tool_use_start", index: event.index, id: block.id, name: block.name });
        else if (block.type === "fallback") send({ type: "fallback", from: block.from.model, to: block.to.model });
        break;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") send({ type: "text_delta", index: event.index, text: delta.text });
        else if (delta.type === "thinking_delta")
          send({ type: "thinking_delta", index: event.index, text: delta.thinking });
        else if (delta.type === "input_json_delta") {
          send({ type: "tool_input_delta", index: event.index, partialJson: delta.partial_json });
        }
        break;
      }
      default:
        break;
    }
  }

  const message = await stream.finalMessage();
  send({
    type: "message_done",
    stopReason: message.stop_reason,
    content: message.content as ContentBlock[],
    model: message.model,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  });
}
