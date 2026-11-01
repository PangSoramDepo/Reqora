export const NODE_WIDTH = 280;

export type NodeKind = "webhook" | "stripe-auth" | "evaluate-tier" | "erp-sync" | "slack-dispatch";

export type FlowNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
};

export type EdgeTone = "primary" | "secondary" | "tertiary";

export type FlowEdge = {
  id: string;
  from: string;
  /** Output port name on the source node; the target always connects to its "in" port. */
  port: string;
  to: string;
  tone: EdgeTone;
  dashed?: boolean;
  animated?: boolean;
};

export type Point = { x: number; y: number };

/** Port centre relative to its node's top-left corner, in unscaled canvas pixels. */
export type PortOffsets = Record<string, Point>;

export const EDGE_STROKE: Record<EdgeTone, string> = {
  primary: "#4cd7f6",
  secondary: "#c0c1ff",
  tertiary: "#ffb95f",
};

export const portKey = (nodeId: string, port: string) => `${nodeId}:${port}`;

/** Cubic bezier with a horizontal tangent offset of max(40, |dx| * 0.5), per the design system. */
export function edgePath(a: Point, b: Point) {
  const t = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + t} ${a.y}, ${b.x - t} ${b.y}, ${b.x} ${b.y}`;
}
