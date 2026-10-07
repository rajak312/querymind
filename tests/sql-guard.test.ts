import { describe, expect, it } from "vitest";
import { checkReadOnlySql, tokenize } from "@/lib/sql/guard";

const allowed = (sql: string) => checkReadOnlySql(sql).ok;

describe("checkReadOnlySql", () => {
  it.each([
    "SELECT 1",
    "select * from orders limit 10;",
    "WITH t AS (SELECT 1 AS x) SELECT x FROM t",
    "VALUES (1), (2)",
    "TABLE orders",
    "(SELECT 1) UNION ALL (SELECT 2)",
    "SELECT 'drop table orders; delete from x' AS note",
    'SELECT "update" FROM t -- delete everything\n',
    "SELECT /* insert into */ 1",
    "SELECT $$ truncate $$ AS s",
    "SELECT last_update, created_at, deleted_flag FROM t",
    "SELECT date_trunc('month', ordered_at)::date FROM orders;;",
  ])("allows %s", (sql) => {
    expect(allowed(sql)).toBe(true);
  });

  it.each([
    ["INSERT INTO t VALUES (1)", /INSERT/],
    ["update t set a = 1", /UPDATE/],
    ["DELETE FROM orders", /DELETE/],
    ["DROP TABLE orders", /DROP/],
    ["CREATE TABLE x (a int)", /CREATE/],
    ["ALTER TABLE orders ADD COLUMN x int", /ALTER/],
    ["TRUNCATE orders", /TRUNCATE/],
    ["COPY orders TO '/tmp/x'", /COPY/],
    ["SELECT 1; DROP TABLE orders", /single SQL statement/],
    ["SELECT 1; SELECT 2", /single SQL statement/],
    ["WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d", /DELETE/],
    ["SELECT * INTO backup FROM orders", /INTO/],
    ["SELECT * FROM orders FOR UPDATE", /UPDATE/],
    ["SELECT pg_sleep(10)", /pg_sleep/],
    ["SELECT set_config('x', 'y', false)", /set_config/],
    ["SELECT nextval('seq')", /nextval/],
    ["SET search_path = x", /SET/],
    ["BEGIN; SELECT 1", /single SQL statement/],
    ["EXPLAIN ANALYZE DELETE FROM orders", /EXPLAIN/],
    ["", /empty/],
    ["-- just a comment", /comments/],
    ["SELECT 'unterminated", /Unterminated/],
  ])("rejects %s", (sql, reason) => {
    const result = checkReadOnlySql(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("strips trailing semicolons so the query can be wrapped", () => {
    expect(checkReadOnlySql("SELECT 1 ;  \n")).toEqual({ ok: true, sql: "SELECT 1" });
  });

  it("is not fooled by keywords inside quoted identifiers or strings", () => {
    const tokens = tokenize(`SELECT "delete" , 'drop' FROM t`);
    expect(tokens.map((t) => t.kind)).toEqual(["word", "quoted", "symbol", "string", "word", "word"]);
  });

  it("handles E'' escape strings", () => {
    expect(allowed(String.raw`SELECT E'it\'s; DROP' AS x`)).toBe(true);
  });
});
