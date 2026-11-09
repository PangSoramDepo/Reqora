"use client";

import { createContext, useContext, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { openPlaceholder, suggest, type SuggestData, type Suggestion } from "@/lib/workflows/template-suggest";

const Context = createContext<SuggestData | null>(null);

/** What `{{` suggests in fields below (e.g. Collections: env and script variables). */
export function SuggestDataProvider({ value, children }: { value: SuggestData; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Suggestion data from the nearest SuggestDataProvider (null when there's none). */
export const useSuggestData = () => useContext(Context);

type Field = HTMLInputElement | HTMLTextAreaElement;
type Menu = { start: number; caret: number; items: Suggestion[]; index: number; rect: { left: number; top: number; width: number } };

/**
 * `{{` autocomplete for a plain input or textarea: call `onInput` after each change, spread `onKeyDown`, `onKeyUp`
 * and `onBlur` onto the field, and render `popup`. The list opens below the field (in a portal, so table cells and
 * scrolling panels don't clip it) and walks into objects and lists as suggestions are picked.
 */
export function useSuggestMenu({
  ref,
  value,
  onChange,
  data,
  disabled,
}: {
  ref: RefObject<Field | null>;
  value: string;
  onChange: (value: string) => void;
  data: SuggestData | null;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);

  const place = (caret: number) =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });

  const refresh = (text: string, caret: number) => {
    if (!data || disabled) return;
    const open = openPlaceholder(text, caret);
    const el = ref.current;
    if (!open || !el) return setMenu(null);
    const items = suggest(open.query, data);
    const r = el.getBoundingClientRect();
    setMenu(items.length ? { start: open.start, caret, items, index: 0, rect: { left: r.left, top: r.bottom + 4, width: Math.max(r.width, 280) } } : null);
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
    else requestAnimationFrame(() => refresh(next, caret));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || !data) return;
    if (e.key === " " && e.ctrlKey) {
      // Ctrl+Space: suggestions here, starting a placeholder when not inside one.
      e.preventDefault();
      const caret = ref.current?.selectionStart ?? value.length;
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

  const onKeyUp = (e: React.KeyboardEvent<Field>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
    }
  };

  const popup =
    menu &&
    createPortal(
      <ul
        role="listbox"
        aria-label="Template suggestions"
        data-testid="template-suggestions"
        style={{ left: menu.rect.left, top: menu.rect.top, width: menu.rect.width }}
        className="fixed z-[200] max-h-60 overflow-y-auto rounded-lg bg-surface-container-highest shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] border border-outline-variant/30 py-1"
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
        <li className="px-space-sm pt-1 font-label-sm text-label-sm text-outline border-t border-outline-variant/20 mt-1">↑↓ choose · Enter insert · Esc close</li>
      </ul>,
      document.body,
    );

  return {
    open: menu !== null,
    /** Call after the text changed (typing), with the field's new value and caret. */
    onInput: (text: string, caret: number) => refresh(text, caret),
    onKeyDown,
    onKeyUp,
    onBlur: () => setMenu(null),
    popup,
  };
}

/** Suggestion data for Collections: environment variables, names the scripts set, and dynamic values. */
export function collectionsSuggestData(env: string[], scriptVars: { vars: string[]; env: string[] }, user: string[] = []): SuggestData {
  return {
    env: [...new Set([...env, ...scriptVars.env])].sort(),
    user,
    sources: scriptVars.vars.length
      ? [
          {
            root: "vars",
            label: "variables set by scripts",
            type: "vars",
            value: Object.fromEntries(scriptVars.vars.map((n) => [n, "set by a script"])),
            ran: true,
          },
        ]
      : [],
  };
}
