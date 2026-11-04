"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { requestToNodeDraft, type HttpNodeDraft } from "@/lib/collections/client";
import type { RequestDefinition } from "@/lib/collections/schema";
import { draftToNode } from "@/lib/collections/to-node";
import { ApiError, fetchWorkflow, fetchWorkflowSummaries, saveWorkflow } from "@/lib/workflows/client";
import type { WorkflowSummary } from "@/lib/workflows/schema";
import { GHOST_BUTTON, SELECT } from "./ui";

type Props = { name: string; definition: RequestDefinition; collectionId?: string; folderId: string | null };

/**
 * Appends the current request (including unsaved edits, with its collection/folder auth and headers applied)
 * to a workflow as an HTTP node, then opens the canvas. What can't be carried over is listed up front.
 */
export function AddToFlow({ name, definition, collectionId, folderId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ warnings: string[] } | { error: string } | null>(null);

  const convert = () => requestToNodeDraft({ name, definition, collectionId, folderId });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setError(null);
    if (!next) return;
    setPreview(null);
    fetchWorkflowSummaries()
      .then((list) => {
        setWorkflows(list);
        setSelected((s) => s || list[0]?.id || "");
      })
      .catch((e: Error) => setError(e.message));
    convert()
      .then((d) => setPreview({ warnings: d.warnings }))
      .catch((e: Error) => setPreview({ error: e.message }));
  };

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const draft: HttpNodeDraft = await convert();
      setPreview({ warnings: draft.warnings });
      const attempt = async () => {
        const workflow = await fetchWorkflow(selected);
        await saveWorkflow({ ...workflow, nodes: [...workflow.nodes, draftToNode(draft, workflow)] });
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

  const blocked = preview !== null && "error" in preview;

  return (
    <div className="relative">
      <button type="button" onClick={toggle} title="Add request to visual workflow" className={GHOST_BUTTON} aria-expanded={open}>
        <Icon name="add_to_photos" className="text-primary text-body-md" />
        <span>Add to Flow Canvas</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-80 p-space-sm rounded-lg bg-surface-container-high shadow-2xl flex flex-col gap-space-xs" data-testid="add-to-flow">
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
          {preview === null && <div className="font-body-sm text-body-sm text-outline">Checking the request…</div>}
          {preview && "error" in preview && <div className="font-body-sm text-body-sm text-tertiary">{preview.error}</div>}
          {preview && "warnings" in preview && preview.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 p-space-xs rounded bg-tertiary-container/20 font-body-sm text-body-sm text-tertiary" data-testid="add-to-flow-warnings">
              {preview.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1">
                  <Icon name="warning" className="text-body-sm mt-0.5" /> <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="font-body-sm text-body-sm text-outline">
            The node is placed right of the rightmost node; connect it on the canvas. Enabled params, headers and auth — including those inherited from the folder and collection — are carried over.
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
