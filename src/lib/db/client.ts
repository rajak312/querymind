"use client";

import type { InferredTable } from "@/lib/csv/infer";
import type { WorkerRequest, WorkerResponse, WorkerResponseMap } from "./protocol";
import { QueryError } from "./types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestWithoutId = DistributiveOmit<WorkerRequest, "id">;

/**
 * Promise-based client for the database worker. One worker per tab; requests
 * are correlated by id.
 */
class DatabaseClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
      this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const entry = this.pending.get(response.id);
        if (!entry) return;
        this.pending.delete(response.id);
        if (response.ok) entry.resolve(response.result);
        else entry.reject(new QueryError(response.error.message, response.error.kind));
      });
      this.worker.addEventListener("error", (event) => {
        const error = new QueryError(event.message || "The database worker crashed", "internal");
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      });
    }
    return this.worker;
  }

  private call<K extends WorkerRequest["op"]>(
    request: Extract<RequestWithoutId, { op: K }>,
  ): Promise<WorkerResponseMap[K]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.getWorker().postMessage({ ...request, id } as WorkerRequest);
    });
  }

  open(datasetId: string) {
    return this.call<"open">({ op: "open", datasetId });
  }

  query(datasetId: string, sql: string, maxRows?: number) {
    return this.call<"query">({ op: "query", datasetId, sql, maxRows });
  }

  profile(datasetId: string, table: string) {
    return this.call<"profile">({ op: "profile", datasetId, table });
  }

  importTable(table: InferredTable, sourceName: string) {
    return this.call<"import">({ op: "import", table, sourceName });
  }

  dropTable(table: string) {
    return this.call<"drop">({ op: "drop", table });
  }
}

let client: DatabaseClient | null = null;

export function getDatabaseClient(): DatabaseClient {
  client ??= new DatabaseClient();
  return client;
}

export type { DatabaseClient };
