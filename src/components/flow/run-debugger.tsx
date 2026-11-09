"use client";

import { ScriptDebuggerDialog, traceLabel } from "@/components/collections/script-debugger";
import { breakpointKey, nodeBreakpointKey } from "@/lib/collections/breakpoints";
import type { ScriptDebug } from "@/lib/collections/script-debug";
import type { Step } from "@/lib/workflows/schema";

/** A debug run's recordings, step by step: each labelled with its node and keyed to the editor it came from. */
export function stepTraces(workflowId: string, steps: Step[]) {
  const items = steps.flatMap((step) =>
    (step.debug ?? []).map((trace) => {
      const key =
        trace.source === "script node"
          ? nodeBreakpointKey(workflowId, step.nodeId)
          : trace.source === "repeat until"
            ? nodeBreakpointKey(workflowId, step.nodeId, "until")
            : breakpointKey(trace.scope, trace.source, trace.phase);
      const label = trace.source === "script node" ? step.name : `${step.name} · ${traceLabel(trace)}`;
      return { trace, key, label };
    }),
  );
  return items;
}

/** The debugger for a flow run (all steps) or one step. */
export function RunDebuggerDialog({ workflowId, steps, title, onClose }: { workflowId: string; steps: Step[]; title: string; onClose: () => void }) {
  const items = stepTraces(workflowId, steps);
  const traces: ScriptDebug[] = items.map((i) => i.trace);
  return (
    <ScriptDebuggerDialog
      title={title}
      traces={traces}
      keyFor={(_, i) => items[i]?.key ?? null}
      labelFor={(_, i) => items[i]?.label ?? ""}
      onClose={onClose}
    />
  );
}
