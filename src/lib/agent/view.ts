import type { ContentBlockParam, MessageParam } from "./events";
import type { DraftBlock, Notice } from "./state";

/**
 * Turn the raw transcript into what the chat renders: user bubbles and
 * assistant "turns" that span several API messages (text, reasoning and tool
 * steps), with tool_result messages folded away.
 */

export type AssistantItem =
  | { kind: "text"; key: string; text: string; streaming?: boolean }
  | { kind: "thinking"; key: string; text: string; streaming?: boolean }
  | { kind: "tool"; key: string; id: string; name: string; input: unknown; partialJson?: string }
  | { kind: "notice"; key: string; notice: Notice };

export type ChatTurn =
  { role: "user"; key: string; text: string } | { role: "assistant"; key: string; items: AssistantItem[] };

function userText(message: MessageParam): string | null {
  if (typeof message.content === "string") return message.content;
  const texts = message.content.filter((b): b is Extract<ContentBlockParam, { type: "text" }> => b.type === "text");
  return texts.length ? texts.map((b) => b.text).join("\n") : null;
}

export function buildChatTurns(messages: MessageParam[], notices: Notice[], draft: DraftBlock[] | null): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const assistantTurn = (key: string) => {
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") return last;
    const turn: ChatTurn = { role: "assistant", key, items: [] };
    turns.push(turn);
    return turn;
  };

  messages.forEach((message, i) => {
    if (message.role === "user") {
      const text = userText(message);
      if (text !== null) turns.push({ role: "user", key: `m${i}`, text });
    } else {
      const turn = assistantTurn(`m${i}`);
      const blocks =
        typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
      blocks.forEach((block, j) => {
        const key = `m${i}b${j}`;
        if (block.type === "text" && block.text.trim()) turn.items.push({ kind: "text", key, text: block.text });
        else if (block.type === "thinking" && block.thinking.trim()) {
          turn.items.push({ kind: "thinking", key, text: block.thinking });
        } else if (block.type === "tool_use") {
          turn.items.push({ kind: "tool", key, id: block.id, name: block.name, input: block.input });
        }
      });
    }
    for (const [n, notice] of notices.entries()) {
      if (notice.afterMessage === i) assistantTurn(`n${i}`).items.push({ kind: "notice", key: `n${n}`, notice });
    }
  });

  if (draft) {
    const turn = assistantTurn("draft");
    for (const block of draft) {
      const key = `d${block.index}${block.kind}`;
      if (block.kind === "tool_use") {
        turn.items.push({
          kind: "tool",
          key,
          id: block.id ?? key,
          name: block.name ?? "",
          input: undefined,
          partialJson: block.text,
        });
      } else if (block.text) {
        turn.items.push({ kind: block.kind, key, text: block.text, streaming: true });
      }
    }
  }
  return turns;
}
