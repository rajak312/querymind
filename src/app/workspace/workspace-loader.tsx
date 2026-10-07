"use client";

import dynamic from "next/dynamic";
import { LogoMark } from "@/components/ui/logo";

/**
 * The workspace runs entirely in the browser (PGlite in a Web Worker,
 * localStorage, CodeMirror), so it is rendered client-side only.
 */
const WorkspaceApp = dynamic(() => import("@/components/workspace/workspace-app").then((m) => m.WorkspaceApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <LogoMark />
        <div className="skeleton h-8 w-48 rounded-xl" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[280px] space-y-3 border-r border-border p-4 lg:block">
          {[90, 80, 60, 75, 50].map((w) => (
            <div key={w} className="skeleton h-8" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Starting your workspace…</div>
      </div>
    </div>
  ),
});

export function WorkspaceLoader({ initialDatasetId }: { initialDatasetId?: string }) {
  return <WorkspaceApp initialDatasetId={initialDatasetId} />;
}
