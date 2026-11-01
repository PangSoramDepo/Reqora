"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/icon";
import type { Step, WorkflowEdge, WorkflowNode } from "@/lib/workflows/schema";
import { NODE_WIDTH, edgePath, edgeStyle, portKey, type PortOffsets } from "./graph";
import { NodeCard, TYPE_STYLE } from "./node-cards";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const MINIMAP_SCALE = 0.1;

const DOCK_BUTTON =
  "p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors";

type FlowCanvasProps = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  steps: Map<string, Step>;
  selectedId: string | null;
  pulsingNodeId: string | null;
  onSelect: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onMoveEnd: () => void;
  onAutoLayout: () => void;
};

type Drag = { id: string; pointerX: number; pointerY: number; originX: number; originY: number; moved: boolean };

export function FlowCanvas({
  nodes,
  edges,
  steps,
  selectedId,
  pulsingNodeId,
  onSelect,
  onMoveNode,
  onMoveEnd,
  onAutoLayout,
}: FlowCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [ports, setPorts] = useState<PortOffsets>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const nodeIds = nodes.map((n) => n.id).join(",");

  const [viewport, setViewport] = useState({ width: 1120, height: 640 });

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: container.clientWidth, height: container.clientHeight }),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
  }, [nodeIds]);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNode) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("input, button, [data-port]")) return;
    onSelect(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
      moved: false,
    };
    setDraggingId(node.id);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    onMoveNode(
      drag.id,
      Math.round(drag.originX + (event.clientX - drag.pointerX) / zoom),
      Math.round(drag.originY + (event.clientY - drag.pointerY) / zoom),
    );
  };

  const endDrag = () => {
    if (dragRef.current?.moved) onMoveEnd();
    dragRef.current = null;
    setDraggingId(null);
  };

  const changeZoom = (delta: number) =>
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 10) / 10)));

  // Dragging empty canvas pans the view.
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-node-id], button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: pan.x, originY: pan.y };
    setPanning(true);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag) return;
    setPan({ x: drag.originX + event.clientX - drag.pointerX, y: drag.originY + event.clientY - drag.pointerY });
  };

  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };

  /** Zooms and pans so every node is visible (never zooming in past 100%). */
  const fitToView = () => {
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || nodes.length === 0 || !layer) return;
    const heights = new Map(
      [...layer.querySelectorAll<HTMLElement>("[data-node-id]")].map((el) => [el.dataset.nodeId!, el.offsetHeight]),
    );
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH));
    const maxY = Math.max(...nodes.map((n) => n.position.y + (heights.get(n.id) ?? 200)));
    const padding = 60;
    const fit = Math.min(
      1,
      (container.clientWidth - padding * 2) / (maxX - minX),
      (container.clientHeight - padding * 2) / (maxY - minY),
    );
    const next = Math.max(MIN_ZOOM, Math.floor(fit * 10) / 10);
    setZoom(next);
    setPan({
      x: (container.clientWidth - (maxX - minX) * next) / 2 - minX * next,
      y: (container.clientHeight - (maxY - minY) * next) / 2 - minY * next,
    });
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 h-full overflow-clip touch-none ${panning ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {/* Infinite dot-matrix grid */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern height="24" id="dot-pattern" patternUnits="userSpaceOnUse" width="24">
            <circle cx="3" cy="3" fill="#4cd7f6" fillOpacity="0.12" r="1.25" />
          </pattern>
        </defs>
        <rect fill="url(#dot-pattern)" height="100%" width="100%" />
      </svg>

      <div ref={layerRef} className="relative w-full h-full origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
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
          {edges.map((edge) => {
            const from = byId.get(edge.source);
            const to = byId.get(edge.target);
            const out = ports[portKey(edge.source, edge.sourcePort)];
            const inp = ports[portKey(edge.target, "in")];
            if (!from || !to || !out || !inp) return null;
            const a = { x: from.position.x + out.x, y: from.position.y + out.y };
            const b = { x: to.position.x + inp.x, y: to.position.y + inp.y };
            const style = edgeStyle(edge, from, steps);
            return (
              <g key={edge.id} opacity={style.opacity}>
                <path
                  className={style.animated ? "animate-dash" : undefined}
                  d={edgePath(a, b)}
                  fill="none"
                  filter={style.glow ? `url(#glow-${style.glow})` : undefined}
                  stroke={style.stroke}
                  strokeDasharray={style.dash}
                  strokeWidth={style.width}
                />
                {style.animated && (
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

        {nodes.map((node) => {
          const selected = node.id === selectedId;
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className={`absolute flex flex-col backdrop-blur-xl rounded-xl transition-[translate,scale,box-shadow] duration-200 group touch-none ${
                selected
                  ? "bg-surface-container-high/95 shadow-2xl shadow-primary/20 ring-1 ring-primary/40"
                  : "bg-surface-container-high/90 shadow-xl hover:-translate-y-0.5"
              } ${draggingId === node.id ? "z-25 cursor-grabbing" : "z-20 cursor-move"} ${
                pulsingNodeId === node.id ? "scale-[1.02]" : ""
              }`}
              style={{ top: node.position.y, left: node.position.x, width: NODE_WIDTH }}
              onPointerDown={(e) => startDrag(e, node)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <NodeCard node={node} step={steps.get(node.id)} selected={selected} />
            </div>
          );
        })}
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
          title="Drag empty canvas to pan · click to reset view"
          type="button"
          onClick={() => {
            setPan({ x: 0, y: 0 });
            setZoom(1);
          }}
        >
          <Icon name="pan_tool" className="text-body-md" />
        </button>
        <button className={DOCK_BUTTON} title="Auto Align Graph" type="button" onClick={onAutoLayout}>
          <Icon name="align_horizontal_left" className="text-body-md" />
        </button>
        <button className={DOCK_BUTTON} title="Fit to View" type="button" onClick={fitToView}>
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
          {nodes.map((node) => {
            const selected = node.id === selectedId;
            return (
              <div
                key={node.id}
                className={`absolute rounded-sm ${TYPE_STYLE[node.type].minimap} ${selected ? "ring-1 ring-primary" : "opacity-80"}`}
                style={{
                  left: node.position.x * MINIMAP_SCALE,
                  top: node.position.y * MINIMAP_SCALE,
                  width: selected ? 24 : 20,
                  height: selected ? 16 : 12,
                }}
              />
            );
          })}
          <div
            className="absolute bg-primary/10 rounded-sm"
            style={{
              left: (-pan.x / zoom) * MINIMAP_SCALE,
              top: (-pan.y / zoom) * MINIMAP_SCALE,
              width: (viewport.width / zoom) * MINIMAP_SCALE,
              height: (viewport.height / zoom) * MINIMAP_SCALE,
            }}
          />
        </div>
      </div>
    </div>
  );
}
