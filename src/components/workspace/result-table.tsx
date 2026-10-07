"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { isNumericType, type CellValue, type QueryResult } from "@/lib/db/types";
import { cn, downloadText, formatCell, formatCount, toCsv } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const INITIAL_ROWS = 100;

function compare(a: CellValue, b: CellValue): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function ResultTable({
  result,
  maxHeight = 320,
  filename = "querymind-result",
  className,
  showFooter = true,
}: {
  result: QueryResult;
  maxHeight?: number | string;
  filename?: string;
  className?: string;
  showFooter?: boolean;
}) {
  const [sort, setSort] = useState<{ column: number; dir: "asc" | "desc" } | null>(null);
  const [limit, setLimit] = useState(INITIAL_ROWS);

  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const sorted = [...result.rows].sort((a, b) => compare(a[sort.column] ?? null, b[sort.column] ?? null));
    return sort.dir === "desc" ? sorted.reverse() : sorted;
  }, [result.rows, sort]);

  const numeric = result.columns.map((c) => isNumericType(c.type));

  const toggleSort = (column: number) =>
    setSort((s) => (s?.column !== column ? { column, dir: "asc" } : s.dir === "asc" ? { column, dir: "desc" } : null));

  if (result.columns.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted">The query ran successfully but returned no columns.</p>;
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-10 border-b border-border bg-surface-2 px-2 py-2 text-right text-[11px] font-medium text-subtle">
                #
              </th>
              {result.columns.map((column, i) => {
                const active = sort?.column === i;
                const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={`${column.name}-${i}`}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className="border-b border-border bg-surface-2 p-0 text-left font-medium whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(i)}
                      className={cn(
                        "group flex w-full items-center gap-1.5 px-3 py-2 hover:text-foreground",
                        numeric[i] && "justify-end",
                        active ? "text-foreground" : "text-muted",
                      )}
                      title={`${column.name} (${column.type}) — click to sort`}
                    >
                      <span>{column.name}</span>
                      <Icon className={cn("size-3", active ? "opacity-100" : "opacity-0 group-hover:opacity-60")} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, r) => (
              <tr key={r} className="hover:bg-surface-2/60">
                <td className="border-b border-border/70 px-2 py-1.5 text-right text-[11px] text-subtle">{r + 1}</td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "max-w-[320px] truncate border-b border-border/70 px-3 py-1.5 whitespace-nowrap",
                      numeric[c] && "text-right",
                      cell === null && "text-subtle italic",
                    )}
                    title={cell === null ? "NULL" : String(cell)}
                  >
                    {formatCell(cell, result.columns[c]?.name ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No rows returned.</p>}
        {rows.length > limit && (
          <div className="flex justify-center p-2">
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 400)}>
              Show more rows ({formatCount(rows.length - limit)} hidden)
            </Button>
          </div>
        )}
      </div>
      {showFooter && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted">
          <span>
            {formatCount(result.rowCount)} {result.rowCount === 1 ? "row" : "rows"}
            {result.truncated && (
              <span className="text-warning"> · limited to the first {formatCount(result.rowCount)}</span>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() =>
              downloadText(
                `${filename}.csv`,
                toCsv(
                  result.columns.map((c) => c.name),
                  result.rows,
                ),
              )
            }
          >
            <Download /> CSV
          </Button>
        </div>
      )}
    </div>
  );
}
