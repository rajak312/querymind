import type { InferredTable } from "@/lib/csv/infer";
import type { DatabaseSchema, QueryResult, TableProfile } from "./types";

/** Messages the UI thread sends to the database worker. */
export type WorkerRequest =
  | { id: number; op: "open"; datasetId: string }
  | { id: number; op: "query"; datasetId: string; sql: string; maxRows?: number }
  | { id: number; op: "profile"; datasetId: string; table: string }
  | { id: number; op: "import"; table: InferredTable; sourceName: string }
  | { id: number; op: "drop"; table: string };

export interface WorkerResponseMap {
  open: DatabaseSchema;
  query: QueryResult;
  profile: TableProfile;
  import: { schema: DatabaseSchema; tableName: string };
  drop: DatabaseSchema;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; kind: "blocked" | "sql" | "internal" } };
