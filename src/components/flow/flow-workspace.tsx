"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { fetchLatestRun, fetchWorkflow, startRun } from "@/lib/workflows/client";
import type { Run, Step, Workflow, WorkflowNode } from "@/lib/workflows/schema";
import { CHECKOUT_WORKFLOW_ID, SAMPLE_ORDER } from "@/lib/workflows/seed";
import { createAutosaver, type SaveState } from "./autosaver";
import { ExecutionStream } from "./execution-stream";
import { FlowCanvas } from "./flow-canvas";
import { NodeInspector } from "./node-inspector";

/** Layered layout: each node sits one column right of its deepest predecessor. */
function autoLayout(workflow: Workflow): WorkflowNode[] {
  const depth = new Map<string, number>();
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    depth.set(id, 0); // guards against cycles; the API rejects them anyway
    const parents = workflow.edges.filter((e) => e.target === id).map((e) => visit(e.source) + 1);
    const d = Math.max(0, ...parents);
    depth.set(id, d);
    return d;
  };
  const rows = new Map<number, number>();
  return workflow.nodes.map((node) => {
    const column = visit(node.id);
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { ...node, position: { x: 50 + column * 420, y: 70 + row * 220 } };
  });
}

export function FlowWorkspace({ workflowId = CHECKOUT_WORKFLOW_ID }: { workflowId?: string }) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | undefined>();
  const [running, setRunning] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);

  const pulseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [autosaver] = useState(() => createAutosaver({ onChange: setWorkflow, onState: setSaveState }));

  useEffect(() => () => autosaver.dispose(), [autosaver]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchWorkflow(workflowId), fetchLatestRun(workflowId)])
      .then(([wf, latest]) => {
        if (cancelled) return;
        autosaver.load(wf);
        setRun(latest);
        setSelectedId((wf.nodes.find((n) => n.type === "http") ?? wf.nodes[0])?.id ?? null);
      })
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [autosaver, workflowId]);

  // Mid-drag positions stay local; the drop (onMoveEnd) saves them.
  const moveNode = (id: string, x: number, y: number) =>
    autosaver.update(
      (wf) => ({ ...wf, nodes: wf.nodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n)) }),
      { save: false },
    );

  const updateNode = (node: WorkflowNode) =>
    autosaver.update((wf) => ({ ...wf, nodes: wf.nodes.map((n) => (n.id === node.id ? node : n)) }));

  const pulse = (id: string) => {
    clearTimeout(pulseTimer.current);
    setPulsingNodeId(id);
    pulseTimer.current = setTimeout(() => setPulsingNodeId(null), 300);
  };

  const execute = async () => {
    if (!workflow || running) return;
    const trigger = workflow.nodes.find((n) => n.type === "webhook");
    if (trigger) pulse(trigger.id);
    setRunning(true);
    try {
      if (saveState.kind !== "saved") await autosaver.flush(); // run what's on screen, not a stale copy
      setRun(await startRun(workflow.id, { body: SAMPLE_ORDER }));
    } catch (error) {
      setSaveState({ kind: "error", message: `Run failed to start: ${(error as Error).message}` });
    } finally {
      setRunning(false);
    }
  };

  if (loadError) {
    return (
      <div className="h-[calc(100vh-3.5rem-2.5rem)] flex items-center justify-center text-error font-body-md">
        Couldn&apos;t load workflow: {loadError}
      </div>
    );
  }
  if (!workflow) {
    return (
      <div className="h-[calc(100vh-3.5rem-2.5rem)] flex items-center justify-center gap-space-xs text-outline font-body-md">
        <Icon name="progress_activity" className="animate-spin text-body-lg" /> Loading workflow…
      </div>
    );
  }

  const steps = new Map<string, Step>(run?.steps.map((s) => [s.nodeId, s]));
  const selected = workflow.nodes.find((n) => n.id === selectedId);
  const saveLabel = {
    saved: { text: "SAVED", className: "bg-primary/10 text-primary" },
    saving: { text: "SAVING…", className: "bg-primary/10 text-primary animate-pulse" },
    unsaved: { text: "UNSAVED", className: "bg-tertiary/10 text-tertiary" },
    error: { text: "SAVE ERROR", className: "bg-error-container/60 text-on-error-container" },
  }[saveState.kind];

  return (
    <div className="flex flex-col w-full text-on-surface select-none">
      <div className="relative w-full h-[calc(100vh-3.5rem-2.5rem)] overflow-hidden flex">
        {/* Canvas context strip */}
        <div className="absolute top-space-sm left-space-md z-30 flex items-center gap-space-xs bg-surface-container/90 backdrop-blur-md px-space-md py-space-xs rounded-xl shadow-xl max-w-[calc(100%-820px)]">
          <div className="flex items-center gap-space-xs font-label-md text-label-md text-primary min-w-0">
            <Icon
              name="sync"
              className={`text-body-md ${saveState.kind === "saving" || running ? "animate-spin" : ""}`}
              style={{ animationDuration: "1s" }}
            />
            <span className="truncate">FLOW GRAPH: {workflow.name.toUpperCase()}</span>
          </div>
          <span className="text-outline-variant font-label-sm text-label-sm">|</span>
          <div className="flex items-center gap-space-xxs text-on-surface-variant font-body-sm text-body-sm shrink-0">
            <span>Version:</span>
            <span className="text-tertiary font-mono">v{workflow.version}</span>
          </div>
          <span className="text-outline-variant font-label-sm text-label-sm">|</span>
          <span
            className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm font-semibold tracking-wider shrink-0 ${saveLabel.className}`}
            title={saveState.kind === "error" ? saveState.message : undefined}
          >
            {saveLabel.text}
          </span>
        </div>

        {/* Simulation actions */}
        <div className="absolute top-space-sm right-[390px] z-30 flex items-center gap-space-xs">
          <button
            className="flex items-center gap-space-xs px-space-md py-space-xs bg-primary text-on-primary rounded-xl shadow-lg transition-all hover:bg-primary-container active:scale-95 font-body-sm text-body-sm font-semibold disabled:opacity-60"
            type="button"
            disabled={running}
            onClick={execute}
            title={`POST sample order ${SAMPLE_ORDER.id} to the trigger`}
          >
            <Icon name={running ? "progress_activity" : "bolt"} className={`text-body-md ${running ? "animate-spin" : ""}`} />
            <span>{running ? "Running…" : "Emit Webhook Test"}</span>
          </button>
        </div>

        {saveState.kind === "error" && (
          <div className="absolute top-14 left-space-md z-30 max-w-xl px-space-md py-space-xs rounded-xl bg-error-container/90 text-on-error-container font-body-sm text-body-sm shadow-xl">
            {saveState.message}
          </div>
        )}

        <FlowCanvas
          nodes={workflow.nodes}
          edges={workflow.edges}
          steps={steps}
          selectedId={selectedId}
          pulsingNodeId={pulsingNodeId}
          onSelect={setSelectedId}
          onMoveNode={moveNode}
          onMoveEnd={() => autosaver.update((wf) => wf, { immediate: true })}
          onAutoLayout={() => autosaver.update((wf) => ({ ...wf, nodes: autoLayout(wf) }), { immediate: true })}
        />
        {selected ? (
          <NodeInspector
            key={selected.id}
            node={selected}
            step={steps.get(selected.id)}
            running={running}
            onChange={updateNode}
            onRun={execute}
          />
        ) : (
          <aside className="w-[380px] h-full bg-surface-container-low/95 flex items-center justify-center text-outline font-body-sm text-body-sm">
            Select a node to inspect it.
          </aside>
        )}
      </div>
      <ExecutionStream run={run} onClear={() => setRun(undefined)} />
    </div>
  );
}
