import type { PGlite, PGliteOptions } from "@electric-sql/pglite";
import type { CellValue, ColumnDef, GeneratedTable } from "@/lib/datasets/types";
import type { InferredTable } from "@/lib/csv/infer";
import { checkReadOnlySql } from "@/lib/sql/guard";
import type {
  ColumnProfile,
  DatabaseSchema,
  QueryColumn,
  QueryResult,
  SchemaColumn,
  SchemaTable,
  TableProfile,
} from "./types";
import { isNumericType, QueryError } from "./types";

/**
 * Database engine: everything that touches PGlite lives here so it can run in
 * the Web Worker (browser) and directly in Node (tests) unchanged.
 */

export const DEFAULT_MAX_ROWS = 1000;

/** Keep dates/timestamps as the literal strings Postgres returns (no timezone surprises) and numerics as numbers. */
export const PGLITE_PARSERS: NonNullable<PGliteOptions["parsers"]> = {
  1082: (v: string) => v, // date
  1114: (v: string) => v, // timestamp
  1184: (v: string) => v, // timestamptz
  1700: (v: string) => Number(v), // numeric
  20: (v: string) => {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v;
  }, // int8
};

const TYPE_NAMES: Record<number, string> = {
  16: "boolean",
  20: "bigint",
  21: "smallint",
  23: "integer",
  700: "real",
  701: "double precision",
  1700: "numeric",
  25: "text",
  1042: "text",
  1043: "text",
  19: "text",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  1186: "interval",
  114: "json",
  3802: "jsonb",
  2950: "uuid",
};

/** A tiny mutex so read-only transactions never interleave on one connection. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
const locks = new WeakMap<PGlite, Mutex>();
function lockFor(db: PGlite): Mutex {
  let lock = locks.get(db);
  if (!lock) {
    lock = new Mutex();
    locks.set(db, lock);
  }
  return lock;
}

export function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `\\x${Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return JSON.stringify(value);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Loading data
// ---------------------------------------------------------------------------

async function insertRows(db: PGlite, table: string, columns: string[], rows: CellValue[][]) {
  if (rows.length === 0) return;
  const batchSize = Math.max(1, Math.floor(30_000 / columns.length));
  const columnList = columns.map(quoteIdent).join(", ");
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params: CellValue[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((_, c) => {
        params.push(row[c] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await db.query(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${tuples.join(", ")}`, params);
  }
}

function columnDdl(column: ColumnDef): string {
  const parts = [quoteIdent(column.name), column.type];
  if (column.primaryKey) parts.push("PRIMARY KEY");
  else if (column.nullable === false) parts.push("NOT NULL");
  return parts.join(" ");
}

/** Create and populate the generated tables of a built-in dataset. */
export async function loadGeneratedTables(db: PGlite, tables: GeneratedTable[]): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as PGlite;
    for (const table of tables) {
      await t.exec(`CREATE TABLE ${quoteIdent(table.name)} (${table.columns.map(columnDdl).join(", ")})`);
      await t.exec(`COMMENT ON TABLE ${quoteIdent(table.name)} IS ${quoteLiteral(table.description)}`);
      for (const column of table.columns) {
        if (column.description) {
          await t.exec(
            `COMMENT ON COLUMN ${quoteIdent(table.name)}.${quoteIdent(column.name)} IS ${quoteLiteral(column.description)}`,
          );
        }
      }
      await insertRows(
        t,
        table.name,
        table.columns.map((c) => c.name),
        table.rows,
      );
    }
    // Foreign keys + indexes after the bulk load (faster than checking per row).
    for (const table of tables) {
      for (const column of table.columns) {
        if (!column.references) continue;
        const [refTable, refColumn] = column.references.split(".");
        await t.exec(
          `ALTER TABLE ${quoteIdent(table.name)} ADD FOREIGN KEY (${quoteIdent(column.name)}) REFERENCES ${quoteIdent(refTable!)} (${quoteIdent(refColumn!)});
           CREATE INDEX ON ${quoteIdent(table.name)} (${quoteIdent(column.name)});`,
        );
      }
    }
  });
  await db.exec("ANALYZE");
}

export async function tableExists(db: PGlite, name: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1) AS exists",
    [name],
  );
  return result.rows[0]?.exists ?? false;
}

/** Create a table from an inferred CSV. Returns the final (deduplicated) table name. */
export async function importInferredTable(db: PGlite, table: InferredTable, sourceName: string): Promise<string> {
  let name = table.name;
  for (let i = 2; await tableExists(db, name); i++) name = `${table.name}_${i}`;
  await db.transaction(async (tx) => {
    const t = tx as unknown as PGlite;
    await t.exec(
      `CREATE TABLE ${quoteIdent(name)} (${table.columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(", ")})`,
    );
    await t.exec(`COMMENT ON TABLE ${quoteIdent(name)} IS ${quoteLiteral(`Uploaded from ${sourceName}`)}`);
    for (const column of table.columns) {
      if (column.header !== column.name) {
        await t.exec(
          `COMMENT ON COLUMN ${quoteIdent(name)}.${quoteIdent(column.name)} IS ${quoteLiteral(`Original header: ${column.header}`)}`,
        );
      }
    }
    await insertRows(
      t,
      name,
      table.columns.map((c) => c.name),
      table.rows,
    );
  });
  await db.exec(`ANALYZE ${quoteIdent(name)}`);
  return name;
}

export async function dropTable(db: PGlite, name: string): Promise<void> {
  if (!(await tableExists(db, name))) throw new QueryError(`Table ${name} does not exist`, "internal");
  await db.exec(`DROP TABLE ${quoteIdent(name)} CASCADE`);
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

function friendlyType(formatted: string): string {
  if (formatted.startsWith("timestamp without")) return "timestamp";
  if (formatted.startsWith("timestamp with")) return "timestamptz";
  if (formatted.startsWith("numeric")) return "numeric";
  if (formatted.startsWith("character varying") || formatted.startsWith("character")) return "text";
  return formatted;
}

export async function introspect(db: PGlite, datasetId: string, sampleSize = 3): Promise<DatabaseSchema> {
  const columns = await db.query<{
    table_name: string;
    table_comment: string | null;
    column_name: string;
    data_type: string;
    column_comment: string | null;
    nullable: boolean;
  }>(`
    SELECT c.relname AS table_name,
           obj_description(c.oid, 'pg_class') AS table_comment,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type,
           col_description(c.oid, a.attnum) AS column_comment,
           NOT a.attnotnull AS nullable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.oid, a.attnum`);

  const constraints = await db.query<{ table_name: string; def: string }>(`
    SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype IN ('p', 'f')`);

  const tables = new Map<string, SchemaTable>();
  for (const row of columns.rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = {
        name: row.table_name,
        description: row.table_comment ?? undefined,
        rowCount: 0,
        columns: [],
        sampleRows: [],
      };
      tables.set(row.table_name, table);
    }
    const column: SchemaColumn = {
      name: row.column_name,
      type: friendlyType(row.data_type),
      nullable: row.nullable,
    };
    if (row.column_comment) column.description = row.column_comment;
    table.columns.push(column);
  }

  for (const { table_name, def } of constraints.rows) {
    const table = tables.get(table_name.replace(/^"|"$/g, ""));
    if (!table) continue;
    const pk = /^PRIMARY KEY \((.+)\)$/.exec(def);
    if (pk) {
      for (const name of pk[1]!.split(",").map((s) => s.trim().replace(/^"|"$/g, ""))) {
        const col = table.columns.find((c) => c.name === name);
        if (col) col.primaryKey = true;
      }
    }
    const fk = /^FOREIGN KEY \((.+?)\) REFERENCES ([^(]+)\((.+?)\)/.exec(def);
    if (fk) {
      const col = table.columns.find((c) => c.name === fk[1]!.replace(/^"|"$/g, ""));
      if (col) col.references = `${fk[2]!.trim().replace(/^"|"$/g, "")}.${fk[3]!.replace(/^"|"$/g, "")}`;
    }
  }

  for (const table of tables.values()) {
    const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${quoteIdent(table.name)}`);
    table.rowCount = count.rows[0]?.n ?? 0;
    const sample = await db.query<unknown[]>(`SELECT * FROM ${quoteIdent(table.name)} LIMIT ${sampleSize}`, [], {
      rowMode: "array",
    });
    table.sampleRows = sample.rows.map((r) => r.map(normalizeCell));
  }

  return { datasetId, tables: [...tables.values()] };
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Run a single read-only statement.
 * Layer 1: lexical guard. Layer 2: READ ONLY transaction that is always rolled back.
 * Results are capped at `maxRows` (one extra row is fetched to detect truncation).
 */
export async function runReadOnlyQuery(db: PGlite, sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
  const guard = checkReadOnlySql(sql);
  if (!guard.ok) throw new QueryError(guard.reason, "blocked");

  return lockFor(db).run(async () => {
    const wrapped = `SELECT * FROM (\n${guard.sql}\n) AS querymind_result LIMIT ${maxRows + 1}`;
    await db.exec("BEGIN TRANSACTION READ ONLY");
    const started = now();
    try {
      const result = await db.query<unknown[]>(wrapped, [], { rowMode: "array" });
      const durationMs = now() - started;
      const truncated = result.rows.length > maxRows;
      const rows = (truncated ? result.rows.slice(0, maxRows) : result.rows).map((r) => r.map(normalizeCell));
      const columns: QueryColumn[] = result.fields.map((f) => ({
        name: f.name,
        type: TYPE_NAMES[f.dataTypeID] ?? "unknown",
      }));
      return { columns, rows, rowCount: rows.length, truncated, durationMs: Math.round(durationMs * 10) / 10 };
    } catch (error) {
      throw new QueryError(cleanPgError(error));
    } finally {
      await db.exec("ROLLBACK");
    }
  });
}

function cleanPgError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Positions refer to our wrapper, so drop them; keep hints when present.
  const hint = (error as { hint?: string }).hint;
  return hint ? `${message} (hint: ${hint})` : message;
}

/** Column-level profile used by the describe_table tool. */
export async function profileTable(db: PGlite, tableName: string): Promise<TableProfile> {
  const schema = await introspect(db, "", 0);
  const table = schema.tables.find((t) => t.name === tableName);
  if (!table) {
    throw new QueryError(
      `Table "${tableName}" does not exist. Available tables: ${schema.tables.map((t) => t.name).join(", ")}`,
    );
  }
  const t = quoteIdent(table.name);
  const profiles: ColumnProfile[] = [];
  for (const column of table.columns) {
    const c = quoteIdent(column.name);
    const orderable = column.type !== "boolean" && column.type !== "json" && column.type !== "jsonb";
    const stats = await db.query<unknown[]>(
      `SELECT count(*) FILTER (WHERE ${c} IS NULL), count(DISTINCT ${c})${orderable ? `, min(${c}), max(${c})` : ""} FROM ${t}`,
      [],
      { rowMode: "array" },
    );
    const [nullCount, distinctCount, min, max] = (stats.rows[0] ?? []).map(normalizeCell);
    const profile: ColumnProfile = {
      name: column.name,
      type: column.type,
      nullCount: Number(nullCount ?? 0),
      distinctCount: Number(distinctCount ?? 0),
    };
    if (orderable && !["text"].includes(column.type)) {
      profile.min = min ?? null;
      profile.max = max ?? null;
    }
    if (!isNumericType(column.type) && profile.distinctCount <= 40) {
      const top = await db.query<unknown[]>(
        `SELECT ${c}, count(*) AS n FROM ${t} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
        [],
        { rowMode: "array" },
      );
      profile.topValues = top.rows.map((r) => ({ value: normalizeCell(r[0]), count: Number(r[1]) }));
    }
    profiles.push(profile);
  }
  return { table: table.name, rowCount: table.rowCount, columns: profiles };
}
