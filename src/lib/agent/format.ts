import type { QueryResult, TableProfile } from "@/lib/db/types";

/** Rows of a query result that are shown to the model. The user sees the full table. */
export const MODEL_ROW_LIMIT = 50;
/** Hard ceiling on the serialized tool result to keep the context lean. */
export const MODEL_CHAR_LIMIT = 12_000;

/**
 * Compact JSON representation of a query result for a `tool_result` block.
 * Rows are sent as arrays (not objects) to avoid repeating column names, and
 * truncated to both a row and a character budget.
 */
export function formatQueryResultForModel(result: QueryResult): string {
  const base = {
    columns: result.columns.map((c) => `${c.name} (${c.type})`),
    row_count: result.rowCount,
    result_truncated_at_1000_rows: result.truncated || undefined,
  };
  let shown = Math.min(result.rows.length, MODEL_ROW_LIMIT);
  let text = "";
  // Shrink until it fits the character budget.
  for (;;) {
    const payload = {
      ...base,
      rows: result.rows.slice(0, shown),
      ...(shown < result.rows.length
        ? { note: `Showing the first ${shown} of ${result.rowCount} rows. Aggregate in SQL if you need the rest.` }
        : {}),
    };
    text = JSON.stringify(payload);
    if (text.length <= MODEL_CHAR_LIMIT || shown <= 1) break;
    shown = Math.max(1, Math.floor(shown / 2));
  }
  if (text.length > MODEL_CHAR_LIMIT) text = `${text.slice(0, MODEL_CHAR_LIMIT)}… (truncated)`;
  return text;
}

export function formatProfileForModel(profile: TableProfile): string {
  return JSON.stringify(profile).slice(0, MODEL_CHAR_LIMIT);
}
