"use client";

import { TemplateTextarea } from "./template-field";

type Props = {
  value: string;
  onValue: (value: string) => void;
  placeholder?: string;
  label: string;
};

/** Monospaced textarea with a line-number gutter; the outer box scrolls both together. */
export function CodeEditor({ value, onValue, placeholder, label }: Props) {
  const lines = Math.max(1, value.split("\n").length);
  return (
    <div className="flex-1 flex overflow-auto font-code-block text-code-block leading-relaxed bg-surface-container-lowest">
      <div
        aria-hidden="true"
        className="w-10 shrink-0 py-2 select-none text-right pr-2 text-outline bg-surface-container-lowest/90 font-code-block text-code-block leading-relaxed"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <TemplateTextarea
        aria-label={label}
        value={value}
        onValue={onValue}
        placeholder={placeholder}
        wrap="off"
        rows={lines}
        onKeyDown={(e) => {
          // Tab inserts two spaces instead of leaving the editor.
          if (e.key !== "Tab" || e.shiftKey) return;
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: end } = el;
          onValue(el.value.slice(0, s) + "  " + el.value.slice(end));
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }}
        className="flex-1 min-w-0 py-2 px-3 bg-transparent text-on-surface whitespace-pre resize-none overflow-y-hidden overflow-x-auto focus:outline-none placeholder:text-outline leading-relaxed"
      />
    </div>
  );
}
