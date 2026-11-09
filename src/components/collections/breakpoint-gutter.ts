import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";

/** CodeMirror pieces for script debugging: a breakpoint gutter (click to toggle) and debugger line highlights. */

const setLines = StateEffect.define<number[]>();

class Dot extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bp-dot";
    return dot;
  }
}
const dot = new Dot();

const breakpoints = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLines)) continue;
      const doc = tr.state.doc;
      next = RangeSet.of(
        e.value.filter((l) => l >= 1 && l <= doc.lines).map((l) => dot.range(doc.line(l).from)),
        true,
      );
    }
    return next;
  },
});

/** Breakpoint lines in the editor now (they move with edits). */
export function breakpointLines(state: EditorState): number[] {
  const lines = new Set<number>();
  for (let it = state.field(breakpoints).iter(); it.value; it.next()) lines.add(state.doc.lineAt(it.from).number);
  return [...lines].sort((a, b) => a - b);
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/** Shows `lines` as breakpoints (from the shared store) unless the editor already does. */
export function syncBreakpoints(view: EditorView, lines: number[]) {
  if (!same(breakpointLines(view.state), lines)) view.dispatch({ effects: setLines.of(lines) });
}

/**
 * A gutter left of the line numbers: click toggles a breakpoint (`onToggle` gets the line); `onMove` gets the new
 * lines when editing moves them.
 */
export function breakpointGutter(onToggle: (line: number) => void, onMove?: (lines: number[]) => void): Extension {
  return [
    breakpoints,
    gutter({
      class: "cm-bp-gutter",
      markers: (v) => v.state.field(breakpoints),
      initialSpacer: () => dot,
      // Every line gets a cell, so an empty one shows a faint dot on hover.
      renderEmptyElements: true,
      domEventHandlers: {
        mousedown(view, block) {
          onToggle(view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
    onMove
      ? EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const before = breakpointLines(u.startState);
          const after = breakpointLines(u.state);
          if (!same(before, after)) onMove(after);
        })
      : [],
    EditorView.baseTheme({
      ".cm-bp-gutter .cm-gutterElement": { width: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
      ".cm-bp-dot": { width: "9px", height: "9px", borderRadius: "50%", backgroundColor: "var(--color-error)", display: "inline-block" },
      ".cm-bp-gutter .cm-gutterElement:empty:hover::after": {
        content: '""',
        width: "9px",
        height: "9px",
        borderRadius: "50%",
        backgroundColor: "color-mix(in srgb, var(--color-error) 35%, transparent)",
      },
    }),
  ];
}

/** Debugger highlights: the line of the current step, and the line that threw. */
const setDebugLines = StateEffect.define<{ current: number | null; error: number | null }>();
const debugLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDebugLines)) continue;
      const doc = tr.state.doc;
      const marks = [];
      const { current, error } = e.value;
      if (error && error <= doc.lines && error !== current) marks.push(Decoration.line({ class: "cm-dbg-error" }).range(doc.line(error).from));
      if (current && current <= doc.lines) {
        marks.push(Decoration.line({ class: current === error ? "cm-dbg-current cm-dbg-error" : "cm-dbg-current" }).range(doc.line(current).from));
      }
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const debugHighlights: Extension = [
  debugLines,
  EditorView.baseTheme({
    ".cm-dbg-current": { backgroundColor: "color-mix(in srgb, var(--color-primary) 22%, transparent) !important", boxShadow: "inset 3px 0 0 var(--color-primary)" },
    ".cm-dbg-error": { backgroundColor: "color-mix(in srgb, var(--color-error) 20%, transparent)" },
    ".cm-dbg-current.cm-dbg-error": {
      backgroundColor: "color-mix(in srgb, var(--color-error) 24%, transparent) !important",
      boxShadow: "inset 3px 0 0 var(--color-error)",
    },
  }),
];

/** Highlights the current step's line (scrolled into view) and the error line. */
export function showDebugLines(view: EditorView, current: number | null, error: number | null) {
  const doc = view.state.doc;
  view.dispatch({
    effects: [
      setDebugLines.of({ current, error }),
      ...(current && current <= doc.lines ? [EditorView.scrollIntoView(doc.line(current).from, { y: "nearest", yMargin: 40 })] : []),
    ],
  });
}
