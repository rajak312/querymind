import type { AgentEvent, ContentBlock, MessageParam } from "@/lib/agent/events";
import type { RenderChartInput } from "@/lib/agent/tools";
import type { ParsedChatRequest } from "./validate";

/**
 * DEV-ONLY scripted model.
 *
 * Enabled with QUERYMIND_MOCK=1 and never in production builds (see
 * `isMockEnabled`). It replays a realistic tool-use conversation through the
 * exact same SSE protocol as the real Claude path, so the whole UI — streaming
 * text, SQL steps executed in PGlite, self-correction after a SQL error,
 * charts and the final answer — can be exercised without an API key.
 * The SQL really runs in the browser; the final answer is computed from the
 * returned rows.
 */

export function isMockEnabled(): boolean {
  return process.env.QUERYMIND_MOCK === "1" && process.env.NODE_ENV !== "production";
}

type Rows = (string | number | boolean | null)[][];

interface Scenario {
  match: RegExp;
  thinking: string;
  intro: string;
  /** SQL attempts in order; a failing attempt is followed by the next one. */
  queries: { sql: string; purpose: string }[];
  fixNote?: string;
  chart?: Omit<RenderChartInput, "sql"> & { sql?: string };
  answer: (rows: Rows) => string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const num = (v: unknown) => Number(v ?? 0);

const MONTHLY_REVENUE_SQL = `SELECT date_trunc('month', o.ordered_at)::date AS month,
       round(sum(oi.quantity * oi.unit_price * (1 - oi.discount_pct / 100.0)), 2) AS net_revenue,
       count(DISTINCT o.order_id) AS orders
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status NOT IN ('cancelled', 'returned')
GROUP BY 1
ORDER BY 1`;

const SCENARIOS: Record<string, Scenario[]> = {
  ecommerce: [
    {
      match: /categor/i,
      thinking:
        "Revenue by category and region: join order_items → products for category and orders → customers for region. Net revenue again, exclude cancelled/returned. A grouped bar chart with region as the series compares categories well.",
      intro: "Let me break net revenue down by product category and customer region.",
      queries: [
        {
          purpose: "Net revenue by category and region",
          sql: `SELECT p.category, c.region,
       round(sum(oi.quantity * oi.unit_price * (1 - oi.discount_pct / 100.0)), 2) AS net_revenue
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
JOIN customers c ON c.customer_id = o.customer_id
WHERE o.status NOT IN ('cancelled', 'returned')
GROUP BY 1, 2
ORDER BY 1, 3 DESC`,
        },
      ],
      chart: {
        title: "Net revenue by category and region",
        type: "bar",
        x: "category",
        y: ["net_revenue"],
        series: "region",
        y_format: "currency",
      },
      answer: (rows) => {
        const byCategory = new Map<string, number>();
        const topByRegion = new Map<string, { category: string; revenue: number }>();
        for (const [category, region, revenue] of rows) {
          byCategory.set(String(category), (byCategory.get(String(category)) ?? 0) + num(revenue));
          const current = topByRegion.get(String(region));
          if (!current || num(revenue) > current.revenue)
            topByRegion.set(String(region), { category: String(category), revenue: num(revenue) });
        }
        const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
        const total = ranked.reduce((s, [, v]) => s + v, 0);
        const [first, second] = ranked;
        return `**${first?.[0]}** is the largest category everywhere, with **${usd(first?.[1] ?? 0)}** (${pct((100 * (first?.[1] ?? 0)) / total)} of net revenue), followed by ${second?.[0]}.

| Region | Top category | Net revenue |
| --- | --- | --- |
${[...topByRegion.entries()].map(([region, v]) => `| ${region} | ${v.category} | ${usd(v.revenue)} |`).join("\n")}

- North America and Europe together generate most of the revenue in every category.
- Smaller categories (${ranked
          .slice(-2)
          .map(([c]) => c)
          .join(", ")}) are a low share, worth checking against their margins.`;
      },
    },
    {
      match: /repeat/i,
      thinking:
        "Repeat customers: rank each customer's orders by time; an order is 'repeat' if it isn't the customer's first. Then compute the share. A pie of first vs repeat orders is a clean two-part split.",
      intro: "I'll classify every order as a customer's first order or a repeat order.",
      queries: [
        {
          purpose: "First vs repeat orders",
          sql: `WITH ranked AS (
  SELECT order_id,
         row_number() OVER (PARTITION BY customer_id ORDER BY ordered_at) AS nth
  FROM orders
  WHERE status <> 'cancelled'
)
SELECT CASE WHEN nth = 1 THEN 'First order' ELSE 'Repeat order' END AS order_type,
       count(*) AS orders,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS share_pct
FROM ranked
GROUP BY 1
ORDER BY 1`,
        },
      ],
      chart: { title: "First vs repeat orders", type: "pie", x: "order_type", y: ["orders"] },
      answer: (rows) => {
        const repeat = rows.find((r) => r[0] === "Repeat order");
        const first = rows.find((r) => r[0] === "First order");
        return `**${pct(num(repeat?.[2]))} of orders come from repeat customers** (${num(repeat?.[1]).toLocaleString("en-US")} orders), versus ${num(first?.[1]).toLocaleString("en-US")} first orders.

- Repeat purchasing is the backbone of the business; retention campaigns will move revenue more than acquisition alone.
- Cancelled orders are excluded; returned orders still count as a purchase.`;
      },
    },
    {
      match: /revenue/i,
      thinking:
        "The user wants the revenue trend over two years. Revenue isn't stored on orders, so I'll compute net line revenue from order_items (quantity × unit_price × discount), exclude cancelled and returned orders, and group by month. A line chart fits a time series.",
      intro: "I'll calculate net revenue per month from the order line items, excluding cancelled and returned orders.",
      queries: [
        {
          purpose: "Monthly net revenue",
          sql: MONTHLY_REVENUE_SQL.replace(/o\.ordered_at/g, "o.order_date"),
        },
        { purpose: "Monthly net revenue", sql: MONTHLY_REVENUE_SQL },
      ],
      fixNote: "The timestamp column on `orders` is `ordered_at`, not `order_date`. Fixing the query.",
      chart: { title: "Monthly net revenue", type: "area", x: "month", y: ["net_revenue"], y_format: "currency" },
      answer: (rows) => {
        const values = rows.map((r) => ({ month: String(r[0]), revenue: num(r[1]), orders: num(r[2]) }));
        const total = values.reduce((s, v) => s + v.revenue, 0);
        const peak = values.reduce((a, b) => (b.revenue > a.revenue ? b : a));
        const low = values.reduce((a, b) => (b.revenue < a.revenue ? b : a));
        const last12 = values.slice(-12).reduce((s, v) => s + v.revenue, 0);
        const prev12 = values.slice(-24, -12).reduce((s, v) => s + v.revenue, 0);
        const growth = prev12 ? (100 * (last12 - prev12)) / prev12 : 0;
        const label = (m: string) =>
          new Date(`${m}T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
        return `Revenue is **growing with strong holiday seasonality**: the last 12 months brought in **${usd(last12)}**, up **${pct(growth)}** on the 12 months before.

| Metric | Value |
| --- | --- |
| Total net revenue (${values.length} months) | ${usd(total)} |
| Best month | ${label(peak.month)} · ${usd(peak.revenue)} |
| Weakest month | ${label(low.month)} · ${usd(low.revenue)} |
| Avg. monthly orders | ${Math.round(values.reduce((s, v) => s + v.orders, 0) / values.length).toLocaleString("en-US")} |

- **November–December peaks** every year, followed by a January dip.
- A smaller **July bump** lines up with the mid-summer promotion week.

*Net revenue = quantity × unit price × (1 − discount), excluding cancelled and returned orders; shipping fees are not included.*`;
      },
    },
  ],
  saas: [
    {
      match: /new (vs\.?|and) churn/i,
      thinking:
        "New vs churned per month: new = subscriptions started on an account's first subscription; churned = subscriptions with status canceled by ended_at month. Two series on one line chart share the same unit (count), so one axis works.",
      intro: "I'll count new customer subscriptions and cancellations per month.",
      queries: [
        {
          purpose: "New vs churned subscriptions per month",
          sql: `WITH months AS (
  SELECT generate_series(date '2024-10-01', date '2026-09-01', interval '1 month')::date AS month
),
firsts AS (
  SELECT account_id, min(started_at) AS started_at FROM subscriptions GROUP BY 1
)
SELECT m.month,
       (SELECT count(*) FROM firsts f WHERE date_trunc('month', f.started_at) = m.month) AS new_customers,
       (SELECT count(*) FROM subscriptions s WHERE s.status = 'canceled' AND date_trunc('month', s.ended_at) = m.month) AS churned
FROM months m
ORDER BY 1`,
        },
      ],
      chart: { title: "New vs churned customers per month", type: "line", x: "month", y: ["new_customers", "churned"] },
      answer: (rows) => {
        const added = rows.reduce((s, r) => s + num(r[1]), 0);
        const lost = rows.reduce((s, r) => s + num(r[2]), 0);
        const last = rows.slice(-6);
        return `Over the last ${rows.length} months we added **${added} customers** and lost **${lost}**, a net gain of **${added - lost}**. New sign-ups outpaced churn in ${rows.filter((r) => num(r[1]) > num(r[2])).length} of ${rows.length} months.

| Last 6 months | New | Churned |
| --- | --- | --- |
${last.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join("\n")}

*New = an account's first subscription; churned = a subscription canceled in that month.*`;
      },
    },
    {
      match: /mrr/i,
      thinking:
        "Current MRR by plan: sum mrr of subscriptions with status 'active' joined to plans. A bar chart ordered by tier works.",
      intro: "I'll sum MRR across active subscriptions for each plan.",
      queries: [
        {
          purpose: "Current MRR by plan",
          sql: `SELECT p.name AS plan, p.tier,
       count(*) AS active_subscriptions,
       round(sum(s.mrr), 2) AS mrr
FROM subscriptions s
JOIN plans p ON p.plan_id = s.plan_id
WHERE s.status = 'active'
GROUP BY 1, 2
ORDER BY p.tier`,
        },
      ],
      chart: { title: "Current MRR by plan", type: "bar", x: "plan", y: ["mrr"], y_format: "currency" },
      answer: (rows) => {
        const total = rows.reduce((s, r) => s + num(r[3]), 0);
        const top = rows.reduce((a, b) => (num(b[3]) > num(a[3]) ? b : a));
        return `Current MRR is **${usd(total)}** across ${rows.reduce((s, r) => s + num(r[2]), 0)} active subscriptions. **${top[0]}** contributes the most (${pct((100 * num(top[3])) / total)}).

| Plan | Active subs | MRR | Share |
| --- | --- | --- | --- |
${rows.map((r) => `| ${r[0]} | ${r[2]} | ${usd(num(r[3]))} | ${pct((100 * num(r[3])) / total)} |`).join("\n")}

*MRR for annual plans is the monthly equivalent of the discounted annual price.*`;
      },
    },
    {
      match: /reason|cancel/i,
      thinking: "Cancellation reasons live on canceled subscriptions. Count by reason and show the share.",
      intro: "Let me count canceled subscriptions by their cancellation reason.",
      queries: [
        {
          purpose: "Cancellations by reason",
          sql: `SELECT cancel_reason, count(*) AS cancellations,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS share_pct
FROM subscriptions
WHERE status = 'canceled'
GROUP BY 1
ORDER BY 2 DESC`,
        },
      ],
      chart: { title: "Cancellations by reason", type: "bar", x: "cancel_reason", y: ["cancellations"] },
      answer: (rows) =>
        `The top reason for churn is **${rows[0]?.[0]}** (${pct(num(rows[0]?.[2]))} of cancellations), followed by **${rows[1]?.[0]}** (${pct(num(rows[1]?.[2]))}).

${rows.map((r) => `- ${r[0]}: ${r[1]} cancellations`).join("\n")}

Price and usage-driven churn together suggest testing a cheaper tier or better onboarding for low-activity accounts.`,
    },
  ],
};

function genericScenario(request: ParsedChatRequest): Scenario {
  const tables = request.schema.tables.slice(0, 8);
  const sql =
    tables.length > 0
      ? tables
          .map((t) => `SELECT '${t.name}' AS table_name, count(*) AS row_count FROM ${t.name}`)
          .join("\nUNION ALL\n") + "\nORDER BY row_count DESC"
      : "SELECT 'no tables yet' AS table_name, 0 AS row_count";
  return {
    match: /.*/,
    thinking: "I'll start with an overview of what's in the database: row counts per table.",
    intro: "Here's an overview of the tables in this dataset.",
    queries: [{ purpose: "Rows per table", sql }],
    chart: { title: "Rows per table", type: "bar", x: "table_name", y: ["row_count"] },
    answer: (rows) =>
      `This dataset has **${rows.length} tables** with ${rows.reduce((s, r) => s + num(r[1]), 0).toLocaleString("en-US")} rows in total.

${rows.map((r) => `- \`${r[0]}\`: ${num(r[1]).toLocaleString("en-US")} rows`).join("\n")}

*(Demo mode: this is a scripted answer. Configure \`ANTHROPIC_API_KEY\` for real analysis.)*`,
  };
}

// ---------------------------------------------------------------------------

function textOf(message: MessageParam): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function isQuestion(message: MessageParam): boolean {
  return (
    message.role === "user" && (typeof message.content === "string" || message.content.some((b) => b.type === "text"))
  );
}

interface TurnState {
  question: string;
  sqlAttempts: number;
  lastTool?: { name: string; input: Record<string, unknown> };
  lastResult?: { isError: boolean; content: string };
  lastSuccessfulRows?: Rows;
  lastSuccessfulSql?: string;
}

function readTurnState(messages: MessageParam[]): TurnState {
  let start = messages.length - 1;
  while (start > 0 && !isQuestion(messages[start]!)) start--;
  const state: TurnState = { question: textOf(messages[start]!), sqlAttempts: 0 };
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const message of messages.slice(start + 1)) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") {
        const tool = { name: block.name, input: block.input as Record<string, unknown> };
        toolInputs.set(block.id, tool);
        state.lastTool = tool;
        if (block.name === "run_sql") state.sqlAttempts++;
      }
      if (block.type === "tool_result") {
        const content =
          typeof block.content === "string"
            ? block.content
            : (block.content ?? []).map((c) => ("text" in c ? c.text : "")).join("");
        state.lastResult = { isError: Boolean(block.is_error), content };
        const tool = toolInputs.get(block.tool_use_id);
        if (tool?.name === "run_sql" && !block.is_error) {
          try {
            state.lastSuccessfulRows = (JSON.parse(content) as { rows: Rows }).rows;
            state.lastSuccessfulSql = String(tool.input.sql);
          } catch {
            // ignore malformed results
          }
        }
      }
    }
  }
  return state;
}

interface Step {
  thinking?: string;
  text?: string;
  tool?: { name: string; input: Record<string, unknown> };
}

function planStep(request: ParsedChatRequest): Step {
  const turn = readTurnState(request.messages);
  const scenario =
    (SCENARIOS[request.datasetId] ?? []).find((s) => s.match.test(turn.question)) ?? genericScenario(request);

  if (!turn.lastTool) {
    const query = scenario.queries[0]!;
    return { thinking: scenario.thinking, text: scenario.intro, tool: { name: "run_sql", input: { ...query } } };
  }
  if (turn.lastTool.name === "run_sql" && turn.lastResult?.isError) {
    const next = scenario.queries[turn.sqlAttempts];
    if (next)
      return {
        text: scenario.fixNote ?? "That query failed; let me fix it.",
        tool: { name: "run_sql", input: { ...next } },
      };
    return {
      text: `I couldn't get a working query for this (${turn.lastResult.content}). Could you rephrase the question?`,
    };
  }
  if (turn.lastTool.name === "run_sql" && scenario.chart) {
    return {
      tool: { name: "render_chart", input: { ...scenario.chart, sql: scenario.chart.sql ?? turn.lastSuccessfulSql } },
    };
  }
  return { text: scenario.answer(turn.lastSuccessfulRows ?? []) };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function chunks(text: string, size: number): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    current += word;
    if (current.length >= size) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

export async function streamMockTurn(
  request: ParsedChatRequest,
  send: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const step = planStep(request);
  const content: ContentBlock[] = [];
  let index = 0;
  await sleep(350, signal);

  if (step.thinking) {
    send({ type: "block_start", index, block: "thinking" });
    for (const part of chunks(step.thinking, 24)) {
      send({ type: "thinking_delta", index, text: part });
      await sleep(18, signal);
    }
    content.push({ type: "thinking", thinking: step.thinking, signature: "mock-signature" });
    index++;
  }
  if (step.text) {
    send({ type: "block_start", index, block: "text" });
    for (const part of chunks(step.text, 14)) {
      send({ type: "text_delta", index, text: part });
      await sleep(22, signal);
    }
    content.push({ type: "text", text: step.text, citations: null });
    index++;
  }
  if (step.tool) {
    const id = `toolu_mock_${Math.random().toString(36).slice(2, 12)}`;
    send({ type: "tool_use_start", index, id, name: step.tool.name });
    for (const part of chunks(JSON.stringify(step.tool.input), 40)) {
      send({ type: "tool_input_delta", index, partialJson: part });
      await sleep(12, signal);
    }
    content.push({ type: "tool_use", id, name: step.tool.name, input: step.tool.input });
  }
  send({
    type: "message_done",
    stopReason: step.tool ? "tool_use" : "end_turn",
    content,
    model: "mock",
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}
