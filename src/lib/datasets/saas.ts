import { addDays, isoDate, isoTimestamp, Random, round2 } from "./prng";
import type { BuiltinDataset, CellValue, GeneratedTable } from "./types";

const SEED = 77_031_2025;
const START = new Date(Date.UTC(2024, 9, 1)); // 2024-10-01
const MONTHS = 24; // through 2026-09

interface Plan {
  id: number;
  name: string;
  tier: number;
  monthlyPrice: number;
  includedSeats: number;
  seatPrice: number;
  /** Monthly probability of cancelling. */
  churn: number;
  /** Monthly probability of upgrading to the next tier. */
  upgrade: number;
  /** Mean product events per account per month. */
  activity: number;
}

const PLANS: Plan[] = [
  {
    id: 1,
    name: "Starter",
    tier: 1,
    monthlyPrice: 29,
    includedSeats: 3,
    seatPrice: 0,
    churn: 0.045,
    upgrade: 0.03,
    activity: 1.3,
  },
  {
    id: 2,
    name: "Growth",
    tier: 2,
    monthlyPrice: 99,
    includedSeats: 10,
    seatPrice: 9,
    churn: 0.025,
    upgrade: 0.018,
    activity: 2.2,
  },
  {
    id: 3,
    name: "Business",
    tier: 3,
    monthlyPrice: 299,
    includedSeats: 25,
    seatPrice: 12,
    churn: 0.014,
    upgrade: 0.008,
    activity: 3.4,
  },
  {
    id: 4,
    name: "Enterprise",
    tier: 4,
    monthlyPrice: 999,
    includedSeats: 100,
    seatPrice: 15,
    churn: 0.006,
    upgrade: 0,
    activity: 5,
  },
];

const INDUSTRIES = [
  "Software",
  "Healthcare",
  "Financial Services",
  "Retail",
  "Education",
  "Manufacturing",
  "Media",
  "Logistics",
] as const;
const INDUSTRY_WEIGHTS = [26, 12, 14, 12, 9, 10, 9, 8];
const REGIONS = ["North America", "Europe", "Asia Pacific", "Latin America"] as const;
const REGION_WEIGHTS = [44, 31, 18, 7];
const EMPLOYEE_BANDS = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
const CHANNELS = ["Self-serve", "Sales-led", "Partner", "Product Hunt"] as const;
const CANCEL_REASONS = [
  "Too expensive",
  "Missing features",
  "Switched to competitor",
  "Low usage",
  "Company closed",
] as const;
const EVENT_TYPES = [
  "login",
  "report_created",
  "dashboard_shared",
  "query_run",
  "integration_connected",
  "csv_export",
  "teammate_invited",
] as const;
const EVENT_WEIGHTS = [34, 14, 8, 26, 3, 9, 6];

const NAME_A = [
  "North",
  "Blue",
  "Bright",
  "Iron",
  "Silver",
  "Clear",
  "Swift",
  "Lumen",
  "Cedar",
  "Atlas",
  "Nova",
  "Harbor",
  "Quartz",
  "Echo",
  "Pine",
  "Solar",
  "Vector",
  "Crimson",
  "Delta",
  "Orbit",
];
const NAME_B = [
  "field",
  "stone",
  "wave",
  "path",
  "leaf",
  "point",
  "bridge",
  "loop",
  "forge",
  "grid",
  "peak",
  "spark",
  "line",
  "craft",
  "works",
  "base",
];
const NAME_C = [
  "Labs",
  "Health",
  "Capital",
  "Logistics",
  "Studio",
  "Systems",
  "Analytics",
  "Learning",
  "Retail",
  "Media",
  "Robotics",
  "Foods",
];

function monthStart(offset: number): Date {
  return new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + offset, 1));
}

export function generateSaas(): GeneratedTable[] {
  const rng = new Random(SEED);

  const accounts: CellValue[][] = [];
  const subscriptions: CellValue[][] = [];
  const invoices: CellValue[][] = [];
  const events: CellValue[][] = [];
  const usedNames = new Set<string>();

  const ACCOUNT_COUNT = 720;
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const accountId = i + 1;
    let companyName: string;
    do {
      companyName = `${rng.pick(NAME_A)}${rng.pick(NAME_B)} ${rng.pick(NAME_C)}`;
    } while (usedNames.has(companyName));
    usedNames.add(companyName);

    // 20% of accounts pre-date the window; sign-ups accelerate over time.
    const createdMonth = rng.bool(0.2) ? -rng.int(1, 12) : Math.floor(Math.pow(rng.next(), 0.75) * MONTHS);
    const createdAt = addDays(monthStart(createdMonth), rng.int(0, 27));
    const channel = rng.weighted(CHANNELS, [55, 25, 12, 8]);
    const band = rng.weighted(EMPLOYEE_BANDS, channel === "Sales-led" ? [2, 10, 30, 35, 23] : [30, 38, 20, 9, 3]);
    accounts.push([
      accountId,
      companyName,
      rng.weighted(INDUSTRIES, INDUSTRY_WEIGHTS),
      rng.weighted(REGIONS, REGION_WEIGHTS),
      band,
      channel,
      isoDate(createdAt),
    ]);

    // Starting plan depends on company size and channel.
    const bandIndex = EMPLOYEE_BANDS.indexOf(band);
    const planWeights =
      channel === "Sales-led"
        ? [0, 30, 50, 20]
        : [Math.max(5, 60 - bandIndex * 15), 28, 10 + bandIndex * 4, bandIndex >= 3 ? 3 : 0.5];
    let plan = rng.weighted(PLANS, planWeights);
    let billing =
      plan.tier >= 3 ? rng.weighted(["annual", "monthly"], [65, 35]) : rng.weighted(["annual", "monthly"], [22, 78]);
    let seats = Math.max(1, Math.round(plan.includedSeats * rng.float(0.4, 1.6)));
    let subStart = createdAt;
    let subStartMonth = createdMonth;
    let alive = true;

    for (let m = createdMonth; m < MONTHS && alive; m++) {
      const isFirstMonth = m === subStartMonth;
      const periodStart = isFirstMonth ? subStart : addDays(monthStart(m), Math.min(27, subStart.getUTCDate() - 1));
      const mrr = subscriptionMrr(plan, seats, billing);

      // Invoices only exist inside the observed window.
      if (m >= 0) {
        const monthsSinceStart = m - subStartMonth;
        const due = billing === "monthly" || monthsSinceStart % 12 === 0;
        if (due) {
          const amount = billing === "annual" ? round2(mrr * 12) : mrr;
          const isLatest = m === MONTHS - 1;
          const status =
            isLatest && rng.bool(0.3) ? "open" : rng.weighted(["paid", "failed", "refunded"], [95, 3.5, 1.5]);
          invoices.push([
            invoices.length + 1,
            accountId,
            subscriptions.length + 1,
            isoDate(periodStart),
            amount,
            status,
          ]);
        }

        // Product usage, which drops off in the months before churn.
        const churnRisk = rng.next() < plan.churn * 1.3;
        const lambda = plan.activity * (churnRisk ? 0.35 : 1) * Math.min(1.6, 0.6 + seats / plan.includedSeats / 2);
        const n = rng.poisson(lambda);
        for (let e = 0; e < n; e++) {
          const at = new Date(monthStart(m).getTime() + rng.int(0, 27 * 86400 + 86399) * 1000);
          events.push([events.length + 1, accountId, rng.weighted(EVENT_TYPES, EVENT_WEIGHTS), isoTimestamp(at)]);
        }

        if (m === subStartMonth) continue;
        // Churn?
        if (rng.next() < plan.churn * (churnRisk ? 3 : 1)) {
          const endedAt = addDays(monthStart(m), rng.int(0, 27));
          subscriptions.push(
            subRow(
              subscriptions.length + 1,
              accountId,
              plan,
              billing,
              seats,
              mrr,
              subStart,
              endedAt,
              "canceled",
              rng.weighted(CANCEL_REASONS, [26, 22, 20, 24, 8]),
            ),
          );
          alive = false;
          break;
        }
        // Upgrade?
        const next = PLANS[plan.tier];
        if (next && rng.next() < plan.upgrade) {
          const changedAt = addDays(monthStart(m), rng.int(0, 27));
          subscriptions.push(
            subRow(
              subscriptions.length + 1,
              accountId,
              plan,
              billing,
              seats,
              mrr,
              subStart,
              changedAt,
              "upgraded",
              null,
            ),
          );
          plan = next;
          seats = Math.max(seats, Math.round(plan.includedSeats * rng.float(0.5, 1.2)));
          if (plan.tier >= 3 && billing === "monthly" && rng.bool(0.3)) billing = "annual";
          subStart = changedAt;
          subStartMonth = m;
          continue;
        }
        // Seat expansion.
        if (rng.bool(0.04)) seats += rng.int(1, Math.max(2, Math.round(seats * 0.25)));
      }
    }
    if (alive) {
      subscriptions.push(
        subRow(
          subscriptions.length + 1,
          accountId,
          plan,
          billing,
          seats,
          subscriptionMrr(plan, seats, billing),
          subStart,
          null,
          "active",
          null,
        ),
      );
    }
  }

  // Invoices reference the subscription that was current when issued; we assigned
  // a provisional id (the next subscription row) so fix it up by account order.
  remapInvoiceSubscriptions(invoices, subscriptions);

  return [
    {
      name: "plans",
      description: "Pricing plans. Price is per month before seat overage.",
      columns: [
        { name: "plan_id", type: "integer", primaryKey: true },
        { name: "name", type: "text" },
        { name: "tier", type: "integer", description: "1 (Starter) to 4 (Enterprise)" },
        { name: "monthly_price", type: "numeric", description: "USD per month" },
        { name: "included_seats", type: "integer" },
        { name: "extra_seat_price", type: "numeric", description: "USD per seat per month above included_seats" },
      ],
      rows: PLANS.map((p) => [p.id, p.name, p.tier, p.monthlyPrice, p.includedSeats, p.seatPrice]),
    },
    {
      name: "accounts",
      description: "Customer companies.",
      columns: [
        { name: "account_id", type: "integer", primaryKey: true },
        { name: "company_name", type: "text" },
        { name: "industry", type: "text" },
        { name: "region", type: "text" },
        { name: "employee_band", type: "text", description: "1-10, 11-50, 51-200, 201-1000 or 1000+" },
        { name: "acquisition_channel", type: "text", description: "Self-serve, Sales-led, Partner or Product Hunt" },
        { name: "created_at", type: "date" },
      ],
      rows: accounts,
    },
    {
      name: "subscriptions",
      description:
        "Subscription history. An account has one row per plan it has been on. status: active, canceled (churned) or upgraded (replaced by a higher plan). MRR of active subscriptions at a date = subscriptions where started_at <= date and (ended_at is null or ended_at > date).",
      columns: [
        { name: "subscription_id", type: "integer", primaryKey: true },
        { name: "account_id", type: "integer", references: "accounts.account_id" },
        { name: "plan_id", type: "integer", references: "plans.plan_id" },
        {
          name: "billing_period",
          type: "text",
          description: "monthly or annual (annual is billed upfront at 20% off)",
        },
        { name: "seats", type: "integer" },
        { name: "mrr", type: "numeric", description: "Monthly recurring revenue in USD" },
        { name: "status", type: "text" },
        { name: "started_at", type: "date" },
        { name: "ended_at", type: "date", nullable: true },
        { name: "cancel_reason", type: "text", nullable: true },
      ],
      rows: subscriptions,
    },
    {
      name: "invoices",
      description: "Invoices issued from 2024-10 onward. Annual plans are invoiced once a year for 12 months.",
      columns: [
        { name: "invoice_id", type: "integer", primaryKey: true },
        { name: "account_id", type: "integer", references: "accounts.account_id" },
        { name: "subscription_id", type: "integer", references: "subscriptions.subscription_id" },
        { name: "issued_at", type: "date" },
        { name: "amount", type: "numeric", description: "USD" },
        { name: "status", type: "text", description: "paid, open, failed or refunded" },
      ],
      rows: invoices,
    },
    {
      name: "events",
      description: "Product usage events (sampled).",
      columns: [
        { name: "event_id", type: "integer", primaryKey: true },
        { name: "account_id", type: "integer", references: "accounts.account_id" },
        { name: "event_type", type: "text" },
        { name: "occurred_at", type: "timestamp" },
      ],
      rows: events,
    },
  ];
}

function subscriptionMrr(plan: Plan, seats: number, billing: string): number {
  const overage = Math.max(0, seats - plan.includedSeats) * plan.seatPrice;
  const base = plan.monthlyPrice + overage;
  return round2(billing === "annual" ? base * 0.8 : base);
}

function subRow(
  id: number,
  accountId: number,
  plan: Plan,
  billing: string,
  seats: number,
  mrr: number,
  startedAt: Date,
  endedAt: Date | null,
  status: string,
  reason: string | null,
): CellValue[] {
  return [
    id,
    accountId,
    plan.id,
    billing,
    seats,
    mrr,
    status,
    isoDate(startedAt),
    endedAt ? isoDate(endedAt) : null,
    reason,
  ];
}

/**
 * During generation each invoice was tagged with a provisional subscription id.
 * Resolve it to the subscription whose [started_at, ended_at) range covers the
 * issue date for that account.
 */
function remapInvoiceSubscriptions(invoices: CellValue[][], subscriptions: CellValue[][]) {
  const byAccount = new Map<number, CellValue[][]>();
  for (const sub of subscriptions) {
    const accountId = sub[1] as number;
    const list = byAccount.get(accountId) ?? [];
    list.push(sub);
    byAccount.set(accountId, list);
  }
  for (const invoice of invoices) {
    const subs = byAccount.get(invoice[1] as number) ?? [];
    const issued = invoice[3] as string;
    const match =
      subs.find((s) => (s[7] as string) <= issued && (s[8] === null || (s[8] as string) > issued)) ??
      subs[subs.length - 1];
    if (match) invoice[2] = match[0] as number;
  }
}

export const saasDataset: BuiltinDataset = {
  id: "saas",
  name: "Cloudlytics",
  tagline: "SaaS metrics · MRR, churn, usage",
  description:
    "A B2B analytics SaaS with four plans, monthly and annual billing, upgrades, churn reasons and product usage events.",
  suggestions: [
    "What is our current MRR by plan?",
    "Show monthly new vs churned subscriptions over time.",
    "What are the most common cancellation reasons?",
    "Do accounts that churn use the product less beforehand?",
  ],
  generate: generateSaas,
};
