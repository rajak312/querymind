import type { CellValue, ColumnType } from "@/lib/datasets/types";
import { RESERVED_WORDS } from "@/lib/sql/reserved";

export interface InferredColumn {
  /** Original header text from the file. */
  header: string;
  /** Sanitised snake_case column name that is safe to use unquoted. */
  name: string;
  type: ColumnType;
  nullCount: number;
}

export interface InferredTable {
  name: string;
  columns: InferredColumn[];
  rows: CellValue[][];
}

const NULL_TOKENS = new Set(["", "null", "na", "n/a", "nan", "none", "-", "#n/a"]);
const INTEGER_RE = /^[-+]?\d+$/;
const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TRUE_TOKENS = new Set(["true", "t", "yes", "y"]);
const FALSE_TOKENS = new Set(["false", "f", "no", "n"]);
const INT4_MAX = 2_147_483_647;

export function isNullToken(value: string): boolean {
  return NULL_TOKENS.has(value.trim().toLowerCase());
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Strip thousands separators and currency symbols commonly found in exports: "$1,234.50" -> "1234.50". */
function normalizeNumber(value: string): string {
  return value
    .trim()
    .replace(/^\$/, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
}

type Candidate = "boolean" | "integer" | "bigint" | "numeric" | "date" | "timestamp" | "text";

function classify(value: string): Candidate[] {
  const v = value.trim();
  const lower = v.toLowerCase();
  const matches: Candidate[] = [];
  if (TRUE_TOKENS.has(lower) || FALSE_TOKENS.has(lower)) matches.push("boolean");
  const num = normalizeNumber(v);
  if (INTEGER_RE.test(num)) {
    // Leading zeros (zip codes, ids like 00123) are identifiers, not numbers.
    const leadingZero = /^[-+]?0\d/.test(num);
    if (!leadingZero) {
      const n = Number(num);
      if (Math.abs(n) <= INT4_MAX) matches.push("integer");
      if (Number.isSafeInteger(n)) matches.push("bigint");
      matches.push("numeric");
    }
  } else if (NUMERIC_RE.test(num)) {
    matches.push("numeric");
  }
  const date = DATE_RE.exec(v);
  if (date && isValidDate(Number(date[1]), Number(date[2]), Number(date[3]))) matches.push("date", "timestamp");
  const ts = TIMESTAMP_RE.exec(v);
  if (ts && isValidDate(Number(ts[1]), Number(ts[2]), Number(ts[3]))) matches.push("timestamp");
  matches.push("text");
  return matches;
}

const PRIORITY: Candidate[] = ["boolean", "integer", "bigint", "numeric", "date", "timestamp", "text"];

/** Infer the narrowest Postgres type that accepts every non-null value. */
export function inferColumnType(values: readonly string[]): ColumnType {
  let candidates = new Set<Candidate>(PRIORITY);
  let seen = 0;
  for (const raw of values) {
    if (isNullToken(raw)) continue;
    seen++;
    const matches = new Set(classify(raw));
    candidates = new Set([...candidates].filter((c) => matches.has(c)));
    if (candidates.size === 1) break; // only "text" left
  }
  if (seen === 0) return "text";
  const winner = PRIORITY.find((c) => candidates.has(c)) ?? "text";
  return winner;
}

/** Convert a raw CSV string into a typed cell for the inferred column type. */
export function coerceValue(raw: string, type: ColumnType): CellValue {
  if (isNullToken(raw)) return null;
  const v = raw.trim();
  switch (type) {
    case "boolean":
      return TRUE_TOKENS.has(v.toLowerCase());
    case "integer":
    case "bigint":
    case "numeric":
    case "double precision":
      return Number(normalizeNumber(v));
    case "date":
      return v;
    case "timestamp":
      return v.replace("T", " ").replace(/(Z|[+-]\d{2}:?\d{2})$/, "");
    default:
      return raw;
  }
}

/** Turn arbitrary header / file names into safe, unquoted snake_case identifiers. */
export function toIdentifier(input: string, fallback: string): string {
  let id = input
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = `c_${id}`;
  if (RESERVED_WORDS.has(id)) id = `${id}_value`;
  return id;
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

/**
 * Build a typed table from parsed CSV rows (first row = header).
 * Every value is examined, so a stray "N/A" deep in the file cannot break the
 * insert later on.
 */
export function inferTable(fileName: string, data: string[][]): InferredTable {
  const [header = [], ...body] = data;
  const rows = body.filter((r) => r.some((cell) => cell.trim() !== ""));
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => header[i]?.trim() || `column_${i + 1}`);
  const names = uniqueNames(headers.map((h, i) => toIdentifier(h, `column_${i + 1}`)));

  const columns: InferredColumn[] = headers.map((h, i) => {
    const values = rows.map((r) => r[i] ?? "");
    return {
      header: h,
      name: names[i]!,
      type: inferColumnType(values),
      nullCount: values.filter(isNullToken).length,
    };
  });

  const typedRows = rows.map((r) => columns.map((c, i) => coerceValue(r[i] ?? "", c.type)));
  const baseName = fileName.replace(/\.(csv|tsv|txt)$/i, "");
  return { name: toIdentifier(baseName, "uploaded_table"), columns, rows: typedRows };
}
