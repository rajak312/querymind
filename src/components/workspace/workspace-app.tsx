"use client";

import { Code2, Menu, MessageSquareText, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/github-icon";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";
import { Sidebar } from "./sidebar";
import { SqlEditorPanel } from "./sql-editor-panel";
import { useWorkspace, WorkspaceProvider, type WorkspaceTab } from "./workspace-context";

const TABS: { id: WorkspaceTab; label: string; icon: typeof Code2 }[] = [
  { id: "chat", label: "Ask AI", icon: MessageSquareText },
  { id: "editor", label: "SQL editor", icon: Code2 },
];

function AiStatusPill() {
  const { ai } = useWorkspace();
  if (ai.state === "loading") return <div className="skeleton hidden h-6 w-32 rounded-full md:block" />;
  const label =
    ai.state === "ready"
      ? ai.model
      : ai.state === "mock"
        ? "mock mode"
        : ai.state === "missing_api_key"
          ? "AI not configured"
          : "offline";
  const dot = ai.state === "ready" ? "bg-success" : ai.state === "mock" ? "bg-warning" : "bg-danger";
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-[11px] text-muted md:flex"
      title="Model used by the AI analyst"
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

function Shell() {
  const { tab, setTab, newChat, dataset } = useWorkspace();
  // The mobile drawer belongs to the dataset/tab it was opened on, so switching either closes it.
  const drawerKey = `${dataset.id}:${tab}`;
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const drawer = drawerFor === drawerKey;
  const setDrawer = (open: boolean) => setDrawerFor(open ? drawerKey : null);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open sidebar"
          onClick={() => setDrawer(true)}
        >
          <Menu />
        </Button>
        <Link href="/" className="mr-2 rounded-lg" aria-label="QueryMind home">
          <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
        </Link>
        <nav className="flex items-center gap-0.5 rounded-xl bg-surface-2 p-0.5" aria-label="Workspace">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium transition-colors",
                tab === t.id ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              <t.icon className="size-4" />
              <span className="hidden min-[400px]:inline">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <AiStatusPill />
          <Button variant="secondary" size="sm" onClick={newChat} className="hidden sm:inline-flex">
            <Plus /> New chat
          </Button>
          <Button variant="ghost" size="icon" onClick={newChat} className="sm:hidden" aria-label="New chat">
            <Plus />
          </Button>
          <ThemeToggle />
          <a
            href="https://github.com/lalitkumarrajak/querymind"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            className="hidden size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground sm:flex"
          >
            <GithubIcon className="size-4" />
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[280px] shrink-0 border-r border-border bg-background lg:block">
          <Sidebar />
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Sidebar">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] animate-fade-in flex-col border-r border-border bg-background shadow-2xl">
              <div className="flex h-14 items-center justify-between border-b border-border px-3">
                <Logo />
                <Button variant="ghost" size="icon" aria-label="Close sidebar" onClick={() => setDrawer(false)}>
                  <X />
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <Sidebar />
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <div className={cn("h-full", tab !== "chat" && "hidden")}>
            <ChatPanel />
          </div>
          <div className={cn("h-full", tab !== "editor" && "hidden")}>
            {/* Remount per dataset so results from another dataset never linger. */}
            <SqlEditorPanel key={dataset.id} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function WorkspaceApp({ initialDatasetId }: { initialDatasetId?: string }) {
  return (
    <WorkspaceProvider initialDatasetId={initialDatasetId}>
      <Shell />
    </WorkspaceProvider>
  );
}
