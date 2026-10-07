import type { ChartData, ChartSpec } from "@/lib/chart/prepare";
import type { QueryResult, TableProfile } from "@/lib/db/types";
import type {
  AgentErrorCode,
  AgentEvent,
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  StopReason,
  ToolResultBlockParam,
} from "./events";

/**
 * Agent-loop state machine.
 *
 *   idle ──user_message──▶ streaming ──assistant_message(tool_use)──▶ running_tools
 *    ▲                        │  ▲                                        │
 *    │                        │  └──────────── tool_results ──────────────┘
 *    └──finished / stopped────┘
 *                  failed ──▶ error (history repaired, ready for the next question)
 *
 * The reducer is pure and framework-free; React subscribes through a tiny store.
 */

export type AgentStatus = "idle" | "streaming" | "running_tools" | "error";

export interface ToolRun {
  id: string;
  name: string;
  status: "running" | "success" | "error" | "cancelled";
  input: unknown;
  sql?: string;
  purpose?: string;
  result?: QueryResult;
  chart?: { spec: ChartSpec; data: ChartData };
  profile?: TableProfile;
  error?: string;
  durationMs?: number;
}

export type NoticeKind = "stopped" | "error" | "refusal" | "max_tokens" | "max_iterations" | "fallback";

export interface Notice {
  kind: NoticeKind;
  message: string;
  /** Rendered after the message at this index. */
  afterMessage: number;
}

export interface Conversation {
  id: string;
  title: string;
  datasetId: string;
  createdAt: number;
  updatedAt: number;
  messages: MessageParam[];
  runs: Record<string, ToolRun>;
  notices: Notice[];
}

export interface DraftBlock {
  index: number;
  kind: "text" | "thinking" | "tool_use";
  text: string;
  id?: string;
  name?: string;
}

export interface AgentState {
  status: AgentStatus;
  conversation: Conversation;
  /** Blocks of the assistant message currently being streamed. */
  draft: DraftBlock[] | null;
  /** Model requests made in the current turn. */
  iteration: number;
  error: { code: AgentErrorCode; message: string } | null;
}

export type AgentAction =
  | { type: "load"; conversation: Conversation }
  | { type: "user_message"; text: string; now: number }
  | { type: "request_started" }
  | { type: "stream_event"; event: AgentEvent }
  | { type: "assistant_message"; content: ContentBlock[]; stopReason: StopReason | null; now: number }
  | { type: "tool_started"; run: ToolRun }
  | { type: "tool_finished"; run: ToolRun }
  | { type: "tool_results"; results: ToolResultBlockParam[]; now: number }
  | { type: "notice"; kind: NoticeKind; message: string }
  | { type: "finished" }
  | { type: "stopped"; now: number }
  | { type: "failed"; code: AgentErrorCode; message: string; now: number };

export const MAX_TITLE_LENGTH = 60;

export function createConversation(id: string, datasetId: string, now: number): Conversation {
  return { id, title: "New analysis", datasetId, createdAt: now, updatedAt: now, messages: [], runs: {}, notices: [] };
}

export function initialAgentState(conversation: Conversation): AgentState {
  return { status: "idle", conversation, draft: null, iteration: 0, error: null };
}

export function isBusy(status: AgentStatus): boolean {
  return status === "streaming" || status === "running_tools";
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH - 1)}…` : clean;
}

/** Content blocks of an assistant message as a uniform array. */
export function blocksOf(message: MessageParam): ContentBlockParam[] {
  return typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
}

/** tool_use ids in the last assistant message that have no tool_result yet. */
export function pendingToolUseIds(messages: MessageParam[]): string[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return [];
  return blocksOf(last).flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
}

/**
 * Keep the transcript valid for the next request: every tool_use must be
 * followed by a tool_result. When a turn is interrupted (stop, error,
 * max_tokens) we answer the dangling calls with an error result.
 * This only ever appends, so earlier blocks stay byte-identical.
 */
function repairTranscript(conversation: Conversation, reason: string, now: number): Conversation {
  const pending = pendingToolUseIds(conversation.messages);
  if (pending.length === 0) return conversation;
  const runs = { ...conversation.runs };
  for (const id of pending) {
    const run = runs[id];
    if (run && run.status === "running") runs[id] = { ...run, status: "cancelled", error: reason };
  }
  const results: ToolResultBlockParam[] = pending.map((id) => ({
    type: "tool_result",
    tool_use_id: id,
    is_error: true,
    content: reason,
  }));
  return {
    ...conversation,
    runs,
    updatedAt: now,
    messages: [...conversation.messages, { role: "user", content: results }],
  };
}

function addNotice(conversation: Conversation, kind: NoticeKind, message: string): Conversation {
  return {
    ...conversation,
    notices: [...conversation.notices, { kind, message, afterMessage: conversation.messages.length - 1 }],
  };
}

function applyStreamEvent(draft: DraftBlock[], event: AgentEvent): DraftBlock[] {
  switch (event.type) {
    case "block_start":
      return [...draft, { index: event.index, kind: event.block, text: "" }];
    case "tool_use_start":
      return [...draft, { index: event.index, kind: "tool_use", text: "", id: event.id, name: event.name }];
    case "text_delta":
    case "thinking_delta":
    case "tool_input_delta": {
      const delta = event.type === "tool_input_delta" ? event.partialJson : event.text;
      const kind = event.type === "text_delta" ? "text" : event.type === "thinking_delta" ? "thinking" : "tool_use";
      const i = draft.findIndex((b) => b.index === event.index && b.kind === kind);
      if (i === -1) return [...draft, { index: event.index, kind, text: delta }];
      const next = draft.slice();
      next[i] = { ...draft[i]!, text: draft[i]!.text + delta };
      return next;
    }
    case "fallback":
      // A fallback model takes over: the declined partial output is discarded.
      return [];
    default:
      return draft;
  }
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "load":
      return initialAgentState(action.conversation);

    case "user_message": {
      if (isBusy(state.status)) return state;
      const conversation = state.conversation;
      const isFirst = conversation.messages.length === 0;
      return {
        status: "streaming",
        draft: null,
        iteration: 0,
        error: null,
        conversation: {
          ...conversation,
          title: isFirst ? titleFrom(action.text) : conversation.title,
          updatedAt: action.now,
          messages: [...conversation.messages, { role: "user", content: action.text }],
        },
      };
    }

    case "request_started":
      return { ...state, status: "streaming", draft: [], iteration: state.iteration + 1 };

    case "stream_event": {
      if (state.status !== "streaming") return state;
      if (action.event.type === "fallback") {
        return {
          ...state,
          draft: applyStreamEvent(state.draft ?? [], action.event),
          conversation: addNotice(
            state.conversation,
            "fallback",
            `${action.event.from} declined this request; ${action.event.to} answered instead.`,
          ),
        };
      }
      return { ...state, draft: applyStreamEvent(state.draft ?? [], action.event) };
    }

    case "assistant_message": {
      // Append Claude's content verbatim. Server-only block types are filtered
      // by the route; everything here is valid as a request param.
      const content = action.content as unknown as ContentBlockParam[];
      // An empty turn (e.g. a refusal before any output) is not a valid message to send back.
      if (content.length === 0) return { ...state, draft: null };
      const conversation: Conversation = {
        ...state.conversation,
        updatedAt: action.now,
        messages: [...state.conversation.messages, { role: "assistant", content }],
      };
      const hasToolUse = content.some((b) => b.type === "tool_use");
      return {
        ...state,
        draft: null,
        conversation,
        status: action.stopReason === "tool_use" && hasToolUse ? "running_tools" : state.status,
      };
    }

    case "tool_started":
    case "tool_finished":
      return {
        ...state,
        conversation: {
          ...state.conversation,
          runs: { ...state.conversation.runs, [action.run.id]: action.run },
        },
      };

    case "tool_results":
      return {
        ...state,
        conversation: {
          ...state.conversation,
          updatedAt: action.now,
          messages: [...state.conversation.messages, { role: "user", content: action.results }],
        },
      };

    case "notice":
      return { ...state, conversation: addNotice(state.conversation, action.kind, action.message) };

    case "finished":
      return { ...state, status: "idle", draft: null };

    case "stopped": {
      let conversation = state.conversation;
      // Keep any text the user already saw as a (partial) assistant message.
      const partial = (state.draft ?? []).filter((b) => b.kind === "text" && b.text.trim());
      if (partial.length > 0) {
        conversation = {
          ...conversation,
          messages: [
            ...conversation.messages,
            { role: "assistant", content: partial.map((b) => ({ type: "text" as const, text: b.text })) },
          ],
        };
      }
      conversation = repairTranscript(conversation, "Cancelled: the user stopped the response.", action.now);
      conversation = addNotice(conversation, "stopped", "Stopped by you.");
      return { ...state, status: "idle", draft: null, conversation };
    }

    case "failed": {
      let conversation = repairTranscript(state.conversation, `Error: ${action.message}`, action.now);
      conversation = addNotice(
        conversation,
        action.code === "max_iterations" ? "max_iterations" : "error",
        action.message,
      );
      return {
        ...state,
        status: "error",
        draft: null,
        conversation,
        error: { code: action.code, message: action.message },
      };
    }
  }
}

/** Minimal observable store around the reducer (used with useSyncExternalStore and in tests). */
export interface AgentStore {
  getState: () => AgentState;
  dispatch: (action: AgentAction) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createAgentStore(initial: AgentState): AgentStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = agentReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
