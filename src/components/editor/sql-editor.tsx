"use client";

import { closeCompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { DatabaseSchema } from "@/lib/db/types";
import { baseTheme, sqlHighlighting, sqlLanguage } from "./sql-extensions";

export interface SqlEditorHandle {
  insert: (text: string) => void;
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema?: DatabaseSchema;
}

/** Editable SQL editor with schema-aware autocomplete and Cmd/Ctrl+Enter to run. */
export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, onRun, schema },
  ref,
) {
  const cm = useRef<ReactCodeMirrorRef>(null);
  const runRef = useRef(onRun);
  useEffect(() => {
    runRef.current = onRun;
  }, [onRun]);

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const view = cm.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    focus() {
      cm.current?.view?.focus();
    },
  }));

  const extensions = useMemo(
    () => [
      sqlLanguage(schema),
      sqlHighlighting,
      baseTheme,
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: (view) => {
              closeCompletion(view);
              runRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [schema],
  );

  return (
    <CodeMirror
      ref={cm}
      value={value}
      onChange={onChange}
      theme="none"
      height="100%"
      className="h-full"
      placeholder="Write a SELECT query…"
      extensions={extensions}
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: true }}
      aria-label="SQL editor"
    />
  );
});
