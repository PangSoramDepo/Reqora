"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

const KEY = (workflowId: string) => `reqora:test-payload:${workflowId}`;

/** The payload saved for this workflow's test runs (this browser), or undefined. */
export function readSavedPayload(workflowId: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : localStorage.getItem(KEY(workflowId));
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function writeSavedPayload(workflowId: string, payload: unknown) {
  try {
    if (payload === undefined) localStorage.removeItem(KEY(workflowId));
    else localStorage.setItem(KEY(workflowId), JSON.stringify(payload));
  } catch {
    // Storage unavailable: the payload still applies until reload.
  }
}

type Props = {
  workflowId: string;
  /** The payload test runs use now. */
  current: unknown;
  saved: boolean;
  lastRunPayload: unknown;
  samplePayload: unknown;
  onChange: (payload: unknown) => void;
  onClose: () => void;
};

/** Edits the JSON body that Emit Webhook Test (and the Load Test default) sends as {{trigger.body}}. */
export function TestPayloadEditor({ workflowId, current, saved, lastRunPayload, samplePayload, onChange, onClose }: Props) {
  const [text, setText] = useState(() => JSON.stringify(current ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    let value: unknown;
    try {
      value = text.trim() === "" ? {} : JSON.parse(text);
    } catch (e) {
      setError(`Not valid JSON: ${(e as Error).message}`);
      return;
    }
    writeSavedPayload(workflowId, value);
    onChange(value);
    onClose();
  };

  const reset = () => {
    writeSavedPayload(workflowId, undefined);
    onChange(undefined);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Test payload"
      className="absolute top-full right-0 mt-space-xs w-[420px] z-40 rounded-xl bg-surface-container-high shadow-2xl p-space-sm flex flex-col gap-space-xs"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-label-md text-label-md text-on-surface font-semibold">Test payload</span>
        <button type="button" onClick={onClose} className="p-0.5 rounded text-on-surface-variant hover:text-on-surface" title="Close">
          <Icon name="close" className="text-body-md" />
        </button>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        The JSON body Emit Webhook Test sends, available to nodes as <span className="font-mono text-tertiary">{"{{trigger.body.…}}"}</span>.{" "}
        {saved ? "Saved for this workflow in this browser." : "Not saved yet: test runs reuse the last run's payload."}
      </p>
      <textarea
        aria-label="Test payload JSON"
        autoFocus
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        className="w-full h-48 resize-y rounded bg-surface-container-lowest p-space-xs font-mono text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      {error && (
        <span className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </span>
      )}
      <div className="flex items-center gap-space-xs flex-wrap">
        <button
          type="button"
          onClick={() => setText(JSON.stringify(lastRunPayload ?? {}, null, 2))}
          disabled={lastRunPayload === undefined}
          className="px-space-xs py-1 rounded bg-surface-container-highest text-on-surface font-label-sm text-label-sm disabled:opacity-40"
        >
          Last run&apos;s payload
        </button>
        <button
          type="button"
          onClick={() => setText(JSON.stringify(samplePayload, null, 2))}
          className="px-space-xs py-1 rounded bg-surface-container-highest text-on-surface font-label-sm text-label-sm"
        >
          Sample order
        </button>
        <span className="flex-1" />
        {saved && (
          <button type="button" onClick={reset} className="px-space-xs py-1 rounded text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm">
            Forget saved
          </button>
        )}
        <button
          type="button"
          onClick={save}
          className="px-space-sm py-1 rounded bg-primary text-on-primary font-label-md text-label-md font-semibold"
          title="Save (Ctrl+Enter)"
        >
          Save
        </button>
      </div>
    </div>
  );
}
