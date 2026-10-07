"use client";

import { AlertCircle, BarChart3, Clock, Download, Loader2, Play, Table2, Wand2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartView } from "@/components/charts/chart-view";
import type { SqlEditorHandle } from "@/components/editor/sql-editor";
import { Button } from "@/components/ui/button";
import { CHART_TYPES, type ChartType } from "@/lib/agent/tools";
import { ChartSpecError, prepareChartData, type ChartSpec } from "@/lib/chart/prepare";
import { getDatabaseClient } from "@/lib/db/client";
import { isNumericType, type QueryResult } from "@/lib/db/types";
import { cn, downloadText, formatCount, formatDuration, toCsv } from "@/lib/utils";
import { ResultTable } from "./result-table";
import { useWorkspace } from "./workspace-context";

const SqlEditor = dynamic(() => import("@/components/editor/sql-editor").then((m) => m.SqlEditor), {
  ssr: false,
  loading: () => (
    <div className="space-y-2 p-4">
      <div className="skeleton h-3.5 w-1/3" />
      <div className="skeleton h-3.5 w-1/2" />
      <div className="skeleton h-3.5 w-1/4" />
    </div>
  ),
});

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: QueryResult; sql: string; runId: number }
  | { status: "error"; error: string };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] text-foreground outline-none focus:border-brand/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function suggestSpec(result: QueryResult): ChartSpec {
  const numeric = result.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
  const other = result.columns.filter((c) => !isNumericType(c.type)).map((c) => c.name);
  const x = other[0] ?? result.columns[0]?.name ?? "";
  const y = numeric.filter((n) => n !== x).slice(0, 2);
  const temporal = result.columns.find((c) => c.name === x && (c.type === "date" || c.type.startsWith("timestamp")));
  // Two category columns + a measure (e.g. category, region, revenue): split by the second one.
  const series = other.length >= 2 && y.length > 0 ? other[1] : undefined;
  return {
    title: "Query result",
    type: temporal ? "line" : "bar",
    x,
    y: series ? y.slice(0, 1) : y.length ? y : [numeric[0] ?? x],
    series,
  };
}

function ChartBuilder({ result }: { result: QueryResult }) {
  // The parent remounts this component (via `key`) for every new result.
  const [spec, setSpec] = useState<ChartSpec>(() => suggestSpec(result));

  const numericColumns = result.columns.filter((c) => isNumericType(c.type));
  const prepared = useMemo(() => {
    try {
      return { data: prepareChartData(result, spec) };
    } catch (error) {
      return { error: error instanceof ChartSpecError ? error.message : String(error) };
    }
  }, [result, spec]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
      <div className="flex shrink-0 flex-col gap-3 lg:w-56">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Title
          <input
            value={spec.title}
            onChange={(e) => setSpec({ ...spec, title: e.target.value })}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] text-foreground outline-none focus:border-brand/50"
          />
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted">
          Chart type
          <div className="grid grid-cols-5 gap-1">
            {CHART_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSpec({ ...spec, type: t as ChartType })}
                className={cn(
                  "h-8 rounded-md border text-[11px] capitalize",
                  spec.type === t
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border bg-surface text-muted hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <Select
          label={spec.type === "pie" ? "Labels" : "X axis"}
          value={spec.x}
          onChange={(x) => setSpec({ ...spec, x })}
          options={result.columns.map((c) => ({ value: c.name, label: `${c.name} · ${c.type}` }))}
        />
        <fieldset className="flex flex-col gap-1 text-xs text-muted">
          <legend className="mb-1">Values</legend>
          {numericColumns.length === 0 && <span className="text-subtle">No numeric columns in this result.</span>}
          {numericColumns.map((c) => (
            <label key={c.name} className="flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--brand)]"
                checked={spec.y.includes(c.name)}
                onChange={(e) => {
                  const y = e.target.checked ? [...spec.y, c.name] : spec.y.filter((n) => n !== c.name);
                  if (y.length) setSpec({ ...spec, y: y.slice(0, 6) });
                }}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <Select
          label="Split by (series)"
          value={spec.series ?? ""}
          onChange={(series) => setSpec({ ...spec, series: series || undefined })}
          options={[
            { value: "", label: "None" },
            ...result.columns
              .filter((c) => !isNumericType(c.type) && c.name !== spec.x)
              .map((c) => ({ value: c.name, label: c.name })),
          ]}
        />
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface p-4">
        {"data" in prepared && prepared.data ? (
          <ChartView spec={spec} data={prepared.data} height={320} />
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-muted">
            {prepared.error}
          </div>
        )}
      </div>
    </div>
  );
}

export function SqlEditorPanel() {
  const { dataset, schemaState, editorSql, setEditorSql, registerInsertTarget } = useWorkspace();
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [view, setView] = useState<"table" | "chart">("table");
  const editorRef = useRef<SqlEditorHandle>(null);
  const schema = schemaState.status === "ready" ? schemaState.schema : undefined;

  useEffect(() => {
    registerInsertTarget("editor", (text) => editorRef.current?.insert(text));
    return () => registerInsertTarget("editor", null);
  }, [registerInsertTarget]);

  const execute = useCallback(async () => {
    const sql = editorSql.trim();
    if (!sql || schemaState.status !== "ready") return;
    setRun({ status: "running" });
    try {
      const result = await getDatabaseClient().query(dataset.id, sql);
      setRun({ status: "success", result, sql, runId: Date.now() });
    } catch (error) {
      setRun({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }, [dataset.id, editorSql, schemaState.status]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void execute()}
          disabled={run.status === "running" || !schema}
        >
          {run.status === "running" ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
          Run
          <kbd className="ml-1 hidden rounded bg-white/15 px-1 font-sans text-[10px] sm:inline">
            {isMac ? "⌘" : "Ctrl"} ↵
          </kbd>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditorSql(editorSql.replace(/\s+$/g, "").replace(/;*$/, ";"))}
          title="Tidy trailing whitespace"
          className="hidden sm:inline-flex"
        >
          <Wand2 /> Tidy
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          {run.status === "success" && (
            <>
              <span className="flex items-center gap-1">
                <Table2 className="size-3.5" /> {formatCount(run.result.rowCount)}{" "}
                {run.result.rowCount === 1 ? "row" : "rows"}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" /> {formatDuration(run.result.durationMs)}
              </span>
            </>
          )}
          <span className="hidden items-center gap-1 rounded-full border border-border px-2 py-0.5 sm:flex">
            <span className="size-1.5 rounded-full bg-success" /> Read-only
          </span>
        </div>
      </div>

      <div className="h-[38%] min-h-36 shrink-0 overflow-hidden border-b border-border bg-surface">
        <SqlEditor
          ref={editorRef}
          value={editorSql}
          onChange={setEditorSql}
          onRun={() => void execute()}
          schema={schema}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        {run.status === "idle" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
            <Play className="size-5 text-subtle" />
            <p>
              Run a query with{" "}
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs">
                {isMac ? "⌘" : "Ctrl"} + Enter
              </kbd>
            </p>
            <p className="text-xs text-subtle">
              Click tables and columns in the sidebar to insert them. Only read-only queries are allowed.
            </p>
          </div>
        )}
        {run.status === "running" && (
          <div className="space-y-2.5 p-4">
            {[90, 75, 82, 60, 70].map((w, i) => (
              <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {run.status === "error" && (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="font-mono text-[13px] break-words">{run.error}</span>
          </div>
        )}
        {run.status === "success" && (
          <>
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              {(["table", "chart"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] capitalize",
                    view === v ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:text-foreground",
                  )}
                >
                  {v === "table" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
                  {v}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-xs"
                onClick={() =>
                  downloadText(
                    `${dataset.id}-query.csv`,
                    toCsv(
                      run.result.columns.map((c) => c.name),
                      run.result.rows,
                    ),
                  )
                }
              >
                <Download className="!size-3.5" /> Export CSV
              </Button>
            </div>
            {view === "table" ? (
              <ResultTable
                result={run.result}
                maxHeight="100%"
                className="min-h-0 flex-1"
                showFooter
                filename={`${dataset.id}-query`}
              />
            ) : (
              <ChartBuilder key={run.runId} result={run.result} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
