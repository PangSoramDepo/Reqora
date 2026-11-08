"use client";

import { useRef, useState } from "react";
import { preview } from "@/lib/workflows/template-suggest";
import { useSuggestMenu } from "./suggest-menu";
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

/**
 * A text field for templates: typing `{{` (or Ctrl+Space) lists what the node can read — the trigger, earlier
 * nodes with the fields of their last run, environment variables — and walks into objects and lists as you go.
 * Below it, the value the template resolves to with the last run. Picking data in the inspector's data panel
 * inserts at the caret of the field that had focus last.
 */
export function TemplateField({ value, onChange, mode = "string", multiline, className, readOnly, ...rest }: Props) {
  const data = useTemplateData();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const menu = useSuggestMenu({ ref, value, onChange, data, disabled: readOnly });

  // Registered when the field gets focus and called later (from the data panel), so it reads the field's text
  // and caret from the element rather than from this render.
  const insertAtCaret = (text: string) => {
    const el = ref.current;
    // Gone (another node was selected) or turned read-only.
    if (!el || !el.isConnected || el.readOnly) return false;
    const current = el.value;
    const at = el.selectionStart ?? current.length;
    onChange(current.slice(0, at) + text + current.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + text.length, at + text.length);
    });
    return true;
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
    "aria-expanded": menu.open,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      menu.onInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
      // Keep the registered inserter on this render's onChange (the node may have changed since focus).
      data?.setTarget(insertAtCaret);
    },
    onKeyDown: menu.onKeyDown,
    onKeyUp: menu.onKeyUp,
    onFocus: () => {
      setFocused(true);
      data?.setTarget(readOnly ? null : insertAtCaret);
    },
    onBlur: () => {
      setFocused(false);
      menu.onBlur();
    },
  };

  const shown = data?.hasRun && !readOnly ? preview(value, data.sources, mode) : null;

  return (
    <div className="relative flex flex-col gap-0.5 min-w-0 flex-1">
      {multiline ? <textarea {...shared} /> : <input type="text" {...shared} />}
      {menu.popup}
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
