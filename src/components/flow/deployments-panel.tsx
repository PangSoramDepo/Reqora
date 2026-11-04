"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { fetchDeployment, fetchDeployments } from "@/lib/workflows/client";
import type { DeploymentDetail, DeploymentRecord, Workflow, WorkflowNode } from "@/lib/workflows/schema";

type Props = {
  workflow: Workflow;
  /** Bumped by the parent after a deploy, so the list reloads. */
  refreshKey: number;
  onRollback: (deployment: DeploymentRecord) => Promise<void>;
  onRestore: (deployment: DeploymentRecord) => Promise<void>;
  onClose: () => void;
};

type Diff = { added: string[]; removed: string[]; changed: string[]; edges: number };

/** What the current draft changes compared with a deployment (positions ignored). */
function diffAgainstDraft(deployed: Pick<Workflow, "nodes" | "edges">, draft: Pick<Workflow, "nodes" | "edges">): Diff {
  const strip = (n: WorkflowNode) => JSON.stringify({ ...n, position: undefined });
  const before = new Map(deployed.nodes.map((n) => [n.id, n]));
  const after = new Map(draft.nodes.map((n) => [n.id, n]));
  const edgeKey = (e: Workflow["edges"][number]) => `${e.source}.${e.sourcePort}>${e.target}`;
  const beforeEdges = new Set(deployed.edges.map(edgeKey));
  const afterEdges = new Set(draft.edges.map(edgeKey));
  return {
    added: draft.nodes.filter((n) => !before.has(n.id)).map((n) => n.name),
    removed: deployed.nodes.filter((n) => !after.has(n.id)).map((n) => n.name),
    changed: draft.nodes.filter((n) => before.has(n.id) && strip(before.get(n.id)!) !== strip(n)).map((n) => n.name),
    edges: [...afterEdges].filter((e) => !beforeEdges.has(e)).length + [...beforeEdges].filter((e) => !afterEdges.has(e)).length,
  };
}

function when(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function DiffSummary({ diff }: { diff: Diff }) {
  const none = !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.edges;
  if (none) return <span className="text-outline">Same as the current draft.</span>;
  const part = (label: string, names: string[], className: string) =>
    names.length > 0 && (
      <div>
        <span className={className}>{label}:</span> <span className="text-on-surface">{names.join(", ")}</span>
      </div>
    );
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-outline">The current draft differs from this version:</span>
      {part("Added", diff.added, "text-primary")}
      {part("Removed", diff.removed, "text-error")}
      {part("Changed", diff.changed, "text-tertiary")}
      {diff.edges > 0 && <div className="text-on-surface-variant">{diff.edges} connection change{diff.edges === 1 ? "" : "s"}</div>}
    </div>
  );
}

/**
 * Deployment history of the workflow: what the webhook runs now, and every earlier deploy, with rollback (make an
 * old version live again) and restore (copy it onto the canvas as the draft).
 */
export function DeploymentsPanel({ workflow, refreshKey, onRollback, onRestore, onClose }: Props) {
  const [list, setList] = useState<DeploymentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeploymentDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchDeployments(workflow.id)
      .then((data) => {
        if (cancelled) return;
        setList(data);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [workflow.id, refreshKey, reload]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchDeployment(workflow.id, open)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [workflow.id, open]);

  const act = async (kind: "rollback" | "restore", d: DeploymentRecord) => {
    const question =
      kind === "rollback"
        ? `Make v${d.version} (deployed ${new Date(d.deployedAt).toLocaleString()}) live again? The webhook will run it from now on. Your draft is not changed.`
        : `Replace the draft on the canvas with v${d.version}? The current draft (v${workflow.version}) is overwritten${
            workflow.deployment ? "" : " and it has never been deployed"
          }. The live deployment is not changed.`;
    if (!window.confirm(question)) return;
    setBusy(`${kind}:${d.id}`);
    setError(null);
    try {
      await (kind === "rollback" ? onRollback(d) : onRestore(d));
      setReload((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shownDetail = detail && detail.id === open ? detail : null;

  return (
    <aside
      className="absolute right-0 top-0 h-full w-[460px] max-w-full z-50 bg-surface-container-low/97 backdrop-blur-xl shadow-2xl flex flex-col"
      aria-label="Deployments"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="h-14 shrink-0 px-space-md flex items-center justify-between bg-surface-container-lowest/70">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="history" className="text-primary text-headline-sm" />
          <div className="flex flex-col min-w-0">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold leading-tight">Deployments</span>
            <span className="font-label-sm text-label-sm text-outline truncate">{workflow.name}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded text-on-surface-variant hover:text-on-surface" title="Close">
          <Icon name="close" className="text-body-lg" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-sm">
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          The webhook <span className="font-mono text-on-surface">POST /api/hooks/{workflow.id}</span> runs the{" "}
          <span className="text-primary font-semibold">LIVE</span> deployment. Canvas runs and load tests use the draft (v{workflow.version}).
        </p>
        {error && (
          <div className="font-body-sm text-body-sm text-error flex items-start gap-1" role="alert">
            <Icon name="error" className="text-body-md" /> {error}
          </div>
        )}
        {list === null && !error && (
          <div className="flex items-center gap-space-xs text-outline font-body-sm text-body-sm">
            <Icon name="progress_activity" className="animate-spin" /> Loading…
          </div>
        )}
        {list?.length === 0 && (
          <div className="font-body-sm text-body-sm text-outline">Not deployed yet. Use Deploy in the top bar to make the draft live.</div>
        )}
        <ol className="flex flex-col gap-space-xs" data-testid="deployments">
          {list?.map((d) => {
            const expanded = open === d.id;
            return (
              <li key={d.id} className={`rounded-lg ${d.live ? "bg-surface-container-high ring-1 ring-primary/40" : "bg-surface-container"}`}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : d.id)}
                  className="w-full flex items-center gap-space-xs p-space-sm text-left"
                >
                  <Icon name={expanded ? "expand_more" : "chevron_right"} className="text-outline text-body-md" />
                  <span className="font-mono font-semibold text-on-surface">v{d.version}</span>
                  {d.live && (
                    <span className="px-space-xs py-0.5 rounded bg-primary/20 text-primary font-label-sm text-label-sm font-bold">LIVE</span>
                  )}
                  {d.rollbackOf && (
                    <span className="px-space-xs py-0.5 rounded bg-tertiary/15 text-tertiary font-label-sm text-label-sm" title="Re-deployed from history">
                      rollback
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="font-label-sm text-label-sm text-outline text-right" title={new Date(d.deployedAt).toLocaleString()}>
                    {when(d.deployedAt)}
                    {d.deployedBy ? ` · ${d.deployedBy.name}` : ""}
                  </span>
                </button>
                {expanded && (
                  <div className="px-space-sm pb-space-sm flex flex-col gap-space-xs font-body-sm text-body-sm">
                    <div className="text-on-surface-variant">
                      {new Date(d.deployedAt).toLocaleString()} · {d.nodeCount} nodes · {d.edgeCount} connections
                    </div>
                    {shownDetail ? <DiffSummary diff={diffAgainstDraft(shownDetail, workflow)} /> : <span className="text-outline">Comparing…</span>}
                    <div className="flex gap-space-xs pt-space-xxs">
                      {!d.live && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => act("rollback", d)}
                          className="flex items-center gap-1 px-space-sm py-1 rounded bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50"
                        >
                          <Icon
                            name={busy === `rollback:${d.id}` ? "progress_activity" : "settings_backup_restore"}
                            className={`text-body-sm ${busy === `rollback:${d.id}` ? "animate-spin" : ""}`}
                          />
                          Roll back to v{d.version}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => act("restore", d)}
                        title="Copy this version onto the canvas as the draft, to edit it"
                        className="flex items-center gap-1 px-space-sm py-1 rounded bg-surface-container-highest text-on-surface font-label-md text-label-md disabled:opacity-50"
                      >
                        <Icon
                          name={busy === `restore:${d.id}` ? "progress_activity" : "edit_note"}
                          className={`text-body-sm ${busy === `restore:${d.id}` ? "animate-spin" : ""}`}
                        />
                        Restore to draft
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
