"use client";

import { Brain, Check, Database, ShoppingBag, Cloud, FileUp, BarChart3 } from "lucide-react";
import { ChartView } from "@/components/charts/chart-view";
import { LogoMark } from "@/components/ui/logo";
import type { ChartData, ChartSpec } from "@/lib/chart/prepare";

// Monthly net revenue from the built-in (deterministic) e-commerce dataset.
const REVENUE = [
  53625, 81513, 79377, 45682, 47347, 56805, 56305, 51537, 65698, 67709, 66240, 62021, 82761, 87890, 115381, 60738,
  56168, 67977, 60827, 68105, 66067, 87703, 78588, 75629,
];
const MONTHS = REVENUE.map((_, i) => {
  const d = new Date(Date.UTC(2024, 9 + i, 1));
  return d.toISOString().slice(0, 10);
});

const spec: ChartSpec = {
  title: "Monthly net revenue",
  type: "area",
  x: "month",
  y: ["net_revenue"],
  yFormat: "currency",
};
const data: ChartData = {
  rows: MONTHS.map((month, i) => ({ month, net_revenue: REVENUE[i]! })),
  seriesKeys: ["net_revenue"],
  numericX: false,
};

function Kw({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--code-keyword)" }}>{children}</span>;
}
function Fn({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--code-function)" }}>{children}</span>;
}
function Str({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--code-string)" }}>{children}</span>;
}

/** A static, faithful preview of the workspace used on the landing page. */
export function DemoWindow() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-strong bg-background shadow-[0_30px_80px_-20px_rgb(0_0_0/0.25)]">
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-surface px-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-md bg-surface-2 px-3 py-0.5 font-mono text-[11px] text-subtle">
          querymind.app/workspace
        </span>
      </div>
      <div className="flex">
        <div className="hidden w-52 shrink-0 border-r border-border p-3 md:block">
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-subtle uppercase">Dataset</p>
          {[
            { icon: ShoppingBag, name: "Northwind Goods", sub: "E-commerce", active: true },
            { icon: Cloud, name: "Cloudlytics", sub: "SaaS metrics" },
            { icon: FileUp, name: "My data", sub: "Your CSV files" },
          ].map((d) => (
            <div
              key={d.name}
              className={`mb-1 flex items-center gap-2 rounded-lg p-1.5 ${d.active ? "bg-surface shadow-[0_0_0_1px_var(--border)]" : ""}`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-md ${d.active ? "bg-brand text-brand-fg" : "bg-surface-3 text-muted"}`}
              >
                <d.icon className="size-3.5" />
              </span>
              <span>
                <span className="block text-xs font-medium">{d.name}</span>
                <span className="block text-[10px] text-muted">{d.sub}</span>
              </span>
            </div>
          ))}
          <p className="mt-4 mb-2 text-[10px] font-semibold tracking-wider text-subtle uppercase">Schema</p>
          {[
            ["customers", "1,600"],
            ["products", "60"],
            ["orders", "7,176"],
            ["order_items", "12,821"],
          ].map(([t, n]) => (
            <div key={t} className="flex items-center justify-between py-1 font-mono text-[11px]">
              <span>{t}</span>
              <span className="text-subtle">{n}</span>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-5">
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-sm">
              How has monthly revenue trended over the last two years?
            </div>
          </div>
          <div className="flex gap-2.5">
            <LogoMark className="size-6 shrink-0" />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Brain className="size-3.5" /> Reasoning
              </p>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex size-6 items-center justify-center rounded-md bg-brand-soft text-brand">
                    <Database className="size-3.5" />
                  </span>
                  <span className="text-[13px] font-medium">Monthly net revenue</span>
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-success">
                    <Check className="size-3" /> 24 rows
                  </span>
                  <span className="hidden text-[11px] text-subtle sm:inline">18 ms</span>
                </div>
                <pre className="overflow-x-auto border-t border-border bg-surface-2/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
                  <Kw>SELECT</Kw> <Fn>date_trunc</Fn>(<Str>&apos;month&apos;</Str>, ordered_at)::<Kw>date</Kw>{" "}
                  <Kw>AS</Kw> month,{"\n"}
                  {"       "}
                  <Fn>sum</Fn>(quantity * unit_price * (1 - discount_pct / 100.0)) <Kw>AS</Kw> net_revenue{"\n"}
                  <Kw>FROM</Kw> orders <Kw>JOIN</Kw> order_items <Kw>USING</Kw> (order_id){"\n"}
                  <Kw>WHERE</Kw> status <Kw>NOT IN</Kw> (<Str>&apos;cancelled&apos;</Str>,{" "}
                  <Str>&apos;returned&apos;</Str>){"\n"}
                  <Kw>GROUP BY</Kw> 1 <Kw>ORDER BY</Kw> 1
                </pre>
              </div>
              <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] tracking-wide text-subtle uppercase">
                  <BarChart3 className="size-3.5" /> Render chart
                </div>
                <ChartView spec={spec} data={data} height={170} />
              </div>
              <p className="text-sm leading-relaxed">
                Revenue is <strong>growing with strong holiday seasonality</strong>: the last 12 months brought in{" "}
                <strong>$907,833</strong>, up <strong>23.7%</strong> on the year before, with December 2025 the best
                month at <strong>$115,381</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
