export type ColumnType =
  "integer" | "bigint" | "numeric" | "double precision" | "text" | "boolean" | "date" | "timestamp";

export interface ColumnDef {
  name: string;
  type: ColumnType;
  description?: string;
  primaryKey?: boolean;
  /** `table.column` this column references. */
  references?: string;
  nullable?: boolean;
}

export interface TableDef {
  name: string;
  description: string;
  columns: ColumnDef[];
}

export type CellValue = string | number | boolean | null;

export interface GeneratedTable extends TableDef {
  rows: CellValue[][];
}

export interface DatasetMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Starter questions shown in the empty chat state. */
  suggestions: string[];
}

export interface BuiltinDataset extends DatasetMeta {
  generate: () => GeneratedTable[];
}
