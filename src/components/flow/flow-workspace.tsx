"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { onCanvasCommand, publishCanvasState } from "@/lib/canvas-events";
import { requestToNodeDraft } from "@/lib/collections/client";
import { draftToNode } from "@/lib/collections/to-node";
import { ENVIRONMENT_LABELS, useEnvironment } from "@/lib/environment";
import { deployWorkflow, fetchLatestRun, fetchWorkflow, startRunLive, type RunProgress } from "@/lib/workflows/client";
import { newNode } from "@/lib/workflows/defaults";
import { topologicalOrder } from "@/lib/workflows/graph";
import type { NodeType, Run, Step, Workflow, WorkflowNode } from "@/lib/workflows/schema";
import { SAMPLE_ORDER } from "@/lib/workflows/seed";
import { createAutosaver, type SaveState } from "./autosaver";
import { ExecutionStream } from "./execution-stream";
import { FlowCanvas } from "./flow-canvas";
import { LoadTestPanel } from "./load-test-panel";
import { NodeInspector } from "./node-inspector";
import { WorkflowSwitcher } from "./workflow-switcher";

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

const MIN_ACTIVE_MS = 450;
const HANDOFF_MS = 250;
const wait = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

export function FlowWorkspace({ workflowId }: { workflowId: string }) {
  const environment = useEnvironment();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | undefined>();
  const [running, setRunning] = useState(false);
  const [loadTesting, setLoadTesting] = useState(false);
  // While a run executes: the steps finished so far and the node running now, replayed at a watchable pace.
  const [live, setLive] = useState<{ steps: Step[]; activeId: string | null } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pulseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  const flash = useCallback((message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), Math.max(3500, message.length * 60));
  }, []);

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const current = autosaver.current();
      if (!current) return;
      if (type === "webhook" && current.nodes.some((n) => n.type === "webhook")) {
        flash("A workflow has exactly one trigger — this one already has a Webhook Trigger.");
        return;
      }
      const node = newNode(type, position, current.nodes.map((n) => n.id));
      autosaver.update((wf) => ({ ...wf, nodes: [...wf.nodes, node] }), { immediate: true });
      setSelectedId(node.id);
      setSelectedEdgeId(null);
    },
    [autosaver, flash],
  );

  /** A saved request dropped from the sidebar becomes an http node with its collection/folder auth and headers. */
  const addRequest = useCallback(
    (requestId: string, position: { x: number; y: number }) => {
      requestToNodeDraft({ requestId })
        .then((draft) => {
          const current = autosaver.current();
          if (!current) return;
          const node = draftToNode(draft, current, position);
          autosaver.update((wf) => ({ ...wf, nodes: [...wf.nodes, node] }), { immediate: true });
          setSelectedId(node.id);
          setSelectedEdgeId(null);
          flash([`Added “${draft.name}” as an HTTP node linked to Collections — edits there apply on every run.`, ...draft.warnings].join(" "));
        })
        .catch((error: Error) => flash(`Couldn't add that request: ${error.message}`));
    },
    [autosaver, flash],
  );

  const connect = (source: string, sourcePort: string, target: string) => {
    const current = autosaver.current();
    if (!current) return;
    if (source === target) return;
    if (current.edges.some((e) => e.source === source && e.sourcePort === sourcePort && e.target === target)) {
      flash("Those ports are already connected.");
      return;
    }
    let n = current.edges.length + 1;
    while (current.edges.some((e) => e.id === `e${n}`)) n += 1;
    const edges = [...current.edges, { id: `e${n}`, source, sourcePort, target }];
    if (!topologicalOrder(current.nodes, edges)) {
      flash("That connection would create a loop — flows must be acyclic.");
      return;
    }
    autosaver.update((wf) => ({ ...wf, edges }), { immediate: true });
  };

  const deleteSelection = () => {
    const current = autosaver.current();
    if (!current) return;
    if (selectedEdgeId) {
      autosaver.update((wf) => ({ ...wf, edges: wf.edges.filter((e) => e.id !== selectedEdgeId) }), { immediate: true });
      setSelectedEdgeId(null);
      return;
    }
    const node = current.nodes.find((n) => n.id === selectedId);
    if (!node) return;
    if (node.type === "webhook") {
      flash("The trigger can't be deleted — every workflow needs one.");
      return;
    }
    autosaver.update(
      (wf) => ({
        ...wf,
        nodes: wf.nodes.filter((n) => n.id !== node.id),
        edges: wf.edges.filter((e) => e.source !== node.id && e.target !== node.id),
      }),
      { immediate: true },
    );
    setSelectedId(null);
  };

  // Delete / Backspace removes the selected edge or node, unless the user is typing.
  const deleteRef = useRef(deleteSelection);
  useEffect(() => {
    deleteRef.current = deleteSelection;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const el = event.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      deleteRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pulse = (id: string) => {
    clearTimeout(pulseTimer.current);
    setPulsingNodeId(id);
    pulseTimer.current = setTimeout(() => setPulsingNodeId(null), 300);
  };

  // Re-use the last run's payload so tests match this workflow's shape; the sample order otherwise.
  const testPayload = run?.trigger.body ?? SAMPLE_ORDER;

  const execute = async () => {
    if (!workflow || running) return;
    const trigger = workflow.nodes.find((n) => n.type === "webhook");
    if (trigger) pulse(trigger.id);
    setRunning(true);
    setLive({ steps: [], activeId: null });
    // Progress is applied in order; each node stays highlighted for a moment so fast steps are still visible.
    let queue = Promise.resolve();
    let shownAt = 0;
    const onProgress = (event: RunProgress) => {
      queue = queue.then(async () => {
        if (event.type === "node") {
          setLive((l) => l && { ...l, activeId: event.nodeId });
          shownAt = Date.now();
          return;
        }
        if (event.step.status !== "skipped") await wait(MIN_ACTIVE_MS - (Date.now() - shownAt));
        setLive((l) => l && { steps: [...l.steps, event.step], activeId: l.activeId === event.step.nodeId ? null : l.activeId });
        if (event.step.status === "succeeded") await wait(HANDOFF_MS); // let the wire carry the output
      });
    };
    try {
      if (saveState.kind !== "saved") await autosaver.flush(); // run what's on screen, not a stale copy
      const finished = await startRunLive(workflow.id, { body: testPayload }, environment, onProgress);
      await queue;
      setRun(finished);
    } catch (error) {
      setSaveState({ kind: "error", message: `Run failed: ${(error as Error).message}` });
    } finally {
      setLive(null);
      setRunning(false);
    }
  };

  const deploy = async () => {
    if (!workflow || deploying) return;
    setDeploying(true);
    try {
      await autosaver.flush(); // deploy exactly what's on screen
      const current = autosaver.current();
      if (!current) return;
      const deployed = await deployWorkflow(current.id, current.version);
      autosaver.update((wf) => ({ ...wf, deployment: deployed.deployment }), { save: false });
      flash(`Deployed v${deployed.deployment?.version} — the webhook endpoint now runs this version.`);
    } catch (error) {
      flash(`Deploy failed: ${(error as Error).message}`);
    } finally {
      setDeploying(false);
    }
  };

  // Top-bar buttons (Run / Deploy) reach the canvas through window events; latest handlers via ref.
  const commandsRef = useRef({ execute, deploy });
  useEffect(() => {
    commandsRef.current = { execute, deploy };
  });
  useEffect(
    () =>
      onCanvasCommand((command) => {
        if (command === "run") void commandsRef.current.execute();
        if (command === "deploy") void commandsRef.current.deploy();
      }),
    [],
  );

  const undeployed = !!workflow && workflow.deployment?.version !== workflow.version;
  useEffect(() => publishCanvasState({ running, deploying, undeployed }), [running, deploying, undeployed]);
  const nodeCount = workflow?.nodes.length;
  useEffect(() => publishCanvasState({ workflowId, nodeCount }), [workflowId, nodeCount]);
  useEffect(() => () => publishCanvasState({ running: false, workflowId: undefined, nodeCount: undefined }), []);

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

  const steps = new Map<string, Step>((live ? live.steps : run?.steps)?.map((s) => [s.nodeId, s]));
  const activeName = live?.activeId ? workflow.nodes.find((n) => n.id === live.activeId)?.name : undefined;
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
        <div className="absolute top-space-sm left-space-md z-40 flex items-center gap-space-xs bg-surface-container/90 backdrop-blur-md px-space-md py-space-xs rounded-xl shadow-xl max-w-[calc(100%-640px)]">
          <div className="flex items-center gap-space-xs min-w-0">
            <Icon
              name="sync"
              className={`text-body-md text-primary shrink-0 ${saveState.kind === "saving" || running ? "animate-spin" : ""}`}
              style={{ animationDuration: "1s" }}
            />
            <WorkflowSwitcher
              workflow={workflow}
              onRename={(name) => autosaver.update((wf) => ({ ...wf, name }), { immediate: true })}
              onError={flash}
            />
          </div>
          <span className="text-outline-variant font-label-sm text-label-sm">|</span>
          <div
            className="flex items-center gap-space-xxs text-on-surface-variant font-body-sm text-body-sm shrink-0"
            title={
              workflow.deployment
                ? `Webhook runs v${workflow.deployment.version}, deployed ${new Date(workflow.deployment.deployedAt).toLocaleString()}`
                : "Not deployed: the webhook endpoint rejects calls until you deploy"
            }
          >
            <span>Draft</span>
            <span className="text-tertiary font-mono">v{workflow.version}</span>
            <span className="text-outline">·</span>
            {workflow.deployment ? (
              <span className={undeployed ? "text-tertiary" : "text-primary"}>
                live v{workflow.deployment.version}
                {undeployed && " (changes pending)"}
              </span>
            ) : (
              <span className="text-outline">not deployed</span>
            )}
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
            className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-high text-on-surface rounded-xl shadow-lg transition-all hover:bg-surface-container-highest active:scale-95 font-body-sm text-body-sm font-semibold"
            type="button"
            onClick={() => setLoadTesting(true)}
            title="Run this flow with many concurrent virtual users and measure throughput, errors and latency"
          >
            <Icon name="speed" className="text-body-md text-primary" />
            <span>Load Test</span>
          </button>
          <button
            className="flex items-center gap-space-xs px-space-md py-space-xs bg-primary text-on-primary rounded-xl shadow-lg transition-all hover:bg-primary-container active:scale-95 font-body-sm text-body-sm font-semibold disabled:opacity-60"
            type="button"
            disabled={running}
            onClick={execute}
            title={`Run the draft in ${ENVIRONMENT_LABELS[environment].label} with ${
              run ? "the last run's payload" : `sample order ${SAMPLE_ORDER.id}`
            }`}
          >
            <Icon name={running ? "progress_activity" : "bolt"} className={`text-body-md ${running ? "animate-spin" : ""}`} />
            <span>{running ? "Running…" : "Emit Webhook Test"}</span>
          </button>
        </div>

        {(saveState.kind === "error" || notice) && (
          <div className="absolute top-14 left-space-md z-30 max-w-xl flex flex-col gap-space-xs">
            {saveState.kind === "error" && (
              <div className="px-space-md py-space-xs rounded-xl bg-error-container/90 text-on-error-container font-body-sm text-body-sm shadow-xl">
                {saveState.message}
              </div>
            )}
            {notice && (
              <div className="px-space-md py-space-xs rounded-xl bg-surface-container-highest/95 text-tertiary font-body-sm text-body-sm shadow-xl">
                {notice}
              </div>
            )}
          </div>
        )}

        {loadTesting && (
          <LoadTestPanel
            workflowId={workflow.id}
            workflowName={workflow.name}
            environment={environment}
            defaultPayload={testPayload}
            beforeStart={async () => {
              if (saveState.kind !== "saved") await autosaver.flush(); // test what's on screen
            }}
            onClose={() => setLoadTesting(false)}
          />
        )}

        <FlowCanvas
          nodes={workflow.nodes}
          edges={workflow.edges}
          steps={steps}
          selectedId={selectedId}
          selectedEdgeId={selectedEdgeId}
          pulsingNodeId={pulsingNodeId}
          live={live ? { activeId: live.activeId } : undefined}
          onSelect={(id) => {
            setSelectedId(id);
            setSelectedEdgeId(null);
          }}
          onSelectEdge={(id) => {
            setSelectedEdgeId(id);
            setSelectedId(null);
          }}
          onMoveNode={moveNode}
          onMoveEnd={() => autosaver.update((wf) => wf, { immediate: true })}
          onAutoLayout={() => autosaver.update((wf) => ({ ...wf, nodes: autoLayout(wf) }), { immediate: true })}
          onAddNode={addNode}
          onAddRequest={addRequest}
          onConnect={connect}
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
          <aside className="w-[380px] h-full bg-surface-container-low/95 flex flex-col items-center justify-center gap-space-xs p-space-xl text-center text-outline font-body-sm text-body-sm">
            {selectedEdgeId ? (
              <>
                <span className="text-on-surface">Connection selected</span>
                <span>Press Delete to remove it.</span>
              </>
            ) : (
              <>
                <span className="text-on-surface">Select a node to inspect it.</span>
                <span>Drag blocks in from the Node Library, then drag from an output port to an input port to connect.</span>
              </>
            )}
          </aside>
        )}
      </div>
      <ExecutionStream
        run={run}
        live={live ? { steps: live.steps, activeName } : undefined}
        onClear={() => setRun(undefined)}
      />
    </div>
  );
}
