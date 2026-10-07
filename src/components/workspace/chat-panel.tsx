"use client";

import {
  AlertTriangle,
  ArrowUp,
  Brain,
  ChevronRight,
  CircleStop,
  FileUp,
  Info,
  KeyRound,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { isBusy, type Notice } from "@/lib/agent/state";
import { buildChatTurns, type AssistantItem } from "@/lib/agent/view";
import { cn, formatCount } from "@/lib/utils";
import { Markdown } from "./markdown";
import { StepCard } from "./step-card";
import { useWorkspace } from "./workspace-context";

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = open || streaming;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
      >
        <Brain className={cn("size-3.5", streaming && "animate-pulse text-brand")} />
        {streaming ? "Thinking…" : "Reasoning"}
        <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <p className="mt-1.5 max-h-48 overflow-y-auto border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
          {text}
        </p>
      )}
    </div>
  );
}

const NOTICE_STYLE: Record<Notice["kind"], { icon: typeof Info; className: string }> = {
  stopped: { icon: CircleStop, className: "text-muted bg-surface-2 border-border" },
  error: { icon: AlertTriangle, className: "text-danger bg-danger-soft border-danger/25" },
  max_iterations: { icon: Info, className: "text-warning bg-warning-soft border-warning/25" },
  max_tokens: { icon: Info, className: "text-warning bg-warning-soft border-warning/25" },
  refusal: { icon: ShieldAlert, className: "text-warning bg-warning-soft border-warning/25" },
  fallback: { icon: Info, className: "text-muted bg-surface-2 border-border" },
};

function NoticeBanner({ notice }: { notice: Notice }) {
  const style = NOTICE_STYLE[notice.kind];
  const Icon = style.icon;
  return (
    <div
      role="status"
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", style.className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{notice.message}</span>
    </div>
  );
}

function AssistantItemView({ item }: { item: AssistantItem }) {
  const { agent } = useWorkspace();
  switch (item.kind) {
    case "text":
      return <Markdown text={item.text} />;
    case "thinking":
      return <ThinkingBlock text={item.text} streaming={item.streaming} />;
    case "notice":
      return <NoticeBanner notice={item.notice} />;
    case "tool":
      return (
        <StepCard
          name={item.name}
          input={item.input}
          run={agent.conversation.runs[item.id]}
          partialJson={item.partialJson}
        />
      );
  }
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2" aria-label="QueryMind is working">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-subtle"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  const { dataset, schemaState, ask, ai, uploadFiles, uploading } = useWorkspace();
  const tables = schemaState.status === "ready" ? schemaState.schema.tables : [];
  const disabled = schemaState.status !== "ready" || ai.state === "missing_api_key" || ai.state === "loading";
  const fileInput = useRef<HTMLInputElement>(null);

  if (schemaState.status === "ready" && tables.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 pt-16 pb-6 text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <FileUp className="size-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Bring your own data</h2>
        <p className="mt-2 text-[15px] text-muted">
          Upload one or more CSV files. QueryMind infers column types, creates Postgres tables in your browser and keeps
          them in IndexedDB for your next visit.
        </p>
        <Button
          variant="primary"
          size="lg"
          className="mt-6"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <Upload /> {uploading ? "Importing…" : "Choose CSV files"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void uploadFiles(files);
          }}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 pt-10 pb-6 text-center sm:pt-16">
      <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Sparkles className="size-6" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Ask {dataset.name} anything</h2>
      <p className="mt-2 max-w-lg text-[15px] text-muted">{dataset.description}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {schemaState.status === "loading"
          ? [64, 80, 56, 72].map((w) => <div key={w} className="skeleton h-6 rounded-full" style={{ width: w }} />)
          : tables.map((t) => (
              <span
                key={t.name}
                className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-xs text-muted"
              >
                {t.name} <span className="text-subtle">· {formatCount(t.rowCount)}</span>
              </span>
            ))}
      </div>
      <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
        {dataset.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => ask(s)}
            className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-left text-sm shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-all hover:-translate-y-px hover:border-brand/40 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
          >
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-subtle group-hover:text-brand" />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ApiKeyBanner() {
  const { ai, openInEditor, dataset } = useWorkspace();
  if (ai.state === "mock") {
    return (
      <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
        <Info className="size-3.5 shrink-0" />
        Dev mock mode (QUERYMIND_MOCK=1): answers are scripted, the SQL runs for real.
      </div>
    );
  }
  if (ai.state !== "missing_api_key" && ai.state !== "error") return null;
  return (
    <div className="mx-auto mb-3 flex w-full max-w-3xl items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3.5 text-sm">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex-1">
        <p className="font-medium text-foreground">
          {ai.state === "error" ? "Couldn't reach the server" : "The AI analyst isn't configured on this deployment"}
        </p>
        <p className="mt-0.5 text-muted">
          {ai.state === "error"
            ? "Check your connection and reload the page."
            : "The server has no ANTHROPIC_API_KEY. Everything else works: explore the schema and run your own SQL."}
        </p>
        {ai.state === "missing_api_key" && (
          <button
            type="button"
            className="mt-2 text-[13px] font-medium text-brand hover:underline"
            onClick={() =>
              openInEditor(
                `-- Try a query on ${dataset.name}\nSELECT *\nFROM information_schema.tables\nWHERE table_schema = 'public';`,
              )
            }
          >
            Open the SQL editor →
          </button>
        )}
      </div>
    </div>
  );
}

function Composer() {
  const { ask, stop, agent, ai, schemaState, registerInsertTarget, dataset } = useWorkspace();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = isBusy(agent.status);
  const unavailable = ai.state === "missing_api_key" || ai.state === "error";
  const notReady = schemaState.status !== "ready";

  useEffect(() => {
    registerInsertTarget("chat", (value) => {
      setText((t) => (t && !t.endsWith(" ") ? `${t} ${value}` : `${t}${value}`));
      ref.current?.focus();
    });
    return () => registerInsertTarget("chat", null);
  }, [registerInsertTarget]);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || busy || unavailable || notReady) return;
    ask(text);
    setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-3xl"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-border-strong bg-surface p-2 shadow-sm transition-shadow focus-within:border-brand/50 focus-within:shadow-md focus-within:ring-4 focus-within:ring-brand/10">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={unavailable}
          placeholder={
            unavailable
              ? "AI analyst unavailable on this deployment"
              : notReady
                ? "Loading dataset…"
                : `Ask a question about ${dataset.name}…`
          }
          aria-label="Ask a question about your data"
          className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-subtle disabled:cursor-not-allowed"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generating"
            title="Stop"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity hover:opacity-85"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!text.trim() || unavailable || notReady}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg transition-colors hover:bg-brand-hover disabled:bg-surface-3 disabled:text-subtle"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      <p className="mt-2 hidden text-center text-[11px] text-subtle sm:block">
        Claude writes read-only SQL that runs on Postgres in your browser · Enter to send, Shift+Enter for a new line
      </p>
    </form>
  );
}

export function ChatPanel() {
  const { agent } = useWorkspace();
  const { conversation, draft, status } = agent;
  const turns = useMemo(
    () => buildChatTurns(conversation.messages, conversation.notices, draft),
    [conversation.messages, conversation.notices, draft],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const busy = isBusy(status);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Follow the stream unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns, conversation.runs]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [conversation.id]);

  const lastTurn = turns[turns.length - 1];
  const showTyping =
    busy && (lastTurn?.role !== "assistant" || lastTurn.items.length === 0 || status === "running_tools");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-10 sm:px-6">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.key} className="flex animate-fade-in justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-[15px] whitespace-pre-wrap text-foreground">
                    {turn.text}
                  </div>
                </div>
              ) : (
                <div key={turn.key} className="flex gap-3">
                  <LogoMark className="mt-0.5 size-7 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {turn.items.map((item) => (
                      <AssistantItemView key={item.key} item={item} />
                    ))}
                    {turn === lastTurn && showTyping && <TypingIndicator />}
                  </div>
                </div>
              ),
            )}
            {showTyping && lastTurn?.role === "user" && (
              <div className="flex gap-3">
                <LogoMark className="mt-0.5 size-7 shrink-0" />
                <TypingIndicator />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-border bg-background/80 px-3 pt-3 pb-3 backdrop-blur sm:px-6">
        <ApiKeyBanner />
        <Composer />
      </div>
    </div>
  );
}
