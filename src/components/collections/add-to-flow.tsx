"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import type { RequestDefinition } from "@/lib/collections/schema";
import { requestToNode } from "@/lib/collections/to-node";
import { ApiError, fetchWorkflow, fetchWorkflowSummaries, saveWorkflow } from "@/lib/workflows/client";
import type { WorkflowSummary } from "@/lib/workflows/schema";
import { GHOST_BUTTON, SELECT } from "./ui";

/** Appends the current request (including unsaved edits) to a workflow as an HTTP node, then opens the canvas. */
export function AddToFlow({ name, definition }: { name: string; definition: RequestDefinition }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setError(null);
    if (next) {
      fetchWorkflowSummaries()
        .then((list) => {
          setWorkflows(list);
          setSelected((s) => s || list[0]?.id || "");
        })
        .catch((e: Error) => setError(e.message));
    }
  };

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = async () => {
        const workflow = await fetchWorkflow(selected);
        const converted = requestToNode(name, definition, workflow);
        if (!converted.ok) throw new Error(converted.error);
        await saveWorkflow({ ...workflow, nodes: [...workflow.nodes, converted.node] });
      };
      try {
        await attempt();
      } catch (e) {
        // Someone saved the workflow in between: reload it once and retry.
        if (e instanceof ApiError && e.status === 409) await attempt();
        else throw e;
      }
      router.push(`/flow/${selected}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const blocked = definition.method === "HEAD" || definition.method === "OPTIONS";

  return (
    <div className="relative">
      <button type="button" onClick={toggle} title="Add request to visual workflow" className={GHOST_BUTTON} aria-expanded={open}>
        <Icon name="add_to_photos" className="text-primary text-body-md" />
        <span>Add to Flow Canvas</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-80 p-space-sm rounded-lg bg-surface-container-high shadow-2xl flex flex-col gap-space-xs">
          <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Add as HTTP node to</div>
          {workflows === null && !error && <div className="font-body-sm text-body-sm text-on-surface-variant">Loading workflows…</div>}
          {workflows?.length === 0 && <div className="font-body-sm text-body-sm text-on-surface-variant">No workflows yet — create one on the Flow Canvas.</div>}
          {workflows && workflows.length > 0 && (
            <select aria-label="Workflow" className={`${SELECT} py-1.5`} value={selected} onChange={(e) => setSelected(e.target.value)}>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.nodeCount} nodes)
                </option>
              ))}
            </select>
          )}
          {blocked && (
            <div className="font-body-sm text-body-sm text-tertiary">
              Workflow HTTP nodes support GET, POST, PUT, PATCH and DELETE — change the method first.
            </div>
          )}
          <p className="font-body-sm text-body-sm text-outline">
            The node is placed right of the rightmost node; connect it on the canvas. Enabled params, headers and auth are carried over.
          </p>
          {error && <div className="font-body-sm text-body-sm text-error">{error}</div>}
          <div className="flex justify-end gap-space-xs">
            <button type="button" onClick={() => setOpen(false)} className={GHOST_BUTTON}>
              Cancel
            </button>
            <button
              type="button"
              onClick={add}
              disabled={busy || !selected || blocked}
              className="flex items-center gap-1 px-space-sm py-1.5 rounded bg-primary text-on-primary hover:bg-primary-container font-label-sm text-label-sm font-semibold disabled:opacity-50"
            >
              <Icon name={busy ? "progress_activity" : "account_tree"} className={`text-body-md ${busy ? "animate-spin" : ""}`} />
              Add &amp; open canvas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
