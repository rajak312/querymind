import type { Conversation, ToolRun } from "@/lib/agent/state";

/**
 * Conversation persistence in localStorage.
 *
 * Layout: an index of summaries under INDEX_KEY and one entry per
 * conversation. Result rows are capped before saving so a few big queries
 * cannot exhaust the ~5 MB quota; the transcript sent to Claude is unaffected
 * because it only ever contains the compact tool_result text.
 */

export const INDEX_KEY = "querymind:conversations:v1";
const ITEM_PREFIX = "querymind:conversation:v1:";
export const MAX_CONVERSATIONS = 40;
export const MAX_PERSISTED_ROWS = 200;

export interface ConversationSummary {
  id: string;
  title: string;
  datasetId: string;
  updatedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function listConversations(): ConversationSummary[] {
  const raw = storage()?.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ConversationSummary[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function loadConversation(id: string): Conversation | null {
  const raw = storage()?.getItem(ITEM_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Conversation;
  } catch {
    return null;
  }
}

function compactRun(run: ToolRun): ToolRun {
  if (!run.result || run.result.rows.length <= MAX_PERSISTED_ROWS) return run;
  return {
    ...run,
    result: { ...run.result, rows: run.result.rows.slice(0, MAX_PERSISTED_ROWS), truncated: true },
  };
}

/** Save (or update) a conversation. Empty conversations are not persisted. */
export function saveConversation(conversation: Conversation): ConversationSummary[] {
  const store = storage();
  if (!store || conversation.messages.length === 0) return listConversations();

  const compacted: Conversation = {
    ...conversation,
    runs: Object.fromEntries(Object.entries(conversation.runs).map(([id, run]) => [id, compactRun(run)])),
  };
  const summary: ConversationSummary = {
    id: conversation.id,
    title: conversation.title,
    datasetId: conversation.datasetId,
    updatedAt: conversation.updatedAt,
  };
  let index = [summary, ...listConversations().filter((c) => c.id !== conversation.id)];
  const evicted = index.slice(MAX_CONVERSATIONS);
  index = index.slice(0, MAX_CONVERSATIONS);
  for (const old of evicted) store.removeItem(ITEM_PREFIX + old.id);

  const write = () => {
    store.setItem(ITEM_PREFIX + conversation.id, JSON.stringify(compacted));
    store.setItem(INDEX_KEY, JSON.stringify(index));
  };
  try {
    write();
  } catch {
    // Quota exceeded: drop the oldest conversations and try once more.
    for (const old of index.splice(Math.max(1, Math.floor(index.length / 2)))) store.removeItem(ITEM_PREFIX + old.id);
    try {
      write();
    } catch {
      // Give up silently; the in-memory conversation still works.
    }
  }
  return index;
}

export function deleteConversation(id: string): ConversationSummary[] {
  const store = storage();
  if (!store) return [];
  store.removeItem(ITEM_PREFIX + id);
  const index = listConversations().filter((c) => c.id !== id);
  store.setItem(INDEX_KEY, JSON.stringify(index));
  return index;
}
