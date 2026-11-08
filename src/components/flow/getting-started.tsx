"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { webhookCurl } from "@/lib/workflows/templates";
import type { Environment } from "@/lib/workflows/schema";

/** Set once the guide is dismissed: it then stays hidden on every flow in this browser. */
const DISMISSED_KEY = "reqora:guide-dismissed";
const copiedKey = (workflowId: string) => `reqora:guide-copied:${workflowId}`;

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const remember = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable: the guide just shows again next time.
  }
};

type Props = {
  workflowId: string;
  hasRun: boolean;
  deployed: boolean;
  running: boolean;
  deploying: boolean;
  environment: Environment;
  testPayload: unknown;
  onEditPayload: () => void;
  onRun: () => void;
  onDeploy: () => void;
};

/**
 * Three steps from a new flow to calling it: run it with a test payload, deploy it, call the webhook. Each
 * step has its button; done steps are ticked. Hidden when all are done or once dismissed.
 */
export function GettingStarted(props: Props) {
  const { workflowId, hasRun, deployed, running, deploying, environment, testPayload } = props;
  const [dismissed, setDismissed] = useState(() => read(DISMISSED_KEY));
  const [copied, setCopied] = useState(() => read(copiedKey(workflowId)));
  const [justCopied, setJustCopied] = useState(false);

  if (dismissed || (hasRun && deployed && copied)) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(webhookCurl(window.location.origin, workflowId, environment, testPayload)).catch(() => undefined);
    remember(copiedKey(workflowId));
    setCopied(true);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
  };

  const steps: { done: boolean; title: string; detail: string; action: React.ReactNode }[] = [
    {
      done: hasRun,
      title: "Run it with a test payload",
      detail: "Runs the draft. Click a node afterwards to see what it sent and received.",
      action: (
        <>
          <button type="button" className={SECONDARY} onClick={props.onEditPayload}>
            Edit payload
          </button>
          <button type="button" className={PRIMARY} disabled={running} onClick={props.onRun}>
            {running ? "Running…" : "Run"}
          </button>
        </>
      ),
    },
    {
      done: deployed,
      title: "Deploy it",
      detail: "Makes this version live on its webhook. Later edits stay in the draft until you deploy again.",
      action: (
        <button type="button" className={PRIMARY} disabled={deploying} onClick={props.onDeploy}>
          {deploying ? "Deploying…" : "Deploy"}
        </button>
      ),
    },
    {
      done: copied,
      title: "Call it from your app",
      detail: "POST JSON to its webhook URL; the Response node's body comes back.",
      action: (
        <button type="button" className={PRIMARY} onClick={copy}>
          {justCopied ? "Copied" : "Copy cURL"}
        </button>
      ),
    },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <div
      className="absolute bottom-24 left-space-sm z-20 w-80 rounded-xl bg-surface-container-high/95 backdrop-blur shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] p-space-md flex flex-col gap-space-sm"
      data-testid="getting-started"
    >
      <div className="flex items-center justify-between">
        <span className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
          <Icon name="flag" className="text-primary" /> Getting started
        </span>
        <button
          type="button"
          className="p-1 rounded text-outline hover:text-on-surface"
          title="Hide this guide on every flow"
          aria-label="Hide the getting started guide"
          onClick={() => {
            remember(DISMISSED_KEY);
            setDismissed(true);
          }}
        >
          <Icon name="close" className="text-body-md" />
        </button>
      </div>
      <ol className="flex flex-col gap-space-sm">
        {steps.map((s, i) => (
          <li key={s.title} className={`flex gap-space-sm ${i !== next && !s.done ? "opacity-60" : ""}`}>
            <span
              className={`mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center font-label-sm text-label-sm ${
                s.done ? "bg-primary text-on-primary" : i === next ? "ring-2 ring-primary text-primary" : "ring-1 ring-outline text-outline"
              }`}
            >
              {s.done ? <Icon name="check" className="text-[14px]" /> : i + 1}
            </span>
            <div className="flex flex-col gap-space-xxs min-w-0">
              <span className={`font-body-md text-body-md ${s.done ? "text-outline line-through" : "text-on-surface"}`}>{s.title}</span>
              {!s.done && <span className="font-body-sm text-body-sm text-on-surface-variant">{s.detail}</span>}
              {i === next && <div className="flex items-center gap-space-xs pt-space-xxs">{s.action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PRIMARY = "px-space-sm py-0.5 rounded bg-primary text-on-primary hover:bg-primary-container font-label-md text-label-md font-semibold disabled:opacity-60";
const SECONDARY = "px-space-sm py-0.5 rounded bg-surface-container-highest hover:bg-surface-bright text-on-surface font-label-md text-label-md";
