import type { Step, WorkflowEdge, WorkflowNode } from "@/lib/workflows/schema";

export const NODE_WIDTH = 280;

export type Point = { x: number; y: number };

/** Port centre relative to its node's top-left corner, in unscaled canvas pixels. */
export type PortOffsets = Record<string, Point>;

export const portKey = (nodeId: string, port: string) => `${nodeId}:${port}`;

/** Cubic bezier with a horizontal tangent offset of max(40, |dx| * 0.5), per the design system. */
export function edgePath(a: Point, b: Point) {
  const t = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + t} ${a.y}, ${b.x - t} ${b.y}, ${b.x} ${b.y}`;
}

export type EdgeStyle = {
  stroke: string;
  width: number;
  dash?: string;
  glow?: "primary" | "tertiary";
  animated?: boolean;
  /** A run is carrying data along this wire right now (live run). */
  flowing?: boolean;
  opacity: number;
};

/**
 * Wire styling from the design: trigger wires are dashed and animated, condition TRUE wires amber,
 * FALSE wires muted. After a run, wires the run didn't take are dimmed; during a `live` run, wires light up and
 * carry a moving dot as each step hands its output to the next node.
 */
export function edgeStyle(
  edge: WorkflowEdge,
  source: WorkflowNode | undefined,
  steps: Map<string, Step>,
  live = false,
): EdgeStyle {
  let style: EdgeStyle;
  if (source?.type === "webhook") style = { stroke: "#4cd7f6", width: 2.5, dash: "6,4", glow: "primary", animated: true, opacity: 1 };
  else if (edge.sourcePort === "true") style = { stroke: "#ffb95f", width: 2.5, dash: "4,3", glow: "tertiary", opacity: 1 };
  else if (edge.sourcePort === "false") style = { stroke: "#869397", width: 2, dash: "4,3", opacity: 0.85 };
  else if (source?.type === "http") style = { stroke: "#4cd7f6", width: 2.5, glow: "primary", opacity: 1 };
  else style = { stroke: "#c0c1ff", width: 2.2, opacity: 0.85 };

  if (source?.disabled) style = { stroke: "#869397", width: 2, dash: "3,4", opacity: 0.6 };
  const sourceStep = steps.get(edge.source);
  const passed = !!sourceStep && (sourceStep.disabled || (sourceStep.status === "succeeded" && sourceStep.port === edge.sourcePort));
  if (live) {
    // While a run executes: wires light up as data passes through them; the rest wait dimmed.
    if (!sourceStep || !passed) {
      return { ...style, glow: undefined, animated: false, opacity: sourceStep ? 0.2 : 0.35 };
    }
    return { ...style, dash: style.dash ?? "6,4", glow: style.glow ?? "primary", animated: true, flowing: !steps.has(edge.target), opacity: 1 };
  }
  if (sourceStep && !passed) {
    return { ...style, glow: undefined, animated: false, opacity: 0.25 };
  }
  return style;
}
