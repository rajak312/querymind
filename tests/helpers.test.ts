import { describe, expect, it } from "vitest";
import { formatQueryResultForModel, MODEL_CHAR_LIMIT } from "@/lib/agent/format";
import { ChartSpecError, prepareChartData } from "@/lib/chart/prepare";
import type { QueryResult } from "@/lib/db/types";
import { INSTRUCTIONS, renderSchema } from "@/lib/server/prompt";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { toCsv } from "@/lib/utils";

const result = (columns: [string, string][], rows: QueryResult["rows"]): QueryResult => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowCount: rows.length,
  truncated: false,
  durationMs: 1,
});

describe("prepareChartData", () => {
  it("pivots long data into series", () => {
    const data = prepareChartData(
      result(
        [
          ["month", "date"],
          ["region", "text"],
          ["revenue", "numeric"],
        ],
        [
          ["2025-01-01", "EU", 10],
          ["2025-01-01", "NA", 20],
          ["2025-02-01", "EU", 15],
        ],
      ),
      { title: "t", type: "line", x: "month", y: ["revenue"], series: "region" },
    );
    expect(data.seriesKeys).toEqual(["EU", "NA"]);
    expect(data.rows).toEqual([
      { month: "2025-01-01", EU: 10, NA: 20 },
      { month: "2025-02-01", EU: 15 },
    ]);
  });

  it("folds extra pie slices into Other", () => {
    const rows = Array.from({ length: 9 }, (_, i) => [`c${i}`, 10 - i] as [string, number]);
    const data = prepareChartData(
      result(
        [
          ["cat", "text"],
          ["n", "integer"],
        ],
        rows,
      ),
      { title: "t", type: "pie", x: "cat", y: ["n"] },
    );
    expect(data.rows).toHaveLength(6);
    expect(data.rows.at(-1)).toEqual({ cat: "Other", n: 5 + 4 + 3 + 2 });
  });

  it("explains missing columns so the model can fix the spec", () => {
    expect(() =>
      prepareChartData(result([["a", "text"]], [["x"]]), { title: "t", type: "bar", x: "a", y: ["b"] }),
    ).toThrow(ChartSpecError);
  });
});

describe("formatQueryResultForModel", () => {
  it("limits rows and characters sent to Claude", () => {
    const rows = Array.from({ length: 500 }, (_, i) => [i, "x".repeat(400)]);
    const text = formatQueryResultForModel(
      result(
        [
          ["id", "integer"],
          ["note", "text"],
        ],
        rows,
      ),
    );
    expect(text.length).toBeLessThanOrEqual(MODEL_CHAR_LIMIT);
    const parsed = JSON.parse(text) as { rows: unknown[]; row_count: number; note: string };
    expect(parsed.row_count).toBe(500);
    expect(parsed.rows.length).toBeLessThan(50);
    expect(parsed.note).toMatch(/first/);
  });
});

describe("prompt", () => {
  it("renders the schema with keys, descriptions and samples", () => {
    const text = renderSchema(
      { name: "Shop", description: "Demo" },
      {
        tables: [
          {
            name: "orders",
            description: "Orders",
            rowCount: 1234,
            columns: [
              { name: "order_id", type: "integer", primaryKey: true },
              { name: "customer_id", type: "integer", references: "customers.customer_id" },
            ],
            sampleRows: [[1, 2]],
          },
        ],
      },
    );
    expect(text).toContain("### orders (1,234 rows)");
    expect(text).toContain("order_id integer -- primary key");
    expect(text).toContain("references customers.customer_id");
    expect(INSTRUCTIONS).toMatch(/untrusted/);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(check("a", 0).ok).toBe(true);
    expect(check("a", 10).ok).toBe(true);
    expect(check("a", 20)).toMatchObject({ ok: false, retryAfterSeconds: 1 });
    expect(check("b", 20).ok).toBe(true);
    expect(check("a", 1001).ok).toBe(true);
  });
});

describe("toCsv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", 'say "hi"'],
          [null, "line\nbreak"],
        ],
      ),
    ).toBe('a,b\r\n"x,y","say ""hi"""\r\n,"line\nbreak"');
  });
});
