"use client";

import {
  AlertCircle,
  ChevronRight,
  Cloud,
  FileUp,
  Hash,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RotateCw,
  ShoppingBag,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DATASETS } from "@/lib/datasets";
import type { SchemaTable } from "@/lib/db/types";
import { cn, formatCount, relativeTime } from "@/lib/utils";
import { useWorkspace } from "./workspace-context";

const DATASET_ICONS: Record<string, typeof Cloud> = { ecommerce: ShoppingBag, saas: Cloud, uploads: FileUp };

const TYPE_BADGE: Record<string, string> = {
  integer: "int",
  bigint: "int8",
  numeric: "num",
  "double precision": "float",
  text: "text",
  date: "date",
  timestamp: "ts",
  timestamptz: "tstz",
  boolean: "bool",
};

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-4 pb-1.5">
      <h3 className="text-[11px] font-semibold tracking-wider text-subtle uppercase">{children}</h3>
      {action}
    </div>
  );
}

function DatasetPicker() {
  const { dataset, selectDataset } = useWorkspace();
  return (
    <div className="flex flex-col gap-1 px-2" role="radiogroup" aria-label="Dataset">
      {DATASETS.map((d) => {
        const Icon = DATASET_ICONS[d.id] ?? Table2;
        const active = d.id === dataset.id;
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => selectDataset(d.id)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
              active ? "bg-surface shadow-[0_0_0_1px_var(--border)]" : "hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                active ? "bg-brand text-brand-fg" : "bg-surface-3 text-muted",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{d.name}</span>
              <span className="block truncate text-xs text-muted">{d.tagline}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TableNode({ table, canDelete }: { table: SchemaTable; canDelete: boolean }) {
  const { insertText, dropUploadedTable } = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="group flex items-center rounded-md hover:bg-surface-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${table.name}`}
          className="flex size-7 shrink-0 items-center justify-center text-subtle"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={() => insertText(table.name)}
          title={`${table.description ?? table.name}\nClick to insert`}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left"
        >
          <Table2 className="size-3.5 shrink-0 text-muted" />
          <span className="truncate font-mono text-[13px]">{table.name}</span>
          <span className="ml-auto pl-2 text-[11px] text-subtle tabular-nums">{formatCount(table.rowCount)}</span>
        </button>
        {canDelete && (
          <button
            type="button"
            title={`Delete ${table.name}`}
            aria-label={`Delete table ${table.name}`}
            onClick={() => {
              if (window.confirm(`Delete the table "${table.name}"? This cannot be undone.`))
                void dropUploadedTable(table.name);
            }}
            className="mr-1 hidden size-6 items-center justify-center rounded text-subtle group-hover:flex hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {open && (
        <ul className="mb-1 ml-[22px] border-l border-border pl-1.5">
          {table.columns.map((column) => (
            <li key={column.name}>
              <button
                type="button"
                onClick={() => insertText(column.name)}
                title={[column.description, column.references && `→ ${column.references}`, "Click to insert"]
                  .filter(Boolean)
                  .join("\n")}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-surface-2"
              >
                {column.primaryKey ? (
                  <KeyRound className="size-3 shrink-0 text-warning" aria-label="Primary key" />
                ) : column.references ? (
                  <Link2 className="size-3 shrink-0 text-brand" aria-label="Foreign key" />
                ) : (
                  <Hash className="size-3 shrink-0 text-subtle" />
                )}
                <span className="truncate font-mono text-xs">{column.name}</span>
                <span className="ml-auto shrink-0 rounded bg-surface-3 px-1 py-px font-mono text-[10px] text-muted">
                  {TYPE_BADGE[column.type] ?? column.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SchemaExplorer() {
  const { schemaState, dataset, reloadSchema } = useWorkspace();
  if (schemaState.status === "loading") {
    return (
      <div className="space-y-2.5 px-3 py-2" aria-busy="true">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" /> Loading {dataset.name} into Postgres…
        </p>
        {[70, 55, 80, 62].map((w) => (
          <div key={w} className="skeleton h-5" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (schemaState.status === "error") {
    return (
      <div className="mx-3 my-2 rounded-lg border border-danger/25 bg-danger-soft p-3 text-xs text-danger">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="size-3.5" /> Couldn&apos;t load the database
        </p>
        <p className="mt-1 break-words text-danger/90">{schemaState.error}</p>
        <Button size="sm" variant="secondary" className="mt-2 h-7" onClick={reloadSchema}>
          <RotateCw /> Retry
        </Button>
      </div>
    );
  }
  const { tables } = schemaState.schema;
  if (tables.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">No tables yet. Upload a CSV file to get started.</p>;
  }
  return (
    <ul className="px-1.5">
      {tables.map((t) => (
        <TableNode key={t.name} table={t} canDelete={dataset.id === "uploads"} />
      ))}
    </ul>
  );
}

function CsvUpload() {
  const { uploadFiles, uploading } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="px-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...e.dataTransfer.files].filter((f) => /\.(csv|tsv|txt)$/i.test(f.name));
          if (files.length) void uploadFiles(files);
        }}
        disabled={uploading}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-3.5 text-center text-xs transition-colors",
          dragging
            ? "border-brand bg-brand-soft text-brand"
            : "border-border-strong text-muted hover:border-brand/50 hover:text-foreground",
        )}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        <span className="font-medium">{uploading ? "Importing…" : "Upload CSV"}</span>
        <span className="text-[11px] text-subtle">Drop files or click · stays in your browser</span>
      </button>
      <input
        ref={input}
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

function History() {
  const { conversations, agent, openConversation, deleteConversation, newChat } = useWorkspace();
  const activeId = agent.conversation.id;
  return (
    <>
      <SectionTitle
        action={
          <Button size="icon-sm" variant="ghost" onClick={newChat} aria-label="New chat" title="New chat">
            <Plus className="!size-3.5" />
          </Button>
        }
      >
        Recent analyses
      </SectionTitle>
      {conversations.length === 0 ? (
        <p className="px-3 text-xs text-subtle">Your conversations are saved in this browser.</p>
      ) : (
        <ul className="px-1.5 pb-3">
          {conversations.slice(0, 20).map((c) => {
            const dataset = DATASETS.find((d) => d.id === c.datasetId);
            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 pr-8 text-left",
                    c.id === activeId ? "bg-surface shadow-[0_0_0_1px_var(--border)]" : "hover:bg-surface-2",
                  )}
                >
                  <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-subtle" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{c.title}</span>
                    <span className="block text-[11px] text-subtle">
                      {dataset?.name ?? c.datasetId} · {relativeTime(c.updatedAt)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete conversation ${c.title}`}
                  title="Delete"
                  onClick={() => deleteConversation(c.id)}
                  className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-subtle opacity-100 hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function Sidebar() {
  const { dataset } = useWorkspace();
  return (
    <div className="flex h-full flex-col overflow-y-auto pb-4">
      <SectionTitle>Dataset</SectionTitle>
      <DatasetPicker />
      <SectionTitle>Schema</SectionTitle>
      <SchemaExplorer />
      {dataset.id === "uploads" && (
        <div className="pt-3">
          <CsvUpload />
        </div>
      )}
      <History />
      {dataset.id !== "uploads" && (
        <div className="mt-auto pt-2">
          <CsvUpload />
        </div>
      )}
    </div>
  );
}
