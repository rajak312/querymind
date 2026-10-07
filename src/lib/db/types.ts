import type { CellValue } from "@/lib/datasets/types";

export type { CellValue };

export interface QueryColumn {
  name: string;
  /** Friendly type name: integer, numeric, text, date, timestamp, boolean, ... */
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: CellValue[][];
  /** Rows returned (after the row cap). */
  rowCount: number;
  /** True when the query produced more rows than the cap. */
  truncated: boolean;
  durationMs: number;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  /** `table.column` */
  references?: string;
  description?: string;
}

export interface SchemaTable {
  name: string;
  description?: string;
  rowCount: number;
  columns: SchemaColumn[];
  sampleRows: CellValue[][];
}

export interface DatabaseSchema {
  datasetId: string;
  tables: SchemaTable[];
}

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  min?: CellValue;
  max?: CellValue;
  topValues?: { value: CellValue; count: number }[];
}

export interface TableProfile {
  table: string;
  rowCount: number;
  columns: ColumnProfile[];
}

export class QueryError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "sql" | "internal" = "sql",
  ) {
    super(message);
    this.name = "QueryError";
  }
}

const NUMERIC_TYPES = new Set(["integer", "bigint", "smallint", "numeric", "real", "double precision"]);

export function isNumericType(type: string): boolean {
  return NUMERIC_TYPES.has(type);
}
