import type {
  AgentErrorCode,
  ChatRequestBody,
  ContentBlock,
  MessageDoneEvent,
  MessageParam,
  ToolResultBlockParam,
} from "./events";
import { readSseStream } from "./events";
import type { AgentStore, ToolRun } from "./state";
import { isToolName, TOOL_INPUT_SCHEMAS } from "./tools";

/**
 * Client side of the agent loop.
 *
 *  1. POST the transcript to /api/chat and render the streamed events.
 *  2. Append the final assistant message verbatim.
 *  3. If Claude asked for tools, run them in the browser (PGlite) and append
 *     the tool_result blocks in ONE user message.
 *  4. Repeat until Claude ends its turn, the user stops it, or the
 *     iteration guard trips.
 */

export const DEFAULT_MAX_ITERATIONS = 12;

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface ToolExecution {
  /** Text sent back to Claude in the tool_result. */
  content: string;
  isError: boolean;
  /** Final run record shown in the UI. */
  run: ToolRun;
}

export interface AgentLoopOptions {
  store: AgentStore;
  buildRequest: (messages: MessageParam[]) => Omit<ChatRequestBody, "messages">;
  executeTool: (block: ValidatedToolUse, signal: AbortSignal) => Promise<ToolExecution>;
  signal: AbortSignal;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  maxIterations?: number;
  now?: () => number;
}

export interface ValidatedToolUse {
  id: string;
  name: keyof typeof TOOL_INPUT_SCHEMAS;
  input: unknown;
}

const RETRYABLE_CODES = new Set<AgentErrorCode>(["invalid_tool_input"]);

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

async function requestTurn(options: AgentLoopOptions, messages: MessageParam[]): Promise<MessageDoneEvent> {
  const { store, signal } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: ChatRequestBody = { ...options.buildRequest(messages), messages };

  let response: Response;
  try {
    response = await fetchImpl(options.endpoint ?? "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    throw new AgentError("network", "Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok || !response.body) {
    let code: AgentErrorCode = "unknown";
    let message = `The server responded with ${response.status}.`;
    try {
      const json = (await response.json()) as { error?: { code?: AgentErrorCode; message?: string } };
      if (json.error?.code) code = json.error.code;
      if (json.error?.message) message = json.error.message;
    } catch {
      // non-JSON error body
    }
    throw new AgentError(code, message);
  }

  let done: MessageDoneEvent | null = null;
  await readSseStream(response.body, (event) => {
    if (event.type === "message_done") done = event;
    else if (event.type === "error") throw new AgentError(event.code, event.message);
    else store.dispatch({ type: "stream_event", event });
  });
  if (!done) throw new AgentError("incomplete_stream", "The response ended unexpectedly. Please try again.");
  return done;
}

/** Validate tool input before running it (eager input streaming means the API did not). */
function validateToolUse(block: Extract<ContentBlock, { type: "tool_use" }>): ValidatedToolUse | string {
  if (!isToolName(block.name)) return `Unknown tool "${block.name}".`;
  const parsed = TOOL_INPUT_SCHEMAS[block.name].safeParse(block.input);
  if (!parsed.success) {
    return JSON.stringify({
      INVALID_JSON: JSON.stringify(block.input),
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
    });
  }
  return { id: block.id, name: block.name, input: parsed.data };
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<void> {
  const { store, signal } = options;
  const now = options.now ?? Date.now;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let retries = 0;

  try {
    for (let iteration = 0; ; iteration++) {
      if (iteration >= maxIterations) {
        throw new AgentError(
          "max_iterations",
          `Stopped after ${maxIterations} steps to keep things fast. Ask a follow-up to continue.`,
        );
      }

      store.dispatch({ type: "request_started" });
      let done: MessageDoneEvent;
      try {
        done = await requestTurn(options, store.getState().conversation.messages);
        retries = 0;
      } catch (error) {
        // A tool input that was not parseable JSON: the turn never completed, re-issue it once.
        if (error instanceof AgentError && RETRYABLE_CODES.has(error.code) && retries < 1) {
          retries++;
          continue;
        }
        throw error;
      }

      store.dispatch({ type: "assistant_message", content: done.content, stopReason: done.stopReason, now: now() });

      const toolUses = done.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );

      if (done.stopReason === "refusal") {
        store.dispatch({ type: "notice", kind: "refusal", message: "Claude declined to answer this request." });
        break;
      }
      if (done.stopReason === "max_tokens" && toolUses.length > 0) {
        throw new AgentError(
          "incomplete_stream",
          "The response hit its length limit mid tool call. Try a narrower question.",
        );
      }
      if (done.stopReason === "max_tokens") {
        store.dispatch({ type: "notice", kind: "max_tokens", message: "The answer was cut off at the length limit." });
        break;
      }
      if (done.stopReason !== "tool_use" || toolUses.length === 0) break;

      // Run every requested tool, then return ALL results in a single user message.
      const results: ToolResultBlockParam[] = [];
      for (const block of toolUses) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const validated = validateToolUse(block);
        if (typeof validated === "string") {
          store.dispatch({
            type: "tool_finished",
            run: { id: block.id, name: block.name, status: "error", input: block.input, error: validated },
          });
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: validated });
          continue;
        }
        store.dispatch({
          type: "tool_started",
          run: { id: block.id, name: block.name, status: "running", input: validated.input },
        });
        const execution = await options.executeTool(validated, signal);
        store.dispatch({ type: "tool_finished", run: execution.run });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: execution.content,
          ...(execution.isError ? { is_error: true } : {}),
        });
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      store.dispatch({ type: "tool_results", results, now: now() });
    }
    store.dispatch({ type: "finished" });
  } catch (error) {
    if (isAbort(error, signal)) {
      store.dispatch({ type: "stopped", now: now() });
      return;
    }
    const agentError =
      error instanceof AgentError
        ? error
        : new AgentError("unknown", error instanceof Error ? error.message : "Something went wrong.");
    store.dispatch({ type: "failed", code: agentError.code, message: agentError.message, now: now() });
  }
}
