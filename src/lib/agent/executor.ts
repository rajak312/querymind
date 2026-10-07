import { ChartSpecError, prepareChartData, type ChartSpec } from "@/lib/chart/prepare";
import type { QueryResult, TableProfile } from "@/lib/db/types";
import { formatProfileForModel, formatQueryResultForModel } from "./format";
import type { ToolExecution, ValidatedToolUse } from "./loop";
import type { DescribeTableInput, RenderChartInput, RunSqlInput } from "./tools";

export interface ExecutorBackend {
  query: (sql: string, maxRows?: number) => Promise<QueryResult>;
  profile: (table: string) => Promise<TableProfile>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

/** Build the browser-side tool executor used by the agent loop. */
export function createToolExecutor(backend: ExecutorBackend) {
  return async function executeTool(block: ValidatedToolUse): Promise<ToolExecution> {
    const started = performance.now();
    const base = { id: block.id, name: block.name, input: block.input };

    switch (block.name) {
      case "run_sql": {
        const input = block.input as RunSqlInput;
        try {
          const result = await backend.query(input.sql);
          return {
            content: formatQueryResultForModel(result),
            isError: false,
            run: {
              ...base,
              status: "success",
              sql: input.sql,
              purpose: input.purpose,
              result,
              durationMs: result.durationMs,
            },
          };
        } catch (error) {
          const message = errorMessage(error);
          return {
            content: `SQL error: ${message}`,
            isError: true,
            run: {
              ...base,
              status: "error",
              sql: input.sql,
              purpose: input.purpose,
              error: message,
              durationMs: elapsed(started),
            },
          };
        }
      }

      case "render_chart": {
        const input = block.input as RenderChartInput;
        const spec: ChartSpec = {
          title: input.title,
          type: input.type,
          x: input.x,
          y: input.y,
          series: input.series,
          yFormat: input.y_format,
          stacked: input.stacked,
        };
        try {
          const result = await backend.query(input.sql, 2000);
          const data = prepareChartData(result, spec);
          const seriesNote = data.seriesKeys.length > 1 ? ` with series ${data.seriesKeys.join(", ")}` : "";
          return {
            content: `Rendered ${input.type} chart "${input.title}" from ${data.rows.length} data points${seriesNote}. The user can see it now; do not describe it pixel by pixel.`,
            isError: false,
            run: {
              ...base,
              status: "success",
              sql: input.sql,
              purpose: input.title,
              result,
              chart: { spec, data },
              durationMs: elapsed(started),
            },
          };
        } catch (error) {
          const message = errorMessage(error);
          return {
            content: error instanceof ChartSpecError ? `Chart error: ${message}` : `SQL error: ${message}`,
            isError: true,
            run: {
              ...base,
              status: "error",
              sql: input.sql,
              purpose: input.title,
              error: message,
              durationMs: elapsed(started),
            },
          };
        }
      }

      case "describe_table": {
        const input = block.input as DescribeTableInput;
        try {
          const profile = await backend.profile(input.table);
          return {
            content: formatProfileForModel(profile),
            isError: false,
            run: {
              ...base,
              status: "success",
              purpose: `Profile ${input.table}`,
              profile,
              durationMs: elapsed(started),
            },
          };
        } catch (error) {
          const message = errorMessage(error);
          return {
            content: message,
            isError: true,
            run: {
              ...base,
              status: "error",
              purpose: `Profile ${input.table}`,
              error: message,
              durationMs: elapsed(started),
            },
          };
        }
      }
    }
  };
}
