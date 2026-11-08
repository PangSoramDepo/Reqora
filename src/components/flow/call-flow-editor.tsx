"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { fetchWorkflowSummaries } from "@/lib/workflows/client";
import type { WorkflowNode, WorkflowSummary } from "@/lib/workflows/schema";
import { TemplateField } from "./template-field";

type CallNode = Extract<WorkflowNode, { type: "call" }>;

const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const FIELD =
  "p-space-xs rounded bg-surface-container-lowest font-mono text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40";
const HINT = "font-body-sm text-body-sm text-outline";

// Flow names for Call Flow cards, fetched once per page for all cards (refreshed after 30 s).
let names: { at: number; promise: Promise<Map<string, string>> } | undefined;
function flowNames() {
  if (!names || Date.now() - names.at > 30_000) {
    const promise = fetchWorkflowSummaries()
      .then((list) => new Map(list.map((f) => [f.id, f.name])))
      .catch(() => new Map<string, string>());
    names = { at: Date.now(), promise };
  }
  return names.promise;
}

/** The name of the flow with this id (undefined while loading or when unknown). */
export function useFlowName(id: string): string | undefined {
  const [found, setFound] = useState<{ id: string; name?: string }>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    void flowNames().then((map) => live && setFound({ id, name: map.get(id) }));
    return () => {
      live = false;
    };
  }, [id]);
  return found?.id === id ? found.name : undefined;
}

/** Picks the flow a Call Flow node runs, and the trigger body it sends. */
export function CallFlowEditor({ node, workflowId, onChange }: { node: CallNode; workflowId?: string; onChange: (n: WorkflowNode) => void }) {
  const [flows, setFlows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchWorkflowSummaries()
      .then((list) => live && setFlows(list))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const target = flows?.find((f) => f.id === node.config.workflowId);
  const missing = flows && node.config.workflowId && !target;
  // A flow can't call itself; others are listed by name.
  const choices = (flows ?? []).filter((f) => f.id !== workflowId).sort((a, b) => a.name.localeCompare(b.name));
  const set = (config: Partial<CallNode["config"]>) => onChange({ ...node, config: { ...node.config, ...config } });

  return (
    <>
      <div className="flex flex-col gap-space-xs">
        <label className={LABEL} htmlFor="call-flow">
          Flow to Call
        </label>
        <select
          id="call-flow"
          className={FIELD}
          value={node.config.workflowId}
          disabled={!flows}
          onChange={(e) => set({ workflowId: e.target.value })}
        >
          <option value="">{flows ? "Choose a flow…" : "Loading flows…"}</option>
          {missing && <option value={node.config.workflowId}>(deleted flow)</option>}
          {choices.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {error && <span className="font-body-sm text-body-sm text-error">Could not load flows: {error}</span>}
        {missing && <span className="font-body-sm text-body-sm text-error">That flow was deleted. Choose another one.</span>}
        {target && (
          <div className="flex items-center justify-between gap-space-xs" data-testid="call-target">
            {target.deployment ? (
              <span className="flex items-center gap-1 font-label-sm text-label-sm text-primary" title="Callers run the deployed version">
                <Icon name="cloud_done" className="text-body-md" />
                Runs live v{target.deployment.version}
                {target.deployment.version !== target.version && <span className="text-tertiary"> · draft v{target.version} not deployed</span>}
              </span>
            ) : (
              <span className="flex items-center gap-1 font-label-sm text-label-sm text-tertiary" title="Never deployed, so callers run its draft">
                <Icon name="edit_note" className="text-body-md" />
                Not deployed: runs its draft
              </span>
            )}
            <Link
              href={`/flow/${target.id}`}
              target="_blank"
              className="shrink-0 flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant hover:text-primary"
              title="Open the called flow in a new tab"
            >
              Open <Icon name="open_in_new" className="text-body-md" />
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-space-xs">
        <label className={LABEL} htmlFor="call-body">
          Trigger Body (JSON template)
        </label>
        <TemplateField
          id="call-body"
          multiline
          mode="json"
          className={`${FIELD} min-h-28 resize-y whitespace-pre leading-relaxed`}
          placeholder="{{trigger.body}}"
          value={node.config.body ?? ""}
          onChange={(body) => set({ body: body === "" ? undefined : body })}
        />
        <span className={HINT}>
          The called flow reads it as <span className="text-tertiary">{"{{trigger.body.*}}"}</span>. Empty sends this run&apos;s trigger body.
        </span>
      </div>

      <span className={HINT}>
        Waits for the flow to finish; its Response body is <span className="text-tertiary">{`{{${node.id}.body.*}}`}</span> and its status{" "}
        <span className="text-tertiary">{`{{${node.id}.status}}`}</span>. If it fails, this step fails.
      </span>
    </>
  );
}
