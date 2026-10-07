import { PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { DatabaseSchema } from "@/lib/db/types";

/** Syntax colours come from CSS variables so one theme serves light and dark. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--code-keyword)", fontWeight: "500" },
  { tag: [t.string, t.special(t.string)], color: "var(--code-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--code-number)" },
  { tag: [t.lineComment, t.blockComment, t.comment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.standard(t.name), t.typeName], color: "var(--code-function)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--code-operator)" },
  { tag: [t.name, t.variableName, t.propertyName], color: "var(--foreground)" },
]);

export const baseTheme = EditorView.theme({
  "&": { color: "var(--foreground)" },
  ".cm-content": { caretColor: "var(--foreground)", padding: "10px 0" },
  ".cm-line": { padding: "0 14px" },
  ".cm-placeholder": { color: "var(--subtle)" },
});

export const sqlHighlighting = syntaxHighlighting(highlight);

/** Schema-aware SQL language support for autocomplete. */
export function sqlLanguage(schema?: DatabaseSchema) {
  const namespace: SQLNamespace = {};
  for (const table of schema?.tables ?? []) {
    namespace[table.name] = {
      self: { label: table.name, type: "type", detail: `${table.rowCount.toLocaleString("en-US")} rows` },
      children: table.columns.map((c) => ({ label: c.name, type: "property", detail: c.type })),
    };
  }
  return sql({ dialect: PostgreSQL, schema: namespace, upperCaseKeywords: true });
}
