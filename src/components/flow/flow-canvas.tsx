"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/icon";
import { EDGES } from "./data";
import { EDGE_STROKE, NODE_WIDTH, edgePath, portKey, type FlowNode, type PortOffsets } from "./graph";
import { MINIMAP_COLOR, NODE_CARD_CLASS, NodeBody } from "./node-cards";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const MINIMAP_SCALE = 0.1;

const DOCK_BUTTON =
  "p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors";

type FlowCanvasProps = {
  nodes: FlowNode[];
  onMoveNode: (id: string, x: number, y: number) => void;
  onAutoLayout: () => void;
  pulsingNodeId: string | null;
};

type Drag = { id: string; pointerX: number; pointerY: number; originX: number; originY: number };

export function FlowCanvas({ nodes, onMoveNode, onAutoLayout, pulsingNodeId }: FlowCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [ports, setPorts] = useState<PortOffsets>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Edge endpoints come from the rendered port dots, so wires stay attached whatever the card layout.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const measure = () => {
      const scale = zoomRef.current;
      const next: PortOffsets = {};
      layer.querySelectorAll<HTMLElement>("[data-node-id]").forEach((nodeEl) => {
        const nodeRect = nodeEl.getBoundingClientRect();
        nodeEl.querySelectorAll<HTMLElement>("[data-port]").forEach((portEl) => {
          const r = portEl.getBoundingClientRect();
          next[portKey(nodeEl.dataset.nodeId!, portEl.dataset.port!)] = {
            x: (r.left + r.width / 2 - nodeRect.left) / scale,
            y: (r.top + r.height / 2 - nodeRect.top) / scale,
          };
        });
      });
      setPorts(next);
    };

    const observer = new ResizeObserver(measure);
    layer.querySelectorAll("[data-node-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, node: FlowNode) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("input, button, [data-port]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: node.id, pointerX: event.clientX, pointerY: event.clientY, originX: node.x, originY: node.y };
    setDraggingId(node.id);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onMoveNode(
      drag.id,
      Math.round(drag.originX + (event.clientX - drag.pointerX) / zoom),
      Math.round(drag.originY + (event.clientY - drag.pointerY) / zoom),
    );
  };

  const endDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
  };

  const changeZoom = (delta: number) =>
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 10) / 10)));

  return (
    <div className="relative flex-1 h-full overflow-hidden cursor-crosshair">
      {/* Infinite dot-matrix grid */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern height="24" id="dot-pattern" patternUnits="userSpaceOnUse" width="24">
            <circle cx="3" cy="3" fill="#4cd7f6" fillOpacity="0.12" r="1.25" />
          </pattern>
        </defs>
        <rect fill="url(#dot-pattern)" height="100%" width="100%" />
      </svg>

      <div ref={layerRef} className="relative w-full h-full origin-top-left" style={{ transform: `scale(${zoom})` }}>
        <svg className="absolute inset-0 overflow-visible pointer-events-none" width="100%" height="100%">
          <defs>
            <filter height="140%" id="glow-primary" width="140%" x="-20%" y="-20%">
              <feGaussianBlur result="blur" stdDeviation="3" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter height="140%" id="glow-tertiary" width="140%" x="-20%" y="-20%">
              <feGaussianBlur result="blur" stdDeviation="3.5" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {EDGES.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            const out = ports[portKey(edge.from, edge.port)];
            const inp = ports[portKey(edge.to, "in")];
            if (!from || !to || !out || !inp) return null;
            const a = { x: from.x + out.x, y: from.y + out.y };
            const b = { x: to.x + inp.x, y: to.y + inp.y };
            const glow = edge.tone === "secondary" ? undefined : `url(#glow-${edge.tone})`;
            return (
              <g key={edge.id}>
                <path
                  className={edge.animated ? "animate-dash" : undefined}
                  d={edgePath(a, b)}
                  fill="none"
                  filter={glow}
                  opacity={edge.tone === "secondary" ? 0.85 : undefined}
                  stroke={EDGE_STROKE[edge.tone]}
                  strokeDasharray={edge.dashed ? (edge.animated ? "6,4" : "4,3") : undefined}
                  strokeWidth={edge.tone === "secondary" ? 2.2 : 2.5}
                />
                {edge.animated && (
                  <circle
                    className="animate-ping"
                    cx={(a.x + b.x) / 2}
                    cy={(a.y + b.y) / 2}
                    fill="#acedff"
                    r="4"
                    style={{ animationDuration: "2s", transformBox: "fill-box", transformOrigin: "center" }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => (
          <div
            key={node.id}
            data-node-id={node.id}
            className={`absolute flex flex-col backdrop-blur-xl rounded-xl transition-[translate,scale,box-shadow] duration-200 group touch-none ${
              NODE_CARD_CLASS[node.kind]
            } ${draggingId === node.id ? "z-25 cursor-grabbing" : "z-20 cursor-move"} ${
              pulsingNodeId === node.id ? "scale-[1.02]" : ""
            }`}
            style={{ top: node.y, left: node.x, width: NODE_WIDTH }}
            onPointerDown={(e) => startDrag(e, node)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <NodeBody kind={node.kind} />
          </div>
        ))}
      </div>

      {/* Floating canvas control dock */}
      <div className="absolute bottom-space-md left-space-md z-30 flex items-center gap-space-xs bg-surface-container-high/90 backdrop-blur-xl p-space-xs rounded-xl shadow-xl">
        <button className={DOCK_BUTTON} title="Zoom In" type="button" onClick={() => changeZoom(0.1)}>
          <Icon name="zoom_in" className="text-body-md" />
        </button>
        <button className={DOCK_BUTTON} title="Zoom Out" type="button" onClick={() => changeZoom(-0.1)}>
          <Icon name="zoom_out" className="text-body-md" />
        </button>
        <div className="h-4 w-px bg-outline-variant/40" />
        <button
          className="p-space-xs rounded bg-surface-container text-primary hover:bg-surface-container-highest transition-colors"
          title="Pan Hand Tool"
          type="button"
        >
          <Icon name="pan_tool" className="text-body-md" />
        </button>
        <button className={DOCK_BUTTON} title="Auto Align Graph" type="button" onClick={onAutoLayout}>
          <Icon name="align_horizontal_left" className="text-body-md" />
        </button>
        <button className={DOCK_BUTTON} title="Fit to View" type="button" onClick={() => setZoom(1)}>
          <Icon name="fit_screen" className="text-body-md" />
        </button>
      </div>

      {/* Minimap */}
      <div className="absolute bottom-space-md right-[20px] z-30 w-44 h-28 bg-surface-container-lowest/90 backdrop-blur-xl rounded-xl shadow-2xl p-space-xs flex flex-col justify-between overflow-hidden">
        <div className="flex items-center justify-between text-[9px] text-outline font-label-sm uppercase tracking-wider">
          <span>Minimap</span>
          <span className="text-primary font-mono">{zoom.toFixed(1)}x</span>
        </div>
        <div className="relative w-full h-20 bg-surface-container/60 rounded overflow-hidden">
          {nodes.map((node) => (
            <div
              key={node.id}
              className={`absolute rounded-sm ${MINIMAP_COLOR[node.kind]}`}
              style={{
                left: node.x * MINIMAP_SCALE,
                top: node.y * MINIMAP_SCALE,
                width: node.kind === "stripe-auth" ? 24 : 20,
                height: node.kind === "stripe-auth" ? 16 : 12,
              }}
            />
          ))}
          <div
            className="absolute top-0 left-0 bg-primary/10 rounded-sm"
            style={{ width: 112 / zoom, height: 64 / zoom }}
          />
        </div>
      </div>
    </div>
  );
}
