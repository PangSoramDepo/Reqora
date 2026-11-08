"use client";

import { useRef, useState } from "react";
import { openPlaceholder, preview, suggest, type Suggestion } from "@/lib/workflows/template-suggest";
import { useTemplateData } from "./template-data";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** How the value is used, for the preview: "string" (URL, text), "json" (a body), "value" (compared or mapped). */
  mode?: "string" | "json" | "value";
  multiline?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  onClick?: () => void;
  title?: string;
};

type Menu = { start: number; caret: number; items: Suggestion[]; index: number };

/**
 * A text field for templates: typing `{{` (or Ctrl+Space) lists what the node can read — the trigger, earlier
 * nodes with the fields of their last run, environment variables — and walks into objects and lists as you go.
 * Below it, the value the template resolves to with the last run. Picking data in the inspector's data panel
 * inserts at the caret of the field that had focus last.
 */
export function TemplateField({ value, onChange, mode = "string", multiline, className, readOnly, ...rest }: Props) {
  const data = useTemplateData();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [focused, setFocused] = useState(false);

  const place = (caret: number) =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });

  /** Opens, updates or closes the list for the text and caret. */
  const refresh = (text: string, caret: number) => {
    if (!data || readOnly) return;
    const open = openPlaceholder(text, caret);
    if (!open) return setMenu(null);
    const items = suggest(open.query, data);
    setMenu(items.length ? { start: open.start, caret, items, index: 0 } : null);
  };

  const accept = (s: Suggestion) => {
    if (!menu) return;
    const after = value.slice(menu.caret);
    const close = s.complete && !after.trimStart().startsWith("}}") ? "}}" : "";
    const next = `${value.slice(0, menu.start)}{{${s.insert}${close}${after}`;
    const caret = menu.start + 2 + s.insert.length + close.length;
    onChange(next);
    place(caret);
    if (s.complete) setMenu(null);
    else refresh(next, caret);
  };

  // Registered when the field gets focus and called later (from the data panel), so it reads the field's text
  // and caret from the element rather than from this render.
  const insertAtCaret = (text: string) => {
    const el = ref.current;
    // Gone (another node was selected) or turned read-only.
    if (!el || !el.isConnected || el.readOnly) return false;
    const current = el.value;
    const at = el.selectionStart ?? current.length;
    onChange(current.slice(0, at) + text + current.slice(el.selectionEnd ?? at));
    place(at + text.length);
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly || !data) return;
    if (e.key === " " && e.ctrlKey) {
      // Ctrl+Space: suggestions here, starting a placeholder when not inside one.
      e.preventDefault();
      const el = ref.current!;
      const caret = el.selectionStart ?? value.length;
      if (openPlaceholder(value, caret)) refresh(value, caret);
      else {
        const next = `${value.slice(0, caret)}{{${value.slice(caret)}`;
        onChange(next);
        place(caret + 2);
        requestAnimationFrame(() => refresh(next, caret + 2));
      }
      return;
    }
    if (!menu) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setMenu({ ...menu, index: (menu.index + step + menu.items.length) % menu.items.length });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(menu.items[menu.index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    }
  };

  const shared = {
    ...rest,
    ref,
    value,
    readOnly,
    spellCheck: false,
    autoComplete: "off",
    className,
    "aria-autocomplete": "list" as const,
    "aria-expanded": !!menu,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      refresh(e.target.value, e.target.selectionStart ?? e.target.value.length);
      // Keep the registered inserter on this render's onChange (the node may have changed since focus).
      data?.setTarget(insertAtCaret);
    },
    onKeyDown,
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
        refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
      }
    },
    onFocus: () => {
      setFocused(true);
      data?.setTarget(readOnly ? null : insertAtCaret);
    },
    onBlur: () => {
      setFocused(false);
      setMenu(null);
    },
  };

  const shown = data?.hasRun && !readOnly ? preview(value, data.sources, mode) : null;

  return (
    <div className="relative flex flex-col gap-0.5 min-w-0 flex-1">
      {multiline ? <textarea {...shared} /> : <input type="text" {...shared} />}
      {menu && (
        <ul
          role="listbox"
          aria-label="Template suggestions"
          data-testid="template-suggestions"
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-60 overflow-y-auto rounded-lg bg-surface-container-highest shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] border border-outline-variant/30 py-1"
        >
          {menu.items.map((s, i) => (
            <li
              key={s.insert}
              role="option"
              aria-selected={i === menu.index}
              className={`px-space-sm py-1 flex items-center gap-space-xs cursor-pointer font-mono text-[11px] ${
                i === menu.index ? "bg-primary/15 text-on-surface" : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
              // Keep focus (and the caret) in the field.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              onMouseEnter={() => setMenu({ ...menu, index: i })}
            >
              <span className={`truncate ${s.complete ? "text-tertiary" : "text-primary"}`}>{s.label}</span>
              <span className="ml-auto shrink-0 max-w-[55%] truncate text-outline">{s.detail}</span>
            </li>
          ))}
          <li className="px-space-sm pt-1 font-label-sm text-label-sm text-outline border-t border-outline-variant/20 mt-1">
            ↑↓ choose · Enter insert · Esc close
          </li>
        </ul>
      )}
      {shown && (focused || shown.kind !== "value") && (
        <span
          data-testid="template-preview"
          className={`font-mono text-[10px] leading-tight truncate ${
            shown.kind === "error" ? "text-error" : shown.kind === "pending" ? "text-outline" : "text-on-surface-variant"
          }`}
          title={shown.text}
        >
          {shown.kind === "value" ? `= ${shown.text}` : shown.text}
        </span>
      )}
    </div>
  );
}
