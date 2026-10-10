import {
  ArrowRight,
  BarChart3,
  Code2,
  Database,
  FileUp,
  Lock,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { DemoWindow } from "@/components/landing/demo-window";
import { GithubIcon } from "@/components/ui/github-icon";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const REPO_URL = "https://github.com/lalitkumarrajak/querymind";

const FEATURES = [
  {
    icon: Database,
    title: "Postgres in your browser",
    body: "Datasets load into PGlite, a full PostgreSQL compiled to WebAssembly, running in a Web Worker. Queries take milliseconds and need no backend database.",
  },
  {
    icon: Workflow,
    title: "An agent you can audit",
    body: "Claude plans, writes SQL, reads the results and iterates. Every step is a card with the exact query, timing and result table, so nothing is a black box.",
  },
  {
    icon: RefreshCcw,
    title: "Self-correcting",
    body: "SQL errors go straight back to the model, which reads the message and fixes its own query. A step budget and a Stop button keep it in check.",
  },
  {
    icon: BarChart3,
    title: "Charts that fit the question",
    body: "Line for trends, bars for rankings, pie only when it's a true part-to-whole. Colour-blind-safe palette, tuned separately for light and dark mode.",
  },
  {
    icon: Code2,
    title: "A real SQL editor",
    body: "CodeMirror 6 with schema-aware autocomplete, Cmd/Ctrl+Enter to run, sortable results, a chart builder and CSV export. Open any AI query in it.",
  },
  {
    icon: FileUp,
    title: "Bring your own CSV",
    body: "Drop a file and QueryMind infers column types (integers, decimals, dates, booleans), creates a table and stores it in IndexedDB for next time.",
  },
];

const STEPS = [
  { title: "Ask in plain English", body: "“Which acquisition channel brings our highest-value customers?”" },
  {
    title: "Claude writes the SQL",
    body: "The model sees your schema, then calls run_sql and render_chart tools as it works.",
  },
  {
    title: "Your browser runs it",
    body: "Read-only queries execute in PGlite. Results flow back to Claude until it has the answer.",
  },
];

export default function LandingPage() {
  return (
    <div className="relative overflow-x-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--brand)_16%,transparent),transparent)]"
      />
      <header className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Logo />
        <nav className="hidden items-center gap-5 text-sm text-muted md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#how-it-works" className="hover:text-foreground">
            How it works
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/workspace"
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium hover:bg-surface-2 sm:inline-flex"
          >
            Open workspace
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-14 pb-16 text-center sm:pt-20">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted shadow-sm">
            <Sparkles className="size-3.5 text-brand" />
            Claude + PostgreSQL in your browser
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            Ask your data anything.
            <span className="mt-2 block text-3xl text-muted sm:text-5xl">Get the SQL, the chart and the answer.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted sm:text-lg">
            QueryMind is an AI data analyst. Claude writes the queries, your browser runs them on a real Postgres
            database, and every step is there for you to inspect, rerun and export.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/workspace?dataset=ecommerce"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-medium text-brand-fg shadow-lg shadow-brand/20 transition-colors hover:bg-brand-hover"
            >
              Try with sample data <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/workspace?dataset=uploads"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-surface px-6 text-[15px] font-medium hover:bg-surface-2"
            >
              <FileUp className="size-4" /> Upload a CSV
            </Link>
          </div>
          <p className="mt-4 text-xs text-subtle">No sign-up. Sample data is generated in your browser.</p>

          <div className="mx-auto mt-14 max-w-5xl text-left">
            <DemoWindow />
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-10 px-5 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Built like a real analytics tool</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted">
            Not a chat wrapper. A typed agent loop with client-side tools, a guarded SQL executor and a UI that shows
            its work.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <f.icon className="size-4.5" />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-10 px-5 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
              <ol className="mt-8 space-y-6">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-sm font-semibold">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-medium">{s.title}</h3>
                      <p className="mt-1 text-sm text-muted">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-6">
              <div className="grid gap-3 text-sm sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
                <div className="rounded-xl border border-border bg-background p-3.5">
                  <p className="font-medium">Browser</p>
                  <p className="mt-1 text-xs text-muted">Chat UI · PGlite worker · tool executor</p>
                </div>
                <span className="text-center text-subtle" aria-hidden>
                  ⇄
                </span>
                <div className="rounded-xl border border-border bg-background p-3.5">
                  <p className="font-medium">/api/chat</p>
                  <p className="mt-1 text-xs text-muted">Next.js route · SSE · rate limit</p>
                </div>
                <span className="text-center text-subtle" aria-hidden>
                  ⇄
                </span>
                <div className="rounded-xl border border-brand/30 bg-brand-soft p-3.5">
                  <p className="font-medium">Claude</p>
                  <p className="mt-1 text-xs text-muted">Opus 5.5 · tool use · streaming</p>
                </div>
              </div>
              <div className="mt-6 space-y-3 text-sm">
                <p className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-muted">
                    <span className="font-medium text-foreground">Read-only by construction.</span> A SQL tokenizer
                    allows one SELECT statement, and it runs inside a read-only transaction that is always rolled back.
                  </span>
                </p>
                <p className="flex gap-2.5">
                  <Lock className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-muted">
                    <span className="font-medium text-foreground">Your data stays local.</span> Only the schema, a few
                    sample rows and the query results Claude asks for are sent to the model. The API key never reaches
                    the browser.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pt-6 pb-20">
          <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">See it answer a question in seconds</h2>
            <Link
              href="/workspace?dataset=ecommerce"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-medium text-brand-fg hover:bg-brand-hover"
            >
              Try with sample data <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-sm text-muted sm:flex-row">
          <p>
            Built by{" "}
            <a
              href="https://github.com/lalitkumarrajak"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground hover:underline"
            >
              Lalit Kumar Rajak
            </a>{" "}
            · Next.js, Claude, PGlite
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <GithubIcon className="size-4" /> Source code
          </a>
        </div>
      </footer>
    </div>
  );
}
