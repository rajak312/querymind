"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { ChartData, ChartSpec } from "@/lib/chart/prepare";
import { cn, formatNumber } from "@/lib/utils";

/** Categorical slots in fixed order (never cycled past 8: extra series fold into "Other"). */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const seriesColor = (i: number) => SERIES[i % SERIES.length]!;

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function formatX(value: unknown): string {
  if (typeof value === "string" && DATE_RE.test(value)) {
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    const day = date.getUTCDate();
    return date.toLocaleDateString("en-US", {
      month: "short",
      ...(day === 1 ? { year: "2-digit" } : { day: "numeric" }),
      timeZone: "UTC",
    });
  }
  const text = String(value ?? "");
  return text.length > 16 ? `${text.slice(0, 15)}…` : text;
}

const axisProps = {
  stroke: "var(--chart-grid)",
  tick: { fill: "var(--chart-axis)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--chart-grid)" },
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  yFormat,
  labelKey,
}: Partial<TooltipContentProps<ValueType, NameType>> & { yFormat: ChartSpec["yFormat"]; labelKey?: string }) {
  if (!active || !payload?.length) return null;
  const heading = labelKey ? (payload[0]?.payload as Record<string, unknown> | undefined)?.[labelKey] : label;
  return (
    <div className="min-w-36 rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs shadow-lg">
      {heading !== undefined && <div className="mb-1.5 font-medium text-foreground">{formatX(heading)}</div>}
      <div className="space-y-1">
        {payload.map((item, i) => (
          <div key={`${String(item.name)}-${i}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: item.color ?? item.payload?.fill }} />
              {item.name}
            </span>
            <span className="font-medium text-foreground tabular-nums">
              {typeof item.value === "number" ? formatNumber(item.value, yFormat) : String(item.value ?? "—")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendContent({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-xs text-muted">
      {keys.map((key, i) => (
        <span key={key} className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: seriesColor(i) }} />
          {key}
        </span>
      ))}
    </div>
  );
}

export function ChartView({
  spec,
  data,
  height = 300,
  className,
}: {
  spec: ChartSpec;
  data: ChartData;
  height?: number;
  className?: string;
}) {
  const { rows, seriesKeys } = data;
  const multi = seriesKeys.length > 1;
  const tickY = (v: number) => formatNumber(v, spec.yFormat, true);

  // Long category labels read better as horizontal bars.
  const horizontal = useMemo(() => {
    if (spec.type !== "bar") return false;
    const labels = rows.map((r) => String(r[spec.x] ?? ""));
    const avg = labels.reduce((s, l) => s + l.length, 0) / Math.max(1, labels.length);
    return labels.length > 4 && avg > 10 && !DATE_RE.test(labels[0] ?? "");
  }, [rows, spec.type, spec.x]);

  const legend = multi ? <Legend content={<LegendContent keys={seriesKeys} />} verticalAlign="bottom" /> : null;
  const tooltip = (
    <Tooltip
      cursor={spec.type === "bar" ? { fill: "var(--surface-2)" } : { stroke: "var(--border-strong)", strokeWidth: 1 }}
      content={(props) => <ChartTooltip {...props} yFormat={spec.yFormat} />}
    />
  );
  const margin = { top: 8, right: 12, bottom: 0, left: 4 };

  let chart: React.ReactElement;
  switch (spec.type) {
    case "line":
      chart = (
        <LineChart data={rows} margin={margin}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={spec.x} {...axisProps} tickFormatter={formatX} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={tickY} width={56} />
          {tooltip}
          {legend}
          {seriesKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={seriesColor(i)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      );
      break;
    case "area":
      chart = (
        <AreaChart data={rows} margin={margin}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={spec.x} {...axisProps} tickFormatter={formatX} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={tickY} width={56} />
          {tooltip}
          {legend}
          {seriesKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stackId={spec.stacked ? "stack" : undefined}
              stroke={seriesColor(i)}
              strokeWidth={2}
              fill={seriesColor(i)}
              fillOpacity={0.1}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      );
      break;
    case "pie":
      chart = (
        <PieChart margin={margin}>
          <Tooltip content={(props) => <ChartTooltip {...props} yFormat={spec.yFormat} labelKey={spec.x} />} />
          <Legend content={<LegendContent keys={rows.map((r) => String(r[spec.x]))} />} verticalAlign="bottom" />
          <Pie
            data={rows}
            dataKey={seriesKeys[0]!}
            nameKey={spec.x}
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={0}
            stroke="var(--chart-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {rows.map((row, i) => (
              <Cell key={String(row[spec.x])} fill={seriesColor(i)} />
            ))}
          </Pie>
        </PieChart>
      );
      break;
    case "scatter":
      chart = (
        <ScatterChart margin={margin}>
          <CartesianGrid stroke="var(--chart-grid)" />
          <XAxis
            type="number"
            dataKey={spec.x}
            name={spec.x}
            {...axisProps}
            tickFormatter={(v: number) => formatNumber(v, "number", true)}
          />
          <YAxis
            type="number"
            dataKey={seriesKeys[0]}
            name={seriesKeys[0]}
            {...axisProps}
            axisLine={false}
            tickFormatter={tickY}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={(props) => <ChartTooltip {...props} yFormat={spec.yFormat} />}
          />
          <Scatter
            data={rows}
            fill={seriesColor(0)}
            stroke="var(--chart-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </ScatterChart>
      );
      break;
    case "bar":
    default:
      chart = (
        <BarChart
          data={rows}
          margin={margin}
          layout={horizontal ? "vertical" : "horizontal"}
          barCategoryGap="22%"
          barGap={2}
        >
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke="var(--chart-grid)" />
          {horizontal ? (
            <>
              <XAxis type="number" {...axisProps} axisLine={false} tickFormatter={tickY} />
              <YAxis type="category" dataKey={spec.x} {...axisProps} tickFormatter={formatX} width={120} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey={spec.x} {...axisProps} tickFormatter={formatX} minTickGap={8} />
              <YAxis {...axisProps} axisLine={false} tickFormatter={tickY} width={56} />
            </>
          )}
          {tooltip}
          {legend}
          {seriesKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              stackId={spec.stacked ? "stack" : undefined}
              fill={seriesColor(i)}
              maxBarSize={24}
              radius={spec.stacked && i < seriesKeys.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              stroke={spec.stacked ? "var(--chart-surface)" : undefined}
              strokeWidth={spec.stacked ? 1 : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      );
  }

  const chartHeight = horizontal ? Math.max(height, rows.length * 30 + 40) : height;

  return (
    <figure className={cn("w-full", className)}>
      <figcaption className="mb-3 text-sm font-medium text-foreground">{spec.title}</figcaption>
      <div style={{ height: chartHeight }} role="img" aria-label={`${spec.type} chart: ${spec.title}`}>
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
