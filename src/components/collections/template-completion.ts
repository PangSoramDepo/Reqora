import { autocompletion, startCompletion, type CompletionSource } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { openPlaceholder, suggest, type SuggestData } from "@/lib/workflows/template-suggest";

/** `{{` suggestions for CodeMirror, from the same data as the plain template fields. */
function templateSource(get: () => SuggestData | null): CompletionSource {
  return (ctx) => {
    const data = get();
    if (!data) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const open = openPlaceholder(before, before.length);
    if (!open) return null;
    const items = suggest(open.query, data);
    if (!items.length) return null;
    return {
      from: line.from + open.start + 2,
      filter: false,
      options: items.map((s) => ({
        label: s.label,
        detail: s.detail,
        type: s.complete ? "variable" : "namespace",
        apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
          const close = s.complete && view.state.sliceDoc(to, to + 2) !== "}}" ? "}}" : "";
          const insert = s.insert + close;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
          // An object or list: keep going with its fields.
          if (!s.complete) setTimeout(() => startCompletion(view), 0);
        },
      })),
    };
  };
}

/**
 * Extensions adding `{{` autocomplete to an editor: suggestions open on `{{`, `.` and `[` inside a placeholder
 * (CodeMirror only opens by itself on word characters) and on Ctrl+Space.
 */
export function templateCompletion(get: () => SuggestData | null) {
  return [
    autocompletion({ override: [templateSource(get)], icons: false }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || !get()) return;
      let typed = "";
      for (const tr of update.transactions) tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => (typed += inserted.toString()));
      if (!/[{.[]$/.test(typed)) return;
      const pos = update.state.selection.main.head;
      const line = update.state.doc.lineAt(pos);
      const before = update.state.sliceDoc(line.from, pos);
      if (openPlaceholder(before, before.length)) startCompletion(update.view);
    }),
  ];
}
