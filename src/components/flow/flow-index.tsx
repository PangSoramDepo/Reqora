"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { createWorkflow, fetchWorkflowSummaries } from "@/lib/workflows/client";
import { STARTERS, type Starter } from "@/lib/workflows/templates";

/** /flow: open the most recently edited workflow, or help create the first one from a starter. */
export function FlowIndex() {
  const router = useRouter();
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkflowSummaries()
      .then((workflows) => (workflows[0] ? router.replace(`/flow/${workflows[0].id}`) : setEmpty(true)))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  const create = (starter: Starter) => {
    setCreating(starter.id);
    createWorkflow(starter.build(starter.id === "blank" ? "Untitled Workflow" : starter.title))
      .then((wf) => router.push(`/flow/${wf.id}`))
      .catch((e: Error) => {
        setError(e.message);
        setCreating(null);
      });
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem-2.5rem)] flex flex-col items-center justify-center gap-space-lg p-gutter-canvas text-outline font-body-md">
      {error && <span className="text-error">{error}</span>}
      {!empty && !error && (
        <span className="flex items-center gap-space-xs">
          <Icon name="progress_activity" className="animate-spin text-body-lg" /> Opening your latest workflow…
        </span>
      )}
      {empty && (
        <>
          <div className="flex flex-col items-center gap-space-xs text-center">
            <span className="h-14 w-14 rounded-2xl bg-primary-container/20 flex items-center justify-center">
              <Icon name="schema" className="text-primary text-headline-lg" />
            </span>
            <h1 className="text-on-surface font-headline-lg text-headline-lg">Build your first flow</h1>
            <p className="max-w-xl font-body-sm text-body-sm text-on-surface-variant">
              A flow starts when its webhook is called, runs its blocks in order, and answers with a response. Pick a starter — each one runs
              right away against Reqora&apos;s demo APIs, so you can see how it works before changing it.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md w-full max-w-4xl" data-testid="starters">
            {STARTERS.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={creating !== null}
                onClick={() => create(s)}
                className="text-left p-space-lg rounded-xl bg-surface-container hover:bg-surface-container-high hover:ring-1 hover:ring-primary/40 transition-all flex flex-col gap-space-sm disabled:opacity-60"
              >
                <span className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon name={creating === s.id ? "progress_activity" : s.icon} className={`text-primary text-headline-md ${creating === s.id ? "animate-spin" : ""}`} />
                </span>
                <span className="font-headline-sm text-headline-sm text-on-surface">{s.title}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">{s.description}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
