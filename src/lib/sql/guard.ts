/**
 * Read-only SQL guard.
 *
 * The model (and the user, in the editor) can only run a single read-only
 * statement. This is the first of two layers: the executor additionally runs
 * every query inside `BEGIN TRANSACTION READ ONLY` and rolls it back, so even
 * something that slips past this lexical check cannot write.
 *
 * The guard tokenizes the SQL (respecting string literals, quoted identifiers,
 * dollar-quoted strings and comments) rather than using regexes on raw text, so
 * a keyword inside a string such as `WHERE note = 'delete me'` is not a false
 * positive and a keyword hidden in a comment cannot smuggle a second statement.
 */

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

const ALLOWED_FIRST_KEYWORDS = new Set(["select", "with", "values", "table"]);

/** Statements/verbs that may never appear anywhere in a read-only query. */
const FORBIDDEN_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "upsert",
  "truncate",
  "drop",
  "create",
  "alter",
  "grant",
  "revoke",
  "copy",
  "vacuum",
  "reindex",
  "cluster",
  "call",
  "do",
  "listen",
  "notify",
  "unlisten",
  "prepare",
  "execute",
  "deallocate",
  "discard",
  "lock",
  "refresh",
  "import",
  "load",
  "security",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "release",
  "reset",
  "set",
  "into",
  "checkpoint",
  "comment",
  "reassign",
  "attach",
  "detach",
]);

/** Functions with side effects or access outside the query's data. */
const FORBIDDEN_FUNCTIONS = new Set([
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "lo_import",
  "lo_export",
  "lo_create",
  "lo_unlink",
  "set_config",
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "nextval",
  "setval",
  "dblink",
  "dblink_exec",
  "pg_advisory_lock",
  "pg_try_advisory_lock",
  "txid_current",
  "pg_switch_wal",
  "query_to_xml",
  "pg_logical_emit_message",
  "pg_notify",
]);

interface Token {
  kind: "word" | "symbol" | "string" | "quoted";
  value: string;
}

export class SqlTokenizeError extends Error {}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // -- line comment
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // /* block comment */ (Postgres allows nesting)
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth > 0) throw new SqlTokenizeError("Unterminated block comment");
      continue;
    }
    // 'string' (with '' escapes); E'...' handled by the word branch + this branch
    if (ch === "'") {
      let j = i + 1;
      let escapeBackslash = false;
      const prev = tokens[tokens.length - 1];
      if (prev?.kind === "word" && prev.value.toLowerCase() === "e") escapeBackslash = true;
      while (j < n) {
        if (escapeBackslash && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= n) throw new SqlTokenizeError("Unterminated string literal");
      tokens.push({ kind: "string", value: sql.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    // "quoted identifier"
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= n) throw new SqlTokenizeError("Unterminated quoted identifier");
      tokens.push({ kind: "quoted", value: sql.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    // $tag$ dollar-quoted string $tag$
    if (ch === "$") {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new SqlTokenizeError("Unterminated dollar-quoted string");
        tokens.push({ kind: "string", value: sql.slice(i + tag.length, end) });
        i = end + tag.length;
        continue;
      }
    }
    // identifiers / keywords / numbers
    if (/[A-Za-z0-9_]/.test(ch) || ch.charCodeAt(0) > 127) {
      let j = i + 1;
      while (j < n && (/[A-Za-z0-9_$.]/.test(sql[j]!) || sql.charCodeAt(j) > 127)) {
        // keep numbers like 1.5 together, but split qualified names a.b into words
        if (sql[j] === "." && !/^[0-9]/.test(ch)) break;
        j++;
      }
      tokens.push({ kind: "word", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ kind: "symbol", value: ch });
    i++;
  }
  return tokens;
}

/** Remove trailing semicolons/whitespace so the statement can be wrapped. */
function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/[\s;]+$/u, "");
}

export function checkReadOnlySql(input: string): GuardResult {
  const sql = input.trim();
  if (!sql) return { ok: false, reason: "The query is empty." };
  if (sql.length > 20_000) return { ok: false, reason: "The query is too long (max 20,000 characters)." };

  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (tokens.length === 0) return { ok: false, reason: "The query only contains comments." };

  // A single statement: semicolons are only allowed at the very end.
  const semicolonIndex = tokens.findIndex((t) => t.kind === "symbol" && t.value === ";");
  if (semicolonIndex !== -1 && tokens.slice(semicolonIndex).some((t) => !(t.kind === "symbol" && t.value === ";"))) {
    return { ok: false, reason: "Only a single SQL statement can be run at a time." };
  }

  const first = tokens[0]!;
  const firstWord = first.kind === "word" ? first.value.toLowerCase() : first.value;
  if (first.kind !== "word" || !ALLOWED_FIRST_KEYWORDS.has(firstWord)) {
    if (first.kind === "symbol" && first.value === "(") {
      // Parenthesised SELECT, e.g. (SELECT 1) UNION (SELECT 2)
      const firstWordToken = tokens.find((t) => t.kind === "word");
      if (!firstWordToken || !ALLOWED_FIRST_KEYWORDS.has(firstWordToken.value.toLowerCase())) {
        return { ok: false, reason: "Only read-only SELECT queries are allowed." };
      }
    } else {
      return {
        ok: false,
        reason: `Only read-only queries are allowed (SELECT / WITH). "${firstWord.toUpperCase()}" statements are blocked.`,
      };
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "word") continue;
    const word = token.value.toLowerCase();
    if (FORBIDDEN_KEYWORDS.has(word)) {
      // This also catches data-modifying CTEs (WITH x AS (DELETE ...)),
      // SELECT ... INTO and FOR UPDATE row locks.
      return { ok: false, reason: `Read-only mode: "${word.toUpperCase()}" is not allowed.` };
    }
    const nextToken = tokens[i + 1];
    if (FORBIDDEN_FUNCTIONS.has(word) && nextToken?.kind === "symbol" && nextToken.value === "(") {
      return { ok: false, reason: `The function ${word}() is not allowed.` };
    }
  }

  return { ok: true, sql: stripTrailingSemicolons(sql) };
}
