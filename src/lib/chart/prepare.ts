import type { ChartType } from "@/lib/agent/tools";
import type { CellValue, QueryResult } from "@/lib/db/types";

export interface ChartSpec {
  title: string;
  type: ChartType;
  x: string;
  y: string[];
  series?: string;
  yFormat?: "number" | "currency" | "percent";
  stacked?: boolean;
}

export type ChartRow = Record<string, string | number | null>;

export interface ChartData {
  rows: ChartRow[];
  /** Keys of the plotted series in the rows. */
  seriesKeys: string[];
  /** Whether x values are numeric (scatter / numeric axis). */
  numericX: boolean;
}

export const MAX_SERIES = 8;
export const MAX_PIE_SLICES = 6;
export const MAX_CHART_POINTS = 2000;

export class ChartSpecError extends Error {}

function toNumber(value: CellValue): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toLabel(value: CellValue): string {
  if (value === null) return "(null)";
  return String(value);
}

/**
 * Turn a query result into Recharts-ready rows according to the spec.
 * Throws ChartSpecError with an actionable message (fed back to the model).
 */
export function prepareChartData(result: QueryResult, spec: ChartSpec): ChartData {
  const names = result.columns.map((c) => c.name);
  const indexOf = (name: string) => {
    const i = names.indexOf(name);
    if (i === -1) {
      throw new ChartSpecError(`Column "${name}" is not in the query result. Available columns: ${names.join(", ")}`);
    }
    return i;
  };
  const xi = indexOf(spec.x);
  const yis = spec.y.map(indexOf);
  if (result.rows.length === 0) throw new ChartSpecError("The chart query returned no rows.");
  if (result.rows.length > MAX_CHART_POINTS) {
    throw new ChartSpecError(
      `Too many rows to chart (${result.rows.length}); aggregate to at most ${MAX_CHART_POINTS}.`,
    );
  }

  const numericX = spec.type === "scatter";

  // Long -> wide pivot when a series column is given.
  if (spec.series) {
    const si = indexOf(spec.series);
    const yi = yis[0]!;
    const totals = new Map<string, number>();
    for (const row of result.rows) {
      const key = toLabel(row[si] ?? null);
      totals.set(key, (totals.get(key) ?? 0) + Math.abs(toNumber(row[yi] ?? null) ?? 0));
    }
    // Keep the largest series, fold the rest into "Other" (never invent a 9th colour).
    const ranked = [...totals.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    const kept = new Set(ranked.slice(0, ranked.length > MAX_SERIES ? MAX_SERIES - 1 : MAX_SERIES));
    const seriesKeys = ranked.filter((k) => kept.has(k)).sort();
    if (ranked.length > kept.size) seriesKeys.push("Other");

    const byX = new Map<string, ChartRow>();
    for (const row of result.rows) {
      const xValue = row[xi] ?? null;
      const xKey = toLabel(xValue);
      let out = byX.get(xKey);
      if (!out) {
        out = { [spec.x]: numericX ? toNumber(xValue) : xKey };
        byX.set(xKey, out);
      }
      const raw = toLabel(row[si] ?? null);
      const key = kept.has(raw) ? raw : "Other";
      const value = toNumber(row[yi] ?? null);
      const prev = out[key];
      out[key] = value === null ? (prev ?? null) : (typeof prev === "number" ? prev : 0) + value;
    }
    return { rows: [...byX.values()], seriesKeys, numericX };
  }

  let rows: ChartRow[] = result.rows.map((row) => {
    const out: ChartRow = { [spec.x]: numericX ? toNumber(row[xi] ?? null) : toLabel(row[xi] ?? null) };
    spec.y.forEach((name, k) => {
      out[name] = toNumber(row[yis[k]!] ?? null);
    });
    return out;
  });

  if (spec.type === "pie") {
    const key = spec.y[0]!;
    rows = rows
      .filter((r) => typeof r[key] === "number" && (r[key] as number) > 0)
      .sort((a, b) => (b[key] as number) - (a[key] as number));
    if (rows.length > MAX_PIE_SLICES) {
      const head = rows.slice(0, MAX_PIE_SLICES - 1);
      const other = rows.slice(MAX_PIE_SLICES - 1).reduce((sum, r) => sum + (r[key] as number), 0);
      rows = [...head, { [spec.x]: "Other", [key]: other }];
    }
    return { rows, seriesKeys: [key], numericX: false };
  }

  return { rows, seriesKeys: spec.type === "scatter" ? [spec.y[0]!] : spec.y, numericX };
}
