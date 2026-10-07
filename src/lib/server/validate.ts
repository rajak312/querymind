import { z } from "zod";
import type { ChatRequestBody } from "@/lib/agent/events";

/**
 * Request validation for /api/chat. The client controls the transcript, so we
 * bound its size and only accept the block types this app produces (no
 * images/documents/server tools) before forwarding anything to Claude.
 */

export const MAX_BODY_BYTES = 1_500_000;
export const MAX_MESSAGES = 160;

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const schemaSchema = z.object({
  tables: z
    .array(
      z.object({
        name: z.string().max(128),
        description: z.string().max(1000).optional(),
        rowCount: z.number().int().nonnegative(),
        columns: z
          .array(
            z.object({
              name: z.string().max(128),
              type: z.string().max(64),
              primaryKey: z.boolean().optional(),
              references: z.string().max(260).optional(),
              description: z.string().max(500).optional(),
            }),
          )
          .max(200),
        sampleRows: z.array(z.array(cell).max(200)).max(5),
      }),
    )
    .max(60),
});

// Content blocks are validated loosely (`looseObject`) because thinking and
// fallback blocks carry fields we must echo back byte-for-byte.
const block = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text"), text: z.string().max(100_000) }),
  z.looseObject({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  z.looseObject({ type: z.literal("redacted_thinking"), data: z.string() }),
  z.looseObject({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.looseObject({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([
      z.string().max(60_000),
      z.array(z.object({ type: z.literal("text"), text: z.string().max(60_000) })),
    ]),
    is_error: z.boolean().optional(),
  }),
  z.looseObject({ type: z.literal("fallback") }),
]);

const message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string().min(1).max(8_000), z.array(block).min(1).max(64)]),
});

export const chatRequestSchema = z.object({
  datasetId: z.string().min(1).max(64),
  dataset: z.object({ name: z.string().max(120), description: z.string().max(1000) }),
  schema: schemaSchema,
  messages: z
    .array(message)
    .min(1)
    .max(MAX_MESSAGES)
    .refine((messages) => messages[0]?.role === "user", "The first message must come from the user."),
});

export type ParsedChatRequest = ChatRequestBody;

export function parseChatRequest(json: unknown): { ok: true; data: ParsedChatRequest } | { ok: false; error: string } {
  const result = chatRequestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid request" };
  }
  // Forward the transcript exactly as received (not zod's re-built copy) so
  // thinking/fallback blocks reach the API byte-for-byte unchanged.
  const raw = json as ChatRequestBody;
  return {
    ok: true,
    data: {
      datasetId: result.data.datasetId,
      dataset: result.data.dataset,
      schema: result.data.schema,
      messages: raw.messages,
    },
  };
}
