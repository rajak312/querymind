"use client";

import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Loader2,
  ScanSearch,
  Table2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChartView } from "@/components/charts/chart-view";
import { SqlViewer } from "@/components/editor/sql-viewer";
import { Button } from "@/components/ui/button";
import type { ToolRun } from "@/lib/agent/state";
import type { TableProfile } from "@/lib/db/types";
import { cn, formatCell, formatCount, formatDuration } from "@/lib/utils";
import { ResultTable } from "./result-table";
import { useWorkspace } from "./workspace-context";

const TOOL_META: Record<string, { label: string; icon: typeof Database }> = {
  run_sql: { label: "Run SQL", icon: Database },
  render_chart: { label: "Render chart", icon: BarChart3 },
  describe_table: { label: "Describe table", icon: ScanSearch },
};

/** Pull the (possibly incomplete) "sql" string out of streaming tool-input JSON. */
export function extractPartialSql(partialJson: string): string | undefined {
  const match = /"sql"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(partialJson);
  if (!match) return undefined;
  const raw = match[1]!.replace(/\\$/, "");
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function SqlBlock({ sql }: { sql: string }) {
  const { openInEditor } = useWorkspace();
  return (
    <div className="group relative bg-surface-2/50">
      <SqlViewer value={sql} />
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(sql).then(() => toast.success("SQL copied"));
          }}
        >
          <Copy className="!size-3.5" /> Copy
        </Button>
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => openInEditor(sql)}>
          <ExternalLink className="!size-3.5" /> Open in editor
        </Button>
      </div>
    </div>
  );
}

function ProfileTable({ profile }: { profile: TableProfile }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted">
            {["Column", "Type", "Nulls", "Distinct", "Range / top values"].map((h) => (
              <th key={h} className="border-b border-border bg-surface-2 px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profile.columns.map((c) => (
            <tr key={c.name} className="align-top">
              <td className="border-b border-border/70 px-3 py-1.5 font-mono text-xs">{c.name}</td>
              <td className="border-b border-border/70 px-3 py-1.5 text-muted">{c.type}</td>
              <td className="border-b border-border/70 px-3 py-1.5 tabular-nums">{formatCount(c.nullCount)}</td>
              <td className="border-b border-border/70 px-3 py-1.5 tabular-nums">{formatCount(c.distinctCount)}</td>
              <td className="border-b border-border/70 px-3 py-1.5 text-muted">
                {c.topValues
                  ? c.topValues
                      .slice(0, 5)
                      .map((v) => `${formatCell(v.value)} (${formatCount(v.count)})`)
                      .join(", ")
                  : c.min !== undefined
                    ? `${formatCell(c.min ?? null)} → ${formatCell(c.max ?? null)}`
                    : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface StepCardProps {
  name: string;
  input?: unknown;
  run?: ToolRun;
  /** Tool input is still streaming from the model. */
  partialJson?: string;
}

export function StepCard({ name, input, run, partialJson }: StepCardProps) {
  const meta = TOOL_META[name] ?? { label: name, icon: Code2 };
  const Icon = meta.icon;
  const writing = partialJson !== undefined;
  const status = writing ? "writing" : (run?.status ?? "queued");
  const isChart = name === "render_chart";
  const [open, setOpen] = useState(status !== "error");
  const [showChartSql, setShowChartSql] = useState(false);

  const typedInput = (input ?? {}) as { sql?: string; purpose?: string; title?: string; table?: string };
  const sql = run?.sql ?? typedInput.sql ?? (writing ? extractPartialSql(partialJson) : undefined);
  const title =
    run?.purpose ??
    typedInput.purpose ??
    typedInput.title ??
    (typedInput.table ? `Profile ${typedInput.table}` : meta.label);

  const statusChip = {
    writing: (
      <span className="flex items-center gap-1 text-brand">
        <Loader2 className="size-3.5 animate-spin" /> Writing query
      </span>
    ),
    queued: (
      <span className="flex items-center gap-1 text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Waiting
      </span>
    ),
    running: (
      <span className="flex items-center gap-1 text-brand">
        <Loader2 className="size-3.5 animate-spin" /> Running in your browser
      </span>
    ),
    success: (
      <span className="flex items-center gap-1 text-success">
        <Check className="size-3.5" />
        {run?.result && !isChart
          ? `${formatCount(run.result.rowCount)} ${run.result.rowCount === 1 ? "row" : "rows"}`
          : "Done"}
      </span>
    ),
    error: (
      <span className="flex items-center gap-1 text-danger">
        <XCircle className="size-3.5" /> Error
      </span>
    ),
    cancelled: (
      <span className="flex items-center gap-1 text-muted">
        <XCircle className="size-3.5" /> Cancelled
      </span>
    ),
  }[status];

  return (
    <div
      className={cn(
        "animate-fade-in overflow-hidden rounded-xl border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        status === "error" ? "border-danger/30" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2/60"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            status === "error" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block text-[11px] tracking-wide text-subtle uppercase">{meta.label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-xs">
          {statusChip}
          {run?.durationMs !== undefined && status !== "running" && (
            <span className="hidden text-subtle tabular-nums sm:inline">{formatDuration(run.durationMs)}</span>
          )}
          <ChevronDown className={cn("size-4 text-subtle transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          {isChart && run?.chart ? (
            <>
              <div className="px-4 pt-4 pb-3">
                <ChartView spec={run.chart.spec} data={run.chart.data} />
              </div>
              <div className="flex gap-1 border-t border-border px-2 py-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowChartSql((s) => !s)}
                >
                  <Table2 className="!size-3.5" /> {showChartSql ? "Hide data" : "Show SQL & data"}
                </Button>
              </div>
              {showChartSql && (
                <div className="border-t border-border">
                  {sql && <SqlBlock sql={sql} />}
                  {run.result && <ResultTable result={run.result} maxHeight={240} filename="chart-data" />}
                </div>
              )}
            </>
          ) : (
            <>
              {sql ? (
                <SqlBlock sql={sql} />
              ) : writing ? (
                <div className="space-y-2 p-3">
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              ) : null}
              {run?.status === "error" && run.error && (
                <div className="flex items-start gap-2 border-t border-danger/20 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span className="font-mono text-xs leading-relaxed break-words">{run.error}</span>
                </div>
              )}
              {run?.status === "running" && (
                <div className="space-y-2 border-t border-border p-3">
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-5/6" />
                  <div className="skeleton h-3 w-4/6" />
                </div>
              )}
              {run?.result && !isChart && (
                <div className="border-t border-border">
                  <ResultTable result={run.result} maxHeight={224} />
                </div>
              )}
              {run?.profile && (
                <div className="border-t border-border">
                  <ProfileTable profile={run.profile} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
