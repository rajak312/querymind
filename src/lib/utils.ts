import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CellValue } from "@/lib/datasets/types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatCount(n: number): string {
  return integer.format(n);
}

export function formatCompact(n: number): string {
  return Math.abs(n) >= 10_000 ? compact.format(n) : decimal.format(n);
}

export function formatNumber(
  value: number,
  format: "number" | "currency" | "percent" = "number",
  short = false,
): string {
  if (format === "currency")
    return `${value < 0 ? "-" : ""}$${short ? formatCompact(Math.abs(value)) : decimal.format(Math.abs(value))}`;
  if (format === "percent") return `${decimal.format(value)}%`;
  return short ? formatCompact(value) : decimal.format(value);
}

export function formatDuration(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Format a result cell. Identifier-like columns (ids, years) are never thousands-grouped. */
export function formatCell(value: CellValue, columnName = ""): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (/(^|_)(id|year|zip|code)$/i.test(columnName) || (Number.isInteger(value) && !columnName)) return String(value);
    return decimal.format(value);
  }
  return String(value);
}

/** RFC 4180 CSV for a result set. */
export function toCsv(columns: string[], rows: CellValue[][]): string {
  const escape = (v: CellValue) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\r\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
