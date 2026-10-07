import { cn } from "@/lib/utils";

/** QueryMind mark: a rounded square with an ascending bar trio and a spark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <rect x="8" y="17" width="4" height="7" rx="1.5" fill="var(--brand-fg)" opacity="0.65" />
      <rect x="14" y="12" width="4" height="12" rx="1.5" fill="var(--brand-fg)" opacity="0.85" />
      <rect x="20" y="8" width="4" height="16" rx="1.5" fill="var(--brand-fg)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[17px]">QueryMind</span>
    </span>
  );
}
