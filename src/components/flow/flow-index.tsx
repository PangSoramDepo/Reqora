"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { createWorkflow, fetchWorkflowSummaries } from "@/lib/workflows/client";
import { blankWorkflow } from "@/lib/workflows/templates";

/** /flow: open the most recently edited workflow, or offer to create the first one. */
export function FlowIndex() {
  const router = useRouter();
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkflowSummaries()
      .then((workflows) => (workflows[0] ? router.replace(`/flow/${workflows[0].id}`) : setEmpty(true)))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  const create = () =>
    createWorkflow(blankWorkflow("Untitled Workflow"))
      .then((wf) => router.push(`/flow/${wf.id}`))
      .catch((e: Error) => setError(e.message));

  return (
    <div className="h-[calc(100vh-3.5rem-2.5rem)] flex flex-col items-center justify-center gap-space-md text-outline font-body-md">
      {error && <span className="text-error">{error}</span>}
      {!empty && !error && (
        <span className="flex items-center gap-space-xs">
          <Icon name="progress_activity" className="animate-spin text-body-lg" /> Opening your latest workflow…
        </span>
      )}
      {empty && (
        <>
          <span className="text-on-surface font-headline-sm text-headline-sm">No workflows yet</span>
          <button
            className="flex items-center gap-space-xs px-space-md py-space-xs bg-primary text-on-primary rounded-xl font-body-sm text-body-sm font-semibold hover:bg-primary-container"
            type="button"
            onClick={create}
          >
            <Icon name="add" className="text-body-md" /> Create workflow
          </button>
        </>
      )}
    </div>
  );
}
