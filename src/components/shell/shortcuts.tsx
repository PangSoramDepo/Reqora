"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";

const OPEN_EVENT = "reqora:show-shortcuts";

type Group = { title: string; items: [keys: string[], what: string][] };

/** Every keyboard shortcut and mouse gesture, by where it works. Keep in sync with the handlers. */
const GROUPS: Group[] = [
  {
    title: "Flow Canvas",
    items: [
      [["Ctrl", "Z"], "Undo (moves, auto align, deletes, edits)"],
      [["Ctrl", "Shift", "Z"], "Redo (also Ctrl+Y)"],
      [["Delete"], "Delete the selected node or connection (also Backspace)"],
      [["D"], "Disable / enable the selected node"],
      [["Drag"], "From an output port to an input port to connect nodes"],
      [["Double-click"], "A block in the Node Library adds it to the canvas"],
    ],
  },
  {
    title: "Template fields",
    items: [
      [["{{"], "List the trigger, earlier nodes' fields and variables"],
      [["Ctrl", "Space"], "Show suggestions anywhere in the field"],
      [["↑", "↓"], "Choose a suggestion; Enter or Tab inserts, Esc closes"],
      [["Click"], "A field under “Available data” inserts it where you were typing"],
    ],
  },
  {
    title: "Saved requests (sidebar)",
    items: [
      [["Click"], "Edit the request in a dialog"],
      [["Double-click"], "Add it to the canvas as a linked node (or drag it there)"],
    ],
  },
  {
    title: "Collections & request editor",
    items: [
      [["Ctrl", "S"], "Save the request"],
      [["Alt", "↑"], "Move the focused request or folder up (Alt+↓ down)"],
      [["Drag"], "Onto the top / middle / bottom of a folder: before / into / after it"],
      [["Esc"], "Close a dialog (asks first if there are unsaved edits)"],
    ],
  },
  {
    title: "Anywhere",
    items: [
      [["?"], "Show this list"],
      [["Ctrl", "Enter"], "Save the test payload (in its editor)"],
    ],
  },
];

/** Opens the shortcuts list from anywhere (e.g. a help link). */
export const showShortcuts = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** The keyboard button in the top bar, the "?" key, and the list they open. */
export function ShortcutsButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        onClick={() => setOpen(true)}
      >
        <Icon name="keyboard" className="text-body-lg" />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="shortcuts-title"
              data-testid="shortcuts"
              className="w-[720px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-xl bg-surface-container-high shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] p-space-lg flex flex-col gap-space-md"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 id="shortcuts-title" className="font-headline-md text-headline-md text-on-surface flex items-center gap-space-xs">
                  <Icon name="keyboard" className="text-primary" /> Keyboard shortcuts & gestures
                </h2>
                <button type="button" className="p-1 rounded text-outline hover:text-on-surface" aria-label="Close" onClick={() => setOpen(false)}>
                  <Icon name="close" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-space-xl gap-y-space-md">
                {GROUPS.map((g) => (
                  <section key={g.title} className="flex flex-col gap-space-xs">
                    <h3 className="font-label-md text-label-md text-outline uppercase tracking-wider">{g.title}</h3>
                    {g.items.map(([keys, what]) => (
                      <div key={what} className="flex items-start gap-space-sm">
                        <span className="shrink-0 w-32 flex flex-wrap gap-1">
                          {keys.map((k) => (
                            <kbd key={k} className="px-1.5 py-0.5 rounded bg-surface-container-lowest border border-outline-variant/40 font-mono text-[11px] text-on-surface">
                              {k}
                            </kbd>
                          ))}
                        </span>
                        <span className="font-body-sm text-body-sm text-on-surface-variant">{what}</span>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
              <p className="font-body-sm text-body-sm text-outline">On a Mac, use ⌘ instead of Ctrl.</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
