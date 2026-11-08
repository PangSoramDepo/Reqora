"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import type { Diagnosis, Fix } from "@/lib/workflows/diagnose";

/**
 * A failed step's error in plain words, with buttons for the fixes that apply. Unrecognised errors show as
 * they are; recognised ones keep the original text under "Details".
 */
export function ErrorHelp({ error, diagnosis, onFix }: { error: string; diagnosis: Diagnosis | null; onFix?: (fix: Fix) => void }) {
  const [details, setDetails] = useState(false);
  if (!diagnosis) {
    return <div className="p-space-xs rounded bg-error-container/40 text-on-error-container font-mono text-body-sm break-words">{error}</div>;
  }
  return (
    <div className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-error-container/30 border border-error/30" data-testid="error-help" role="alert">
      <div className="flex items-start gap-space-xs">
        <Icon name="error" className="text-error text-body-lg shrink-0" />
        <span className="font-body-md text-body-md text-on-surface font-semibold">{diagnosis.title}</span>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant break-words">{diagnosis.hint}</p>
      {(diagnosis.fixes.length > 0 || true) && (
        <div className="flex flex-wrap items-center gap-space-xs">
          {onFix &&
            diagnosis.fixes.map(({ label, fix }) => (
              <button
                key={label}
                type="button"
                className="flex items-center gap-1 px-space-sm py-1 rounded bg-primary text-on-primary hover:bg-primary-container font-label-md text-label-md font-semibold"
                onClick={() => onFix(fix)}
              >
                <Icon name={FIX_ICON[fix.kind]} className="text-body-sm" />
                {label}
              </button>
            ))}
          <button
            type="button"
            className="ml-auto font-label-sm text-label-sm text-outline hover:text-on-surface"
            aria-expanded={details}
            onClick={() => setDetails((v) => !v)}
          >
            {details ? "Hide details" : "Details"}
          </button>
        </div>
      )}
      {details && <div className="p-space-xs rounded bg-surface-container-lowest font-mono text-[11px] text-on-surface-variant break-words">{error}</div>}
    </div>
  );
}

const FIX_ICON: Record<Fix["kind"], string> = {
  "add-variable": "add_circle",
  "edit-linked": "edit",
  unlink: "link_off",
  tab: "tune",
  focus: "edit",
  "open-run": "history",
  "open-flow": "open_in_new",
};
