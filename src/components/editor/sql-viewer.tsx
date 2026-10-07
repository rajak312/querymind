"use client";

import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { baseTheme, sqlHighlighting, sqlLanguage } from "./sql-extensions";

const extensions = [sqlLanguage(), sqlHighlighting, baseTheme, EditorView.lineWrapping];

/** Read-only, syntax-highlighted SQL (CodeMirror 6). */
export function SqlViewer({ value }: { value: string }) {
  return (
    <CodeMirror
      value={value}
      readOnly
      editable={false}
      theme="none"
      className="cm-readonly"
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
        autocompletion: false,
        searchKeymap: false,
      }}
    />
  );
}
