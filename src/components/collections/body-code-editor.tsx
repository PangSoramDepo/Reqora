"use client";

import { useEffect, useRef, useState } from "react";
import { indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorSelection, EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, MatchDecorator, placeholder as placeholderExt, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { Icon } from "@/components/icon";
import { checkJsonTemplate, TEMPLATE_PATTERN } from "@/lib/collections/json-template";
import { highlight, theme } from "./script-code-editor";
import { useTokenFocus } from "./template-field";

type Props = {
  value: string;
  onValue: (value: string) => void;
  /** json: highlighting and live validation; text: plain, with {{templates}} still marked. */
  language: "json" | "text";
  label: string;
  placeholder?: string;
};

/** Marks {{templates}} so they stand out from the JSON around them. */
const templateMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private matcher = new MatchDecorator({
      regexp: new RegExp(TEMPLATE_PATTERN.source, "g"),
      decoration: (m) =>
        Decoration.mark({
          class: m[0].startsWith("{{env.") ? "cm-template cm-template-env" : "cm-template",
          attributes: { title: m[0].startsWith("{{env.") ? "Environment variable" : "Template, resolved when the request is sent" },
        }),
    });
    constructor(view: EditorView) {
      this.decorations = this.matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = this.matcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

const bodyTheme = EditorView.theme({
  // Beats the syntax colour of the string around a template.
  ".cm-template, .cm-template *": { color: "var(--color-primary-fixed) !important" },
  ".cm-template": { backgroundColor: "color-mix(in srgb, var(--color-primary) 14%, transparent)", borderRadius: "3px" },
  ".cm-template-env, .cm-template-env *": { color: "var(--color-tertiary-fixed) !important" },
  ".cm-template-env": { backgroundColor: "color-mix(in srgb, var(--color-tertiary) 16%, transparent)" },
});

type Status = { ok: true } | { ok: false; line: number; message: string; from: number } | null;

function statusOf(state: EditorState, language: Props["language"]): Status {
  if (language !== "json") return null;
  const problem = checkJsonTemplate(state.doc.toString());
  return problem ? { ok: false, line: state.doc.lineAt(problem.from).number, message: problem.message, from: problem.from } : { ok: true };
}

/**
 * CodeMirror editor for request bodies: JSON syntax colours, {{template}} highlighting, live JSON validation that
 * allows templates, line numbers, folding and bracket matching. Suggested Tokens chips insert at its cursor.
 */
export function BodyCodeEditor({ value, onValue, language, label, placeholder }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onValue });
  const registerFocus = useTokenFocus();
  const focusRef = useRef(registerFocus);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    latest.current = { onValue };
    focusRef.current = registerFocus;
  });

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorState.tabSize.of(2),
          language === "json" ? json() : [],
          language === "json"
            ? [
                linter(
                  (v) => {
                    const p = checkJsonTemplate(v.state.doc.toString());
                    return p ? [{ from: p.from, to: p.to, severity: "error", message: p.message }] : [];
                  },
                  { delay: 250 },
                ),
                lintGutter(),
              ]
            : [],
          templateMarks,
          syntaxHighlighting(highlight),
          theme,
          bodyTheme,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.domEventHandlers({
            focus: (_event, v) => {
              focusRef.current?.({
                alive: () => v.dom.isConnected,
                insert: (token) => {
                  const range = v.state.selection.main;
                  v.dispatch({ changes: { from: range.from, to: range.to, insert: token }, selection: EditorSelection.cursor(range.from + token.length) });
                  v.focus();
                },
              });
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onValue(update.state.doc.toString());
            if (update.docChanged || update.startState.doc.length === 0) {
              const next = statusOf(update.state, language);
              setStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
            }
          }),
        ],
      }),
    });
    view.current = editor;
    setStatus(statusOf(editor.state, language));
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Created once per language; later `value` changes (Beautify, reverting a draft) are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  const jumpTo = (from: number) => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ selection: EditorSelection.cursor(from), scrollIntoView: true });
    editor.focus();
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div ref={host} className="flex-1 min-h-0 overflow-hidden" data-testid="body-code-editor" />
      {status && value.trim() !== "" && (
        <div
          className="shrink-0 px-space-sm py-0.5 flex items-center gap-space-sm font-label-sm text-label-sm bg-surface-container-low/70 min-w-0"
          data-testid="body-status"
        >
          {status.ok ? (
            <span className="text-outline flex items-center gap-1">
              <Icon name="check_circle" className="text-body-sm text-primary" /> Valid JSON
            </span>
          ) : (
            <button
              type="button"
              onClick={() => jumpTo(status.from)}
              className="text-error flex items-center gap-1 truncate min-w-0 text-left hover:underline"
              title={status.message}
            >
              <Icon name="error" className="text-body-sm" /> Line {status.line}: {status.message}
            </button>
          )}
          <span className="ml-auto shrink-0 text-outline hidden sm:inline">{"{{templates}} are allowed anywhere"}</span>
        </div>
      )}
    </div>
  );
}
