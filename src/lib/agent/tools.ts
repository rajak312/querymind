import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

/**
 * Client-side tools. The server only *declares* them to Claude; the browser
 * executes them against the in-browser PGlite database and posts the results
 * back as `tool_result` blocks.
 */

export const CHART_TYPES = ["bar", "line", "area", "pie", "scatter"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const runSqlInput = z.object({
  sql: z.string().min(1).max(20_000),
  purpose: z.string().max(200).optional(),
});
export type RunSqlInput = z.infer<typeof runSqlInput>;

export const renderChartInput = z.object({
  title: z.string().min(1).max(160),
  type: z.enum(CHART_TYPES),
  sql: z.string().min(1).max(20_000),
  x: z.string().min(1),
  y: z.array(z.string().min(1)).min(1).max(6),
  series: z.string().min(1).optional(),
  y_format: z.enum(["number", "currency", "percent"]).optional(),
  stacked: z.boolean().optional(),
});
export type RenderChartInput = z.infer<typeof renderChartInput>;

export const describeTableInput = z.object({
  table: z.string().min(1).max(128),
});
export type DescribeTableInput = z.infer<typeof describeTableInput>;

export const TOOL_INPUT_SCHEMAS = {
  run_sql: runSqlInput,
  render_chart: renderChartInput,
  describe_table: describeTableInput,
} as const;
export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;

export function isToolName(name: string): name is ToolName {
  return name in TOOL_INPUT_SCHEMAS;
}

/** Tool definitions sent to Claude. */
export const TOOL_DEFINITIONS: BetaTool[] = [
  {
    name: "run_sql",
    description:
      "Execute ONE read-only PostgreSQL query (SELECT or WITH ... SELECT) against the user's dataset, which runs in their browser. " +
      "Returns column names/types, the total number of rows returned (max 1000) and up to the first 50 rows. " +
      "Writes, DDL and multiple statements are rejected. Aggregate in SQL instead of fetching raw rows. " +
      "The user sees every query you run together with its full result table.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single read-only PostgreSQL statement." },
        purpose: {
          type: "string",
          description: "Very short label for what this query checks, shown to the user (e.g. 'Monthly net revenue').",
        },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "render_chart",
    description:
      "Render a chart for the user from a read-only SQL query. Use it when a trend, comparison or distribution is the point of the answer. " +
      "The query runs again in the browser; its result columns must include `x` and every `y` column. " +
      "Use `series` to split one y column into several lines/bars by a category column (long format, max 8 series). " +
      "Pick: line/area for time series (sort by x), bar for comparing categories, pie only for <= 6 parts of a whole, scatter for two numeric measures.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, descriptive chart title." },
        type: { type: "string", enum: [...CHART_TYPES] },
        sql: { type: "string", description: "Read-only query that produces the chart data." },
        x: { type: "string", description: "Column for the x axis (or slice labels for pie)." },
        y: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 6,
          description: "Numeric column(s) to plot. Pie and scatter use the first one.",
        },
        series: {
          type: "string",
          description: "Optional category column to split a single y column into multiple series.",
        },
        y_format: { type: "string", enum: ["number", "currency", "percent"], description: "How to format values." },
        stacked: { type: "boolean", description: "Stack bars/areas (parts of a total)." },
      },
      required: ["title", "type", "sql", "x", "y"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "describe_table",
    description:
      "Profile one table: row count and, per column, null count, distinct count, min/max and the most frequent values for low-cardinality columns. " +
      "Use it when you need to know the actual values in a column (e.g. status codes) before filtering.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name exactly as listed in the schema." },
      },
      required: ["table"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];
