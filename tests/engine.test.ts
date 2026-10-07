import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { inferTable } from "@/lib/csv/infer";
import { generateEcommerce } from "@/lib/datasets/ecommerce";
import {
  importInferredTable,
  introspect,
  loadGeneratedTables,
  PGLITE_PARSERS,
  profileTable,
  runReadOnlyQuery,
} from "@/lib/db/engine";
import { QueryError } from "@/lib/db/types";

describe("database engine (PGlite)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await PGlite.create({ parsers: PGLITE_PARSERS });
    await loadGeneratedTables(db, generateEcommerce());
  });

  it("loads the dataset with keys, comments and row counts", async () => {
    const schema = await introspect(db, "ecommerce");
    expect(schema.tables.map((t) => t.name)).toEqual(["customers", "products", "orders", "order_items"]);
    const orders = schema.tables.find((t) => t.name === "orders")!;
    expect(orders.rowCount).toBeGreaterThan(5000);
    expect(orders.description).toMatch(/order/i);
    expect(orders.columns.find((c) => c.name === "order_id")?.primaryKey).toBe(true);
    expect(orders.columns.find((c) => c.name === "customer_id")?.references).toBe("customers.customer_id");
    expect(orders.columns.find((c) => c.name === "ordered_at")?.type).toBe("timestamp");
    expect(orders.sampleRows).toHaveLength(3);
  });

  it("runs read-only queries and returns typed, JSON-safe values", async () => {
    const result = await runReadOnlyQuery(
      db,
      "SELECT date_trunc('month', ordered_at)::date AS month, count(*) AS n, round(avg(shipping_fee), 2) AS fee FROM orders GROUP BY 1 ORDER BY 1",
    );
    expect(result.columns).toEqual([
      { name: "month", type: "date" },
      { name: "n", type: "bigint" },
      { name: "fee", type: "numeric" },
    ]);
    expect(result.rowCount).toBe(24);
    expect(result.rows[0]).toEqual(["2024-10-01", expect.any(Number), expect.any(Number)]);
    expect(result.truncated).toBe(false);
  });

  it("caps rows and flags truncation", async () => {
    const result = await runReadOnlyQuery(db, "SELECT * FROM order_items", 100);
    expect(result.rowCount).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("keeps duplicate column names (array rows)", async () => {
    const result = await runReadOnlyQuery(db, "SELECT 1 AS a, 2 AS a");
    expect(result.rows).toEqual([[1, 2]]);
  });

  it("blocks writes before they reach Postgres", async () => {
    await expect(runReadOnlyQuery(db, "DELETE FROM orders")).rejects.toMatchObject({ kind: "blocked" });
  });

  it("rejects writes at the transaction level too (defence in depth)", async () => {
    // A user-defined function that writes is invisible to the lexical guard; the READ ONLY transaction stops it.
    await db.exec(
      "CREATE OR REPLACE FUNCTION qm_test_write() RETURNS int LANGUAGE sql AS $$ INSERT INTO products (product_id, name, category, brand, list_price, unit_cost, launched_on) VALUES (9999, 'x', 'x', 'x', 1, 1, '2024-01-01') RETURNING 1 $$",
    );
    await expect(runReadOnlyQuery(db, "SELECT qm_test_write()")).rejects.toThrow(/read-only transaction/);
    const count = await runReadOnlyQuery(db, "SELECT count(*) AS n FROM products WHERE product_id = 9999");
    expect(count.rows[0]).toEqual([0]);
  });

  it("returns SQL errors with Postgres hints for self-correction", async () => {
    const error = await runReadOnlyQuery(db, "SELECT order_date FROM orders").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).message).toMatch(/order_date/);
  });

  it("profiles a table", async () => {
    const profile = await profileTable(db, "orders");
    const status = profile.columns.find((c) => c.name === "status")!;
    expect(status.distinctCount).toBe(5);
    expect(status.topValues?.[0]?.value).toBe("delivered");
    await expect(profileTable(db, "nope")).rejects.toThrow(/Available tables/);
  });

  it("imports an inferred CSV table and dedupes names", async () => {
    const table = inferTable("targets.csv", [
      ["Region", "Target"],
      ["Europe", "100000"],
      ["Asia Pacific", "80000"],
    ]);
    expect(await importInferredTable(db, table, "targets.csv")).toBe("targets");
    expect(await importInferredTable(db, table, "targets.csv")).toBe("targets_2");
    const result = await runReadOnlyQuery(db, "SELECT sum(target) AS total FROM targets");
    expect(result.rows).toEqual([[180000]]);
  });
});
