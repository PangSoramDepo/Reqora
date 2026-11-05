"use client";

import { useState } from "react";

/**
 * A number box that keeps what you type (so "1" on the way to "15", an empty box, or "0." are fine) and only
 * applies the value once it's a valid number in range. Leaving the box puts it back in range.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  integer = false,
  onCommit,
  className = "",
  id,
  readOnly,
}: {
  readOnly?: boolean;
  className?: string;
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? value : Number(draft);
  const valid = draft === null || (draft.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isInteger(parsed)));
  const range = `${min}–${max}`;

  return (
    <>
      <input
        aria-label={label}
        aria-invalid={!valid}
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step}
        id={id}
        readOnly={readOnly}
        className={`${className} ${valid ? "" : "ring-1 ring-error"}`}
        value={draft ?? String(value)}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = Number(text);
          if (text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) onCommit(n);
        }}
        onBlur={() => {
          if (draft === null) return;
          const n = Number(draft);
          if (draft.trim() !== "" && Number.isFinite(n)) {
            const clamped = Math.min(max, Math.max(min, integer ? Math.round(n) : n));
            if (clamped !== value) onCommit(clamped);
          }
          setDraft(null);
        }}
      />
      {!valid && <span className="font-label-sm text-label-sm text-error">{`Enter ${integer ? "a whole number " : ""}${range}`}</span>}
    </>
  );
}
