"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { javascript, javascriptLanguage, scopeCompletionSource } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { forEachDiagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { Icon } from "@/components/icon";
import { completeScript, hoverScript, lintScript } from "@/lib/collections/script-analysis";
import { SANDBOX_GLOBALS, type ScriptPhase } from "@/lib/collections/script-api";

export type ScriptCodeEditorHandle = {
  /** Inserts code on its own line at the cursor (or at the end when the editor isn't focused). */
  insert: (code: string) => void;
};

type Props = {
  value: string;
  onValue: (value: string) => void;
  phase: ScriptPhase;
  label: string;
  placeholder?: string;
  /** Names in the selected environment, suggested inside rq.environment.get("…"). */
  envNames?: string[];
  handle?: Ref<ScriptCodeEditorHandle>;
};

type Problems = { errors: number; warnings: number; first: { line: number; message: string; from: number } | null };

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--color-surface-container-lowest)", color: "var(--color-on-surface)", fontSize: "12px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-code-block)", lineHeight: "18px", overflow: "auto" },
    ".cm-content": { caretColor: "var(--color-primary)", padding: "8px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--color-primary) 25%, transparent) !important",
    },
    ".cm-gutters": { backgroundColor: "var(--color-surface-container-lowest)", color: "var(--color-outline)", border: "none" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-surface-container-high) 45%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-on-surface)" },
    ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--color-primary) 20%, transparent)", outline: "none" },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--color-tertiary) 18%, transparent)" },
    ".cm-placeholder": { color: "var(--color-outline)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--color-surface-container-high)", border: "none", color: "var(--color-outline)" },
    ".cm-tooltip": {
      backgroundColor: "var(--color-surface-container-high)",
      color: "var(--color-on-surface)",
      border: "1px solid var(--color-outline-variant)",
      borderRadius: "6px",
      fontFamily: "var(--font-code-block)",
      fontSize: "12px",
      overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)",
      color: "var(--color-on-surface)",
    },
    ".cm-completionDetail": { color: "var(--color-outline)", fontStyle: "normal", marginLeft: "8px" },
    ".cm-completionMatchedText": { color: "var(--color-primary)", textDecoration: "none", fontWeight: "600" },
    ".cm-completionInfo": { padding: "6px 8px", maxWidth: "320px", whiteSpace: "pre-wrap" },
    ".cm-diagnostic": { padding: "4px 8px", whiteSpace: "pre-wrap", maxWidth: "460px" },
    ".cm-diagnostic-error": { borderLeft: "3px solid var(--color-error)" },
    ".cm-diagnostic-warning": { borderLeft: "3px solid var(--color-tertiary)" },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--color-error)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
    ".cm-lintRange-warning": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--color-tertiary)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
    ".cm-hover-doc": { padding: "6px 8px", maxWidth: "360px" },
    ".cm-hover-doc b": { color: "var(--color-primary)", fontWeight: "600" },
    ".cm-hover-doc .sig": { color: "var(--color-outline)", marginLeft: "6px" },
    ".cm-hover-doc p": { marginTop: "4px", color: "var(--color-on-surface-variant)", fontFamily: "var(--font-sans)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--color-secondary)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--color-tertiary)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--color-secondary-fixed)" },
  { tag: [t.lineComment, t.blockComment], color: "var(--color-outline)", fontStyle: "italic" },
  { tag: t.propertyName, color: "var(--color-primary)" },
  { tag: t.function(t.propertyName), color: "var(--color-primary-fixed)" },
  { tag: [t.function(t.variableName), t.definition(t.function(t.variableName))], color: "var(--color-primary-fixed)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--color-on-surface)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--color-on-surface-variant)" },
  { tag: t.invalid, color: "var(--color-error)" },
]);

// Globals that exist inside the QuickJS sandbox, for `JSON.` / `Math.` member completion.
const SANDBOX_SCOPE = Object.fromEntries(SANDBOX_GLOBALS.map((name) => [name, (globalThis as Record<string, unknown>)[name]]));

function problemsOf(state: EditorState): Problems {
  const problems: Problems = { errors: 0, warnings: 0, first: null };
  forEachDiagnostic(state, (d, from) => {
    if (d.severity === "error") problems.errors += 1;
    else problems.warnings += 1;
    if (!problems.first || (d.severity === "error" && problems.errors === 1)) {
      problems.first = { line: state.doc.lineAt(from).number, message: d.message, from };
    }
  });
  return problems;
}

/**
 * CodeMirror editor for pre-request / post-response scripts: JavaScript highlighting, autocompletion for
 * the rq API (with docs), live lint (syntax errors, unknown rq members, sandbox pitfalls) and hover docs.
 */
export function ScriptCodeEditor({ value, onValue, phase, label, placeholder, envNames = [], handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onValue, envNames });
  const [problems, setProblems] = useState<Problems>({ errors: 0, warnings: 0, first: null });

  useEffect(() => {
    latest.current = { onValue, envNames };
  });

  useEffect(() => {
    if (!host.current) return;
    const scriptCompletions = (context: CompletionContext): CompletionResult | null => {
      const result = completeScript(context.state.doc.toString(), syntaxTree(context.state), context.pos, phase, {
        explicit: context.explicit,
        envNames: latest.current.envNames,
      });
      return result && { ...result, validFor: /^[\w$]*$/ };
    };

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorState.tabSize.of(2),
          javascript(),
          javascriptLanguage.data.of({ autocomplete: scriptCompletions }),
          javascriptLanguage.data.of({ autocomplete: scopeCompletionSource(SANDBOX_SCOPE) }),
          linter((v) => lintScript(v.state.doc.toString(), syntaxTree(v.state), phase), { delay: 250 }),
          lintGutter(),
          hoverTooltip((v, pos, side) => {
            const info = hoverScript(v.state.doc.toString(), syntaxTree(v.state), pos, side);
            if (!info) return null;
            return {
              pos: info.from,
              end: info.to,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "cm-hover-doc";
                const title = dom.appendChild(document.createElement("b"));
                title.textContent = info.title;
                const sig = dom.appendChild(document.createElement("span"));
                sig.className = "sig";
                sig.textContent = info.detail;
                dom.appendChild(document.createElement("p")).textContent = info.doc;
                return { dom };
              },
            };
          }),
          syntaxHighlighting(highlight),
          theme,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onValue(update.state.doc.toString());
            const next = problemsOf(update.state);
            setProblems((prev) =>
              prev.errors === next.errors && prev.warnings === next.warnings && prev.first?.message === next.first?.message && prev.first?.line === next.first?.line
                ? prev
                : next,
            );
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once per phase; later `value` changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Outside changes (snippets, reverting a draft) replace the document without losing the editor.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useImperativeHandle(handle, () => ({
    insert: (code: string) => {
      const editor = view.current;
      if (!editor) return;
      const { state } = editor;
      const range = editor.hasFocus ? state.selection.main : EditorSelection.cursor(state.doc.length);
      const before = state.sliceDoc(0, range.from);
      const text = `${before && !before.endsWith("\n") ? "\n" : ""}${code}\n`;
      editor.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: EditorSelection.cursor(range.from + text.length),
        scrollIntoView: true,
      });
      editor.focus();
    },
  }));

  const jumpTo = (from: number) => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ selection: EditorSelection.cursor(from), scrollIntoView: true });
    editor.focus();
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div ref={host} className="flex-1 min-h-0 overflow-hidden" data-testid="script-code-editor" />
      <div
        className="shrink-0 px-space-sm py-0.5 flex items-center gap-space-sm font-label-sm text-label-sm bg-surface-container-low/70 min-w-0"
        data-testid="script-problems"
      >
        {problems.errors + problems.warnings === 0 ? (
          <span className="text-outline flex items-center gap-1">
            <Icon name="check_circle" className="text-body-sm text-primary" /> No problems
          </span>
        ) : (
          <>
            {problems.errors > 0 && (
              <span className="text-error flex items-center gap-1 shrink-0">
                <Icon name="error" className="text-body-sm" />
                {problems.errors} {problems.errors === 1 ? "error" : "errors"}
              </span>
            )}
            {problems.warnings > 0 && (
              <span className="text-tertiary flex items-center gap-1 shrink-0">
                <Icon name="warning" className="text-body-sm" />
                {problems.warnings} {problems.warnings === 1 ? "warning" : "warnings"}
              </span>
            )}
            {problems.first && (
              <button
                type="button"
                onClick={() => jumpTo(problems.first!.from)}
                className="truncate text-on-surface-variant hover:text-on-surface text-left min-w-0"
                title={problems.first.message}
              >
                Line {problems.first.line}: {problems.first.message}
              </button>
            )}
          </>
        )}
        <span className="ml-auto shrink-0 text-outline hidden sm:inline">Ctrl+Space for suggestions</span>
      </div>
    </div>
  );
}
