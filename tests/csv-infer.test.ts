import { describe, expect, it } from "vitest";
import { coerceValue, inferColumnType, inferTable, toIdentifier } from "@/lib/csv/infer";

describe("inferColumnType", () => {
  it.each([
    [["1", "2", "-3"], "integer"],
    [["1", "3000000000"], "bigint"],
    [["1.5", "2", "-0.25", "1e3"], "numeric"],
    [["$1,234.50", "$99"], "numeric"],
    [["true", "false", "yes", "No"], "boolean"],
    [["2024-01-31", "2023-12-01"], "date"],
    [["2024-01-31 10:00:00", "2024-02-01T08:30:00Z"], "timestamp"],
    [["2024-01-31", "2024-02-01 08:30"], "timestamp"],
    [["00123", "00456"], "text"],
    [["2024-02-30"], "text"],
    [["abc", "1"], "text"],
    [["", "NULL", "N/A"], "text"],
  ] as const)("%j -> %s", (values, type) => {
    expect(inferColumnType(values)).toBe(type);
  });

  it("ignores null tokens when inferring", () => {
    expect(inferColumnType(["1", "", "NA", "n/a", "3"])).toBe("integer");
  });
});

describe("coerceValue", () => {
  it("converts values to the column type", () => {
    expect(coerceValue("$1,234.50", "numeric")).toBe(1234.5);
    expect(coerceValue("Yes", "boolean")).toBe(true);
    expect(coerceValue("2024-02-01T08:30:00Z", "timestamp")).toBe("2024-02-01 08:30:00");
    expect(coerceValue("N/A", "integer")).toBeNull();
  });
});

describe("toIdentifier", () => {
  it("makes safe snake_case identifiers", () => {
    expect(toIdentifier("Customer Name", "c")).toBe("customer_name");
    expect(toIdentifier("orderTotal ($)", "c")).toBe("order_total");
    expect(toIdentifier("2024 Revenue", "c")).toBe("c_2024_revenue");
    expect(toIdentifier("Café Größe", "c")).toBe("cafe_grosse");
    expect(toIdentifier("order", "c")).toBe("order_value");
    expect(toIdentifier("comment", "c")).toBe("comment_value");
    expect(toIdentifier("!!!", "column_3")).toBe("column_3");
  });
});

describe("inferTable", () => {
  it("builds a typed table from parsed CSV", () => {
    const table = inferTable("Sales Report 2024.csv", [
      ["ID", "Region", "Amount", "Closed On", "Won", "Region"],
      ["001", "EMEA", "1,200.50", "2024-03-01", "yes", "x"],
      ["002", "APAC", "", "2024-03-02", "no", "y"],
      ["", "", "", "", "", ""],
    ]);
    expect(table.name).toBe("sales_report_2024");
    expect(table.columns.map((c) => [c.name, c.type])).toEqual([
      ["id", "text"],
      ["region", "text"],
      ["amount", "numeric"],
      ["closed_on", "date"],
      ["won", "boolean"],
      ["region_2", "text"],
    ]);
    expect(table.columns[2]!.nullCount).toBe(1);
    expect(table.rows).toEqual([
      ["001", "EMEA", 1200.5, "2024-03-01", true, "x"],
      ["002", "APAC", null, "2024-03-02", false, "y"],
    ]);
  });
});
