/// <reference lib="webworker" />
import { PGlite } from "@electric-sql/pglite";
import { getBuiltinDataset } from "@/lib/datasets";
import {
  dropTable,
  importInferredTable,
  introspect,
  loadGeneratedTables,
  PGLITE_PARSERS,
  profileTable,
  runReadOnlyQuery,
} from "./engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { QueryError } from "./types";

/**
 * Database worker. Owns one in-browser Postgres (PGlite) per dataset so the
 * UI thread never blocks on data generation, loading or queries.
 *
 * - Built-in datasets are generated deterministically and loaded in memory.
 * - Uploaded CSVs live in an IndexedDB-backed database so they survive reloads.
 */
declare const self: DedicatedWorkerGlobalScope;

const UPLOADS_ID = "uploads";
const databases = new Map<string, Promise<PGlite>>();

async function createDatabase(datasetId: string): Promise<PGlite> {
  if (datasetId === UPLOADS_ID) {
    return PGlite.create("idb://querymind-uploads", { parsers: PGLITE_PARSERS });
  }
  const dataset = getBuiltinDataset(datasetId);
  if (!dataset) throw new QueryError(`Unknown dataset "${datasetId}"`, "internal");
  const db = await PGlite.create({ parsers: PGLITE_PARSERS });
  await loadGeneratedTables(db, dataset.generate());
  return db;
}

function getDatabase(datasetId: string): Promise<PGlite> {
  let db = databases.get(datasetId);
  if (!db) {
    db = createDatabase(datasetId);
    // Allow a retry if creation failed.
    db.catch(() => databases.delete(datasetId));
    databases.set(datasetId, db);
  }
  return db;
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.op) {
    case "open": {
      const db = await getDatabase(request.datasetId);
      return introspect(db, request.datasetId);
    }
    case "query": {
      const db = await getDatabase(request.datasetId);
      return runReadOnlyQuery(db, request.sql, request.maxRows);
    }
    case "profile": {
      const db = await getDatabase(request.datasetId);
      return profileTable(db, request.table);
    }
    case "import": {
      const db = await getDatabase(UPLOADS_ID);
      const tableName = await importInferredTable(db, request.table, request.sourceName);
      return { schema: await introspect(db, UPLOADS_ID), tableName };
    }
    case "drop": {
      const db = await getDatabase(UPLOADS_ID);
      await dropTable(db, request.table);
      return introspect(db, UPLOADS_ID);
    }
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  handle(request).then(
    (result) => self.postMessage({ id: request.id, ok: true, result } satisfies WorkerResponse),
    (error: unknown) => {
      const kind = error instanceof QueryError ? error.kind : "internal";
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ id: request.id, ok: false, error: { message, kind } } satisfies WorkerResponse);
    },
  );
});
