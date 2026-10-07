import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILTIN_DATASETS } from "@/lib/datasets";
import { Random } from "@/lib/datasets/prng";
import type { GeneratedTable } from "@/lib/datasets/types";

const hash = (tables: GeneratedTable[]) => createHash("sha256").update(JSON.stringify(tables)).digest("hex");

describe("Random", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = new Random(42);
    const b = new Random(42);
    const c = new Random(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("int() stays within bounds", () => {
    const r = new Random(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe.each(BUILTIN_DATASETS.map((d) => [d.id, d] as const))("dataset %s", (_id, dataset) => {
  const tables = dataset.generate();

  it("generates identical data on every run", () => {
    expect(hash(dataset.generate())).toBe(hash(tables));
  });

  it("has rows that match the column definitions", () => {
    for (const table of tables) {
      expect(table.rows.length).toBeGreaterThan(0);
      for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
    }
  });

  it("has unique primary keys and valid foreign keys", () => {
    const keys = new Map<string, Set<unknown>>();
    for (const table of tables) {
      table.columns.forEach((column, i) => {
        if (!column.primaryKey) return;
        const values = new Set(table.rows.map((r) => r[i]));
        expect(values.size).toBe(table.rows.length);
        keys.set(`${table.name}.${column.name}`, values);
      });
    }
    for (const table of tables) {
      table.columns.forEach((column, i) => {
        if (!column.references) return;
        const target = keys.get(column.references)!;
        expect(target).toBeDefined();
        for (const row of table.rows) if (row[i] !== null) expect(target.has(row[i])).toBe(true);
      });
    }
  });

  it("offers starter questions", () => {
    expect(dataset.suggestions.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ecommerce shape", () => {
  const tables = BUILTIN_DATASETS.find((d) => d.id === "ecommerce")!.generate();
  const orders = tables.find((t) => t.name === "orders")!;

  it("covers two years with holiday seasonality", () => {
    const byMonth = new Map<string, number>();
    for (const row of orders.rows) {
      const month = String(row[2]).slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    expect(byMonth.size).toBe(24);
    expect(byMonth.get("2025-12")!).toBeGreaterThan(byMonth.get("2025-02")! * 1.5);
  });
});
