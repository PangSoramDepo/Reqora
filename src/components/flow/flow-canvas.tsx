"use client";

import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/icon";
import { onCanvasCommand, publishCanvasState } from "@/lib/canvas-events";
import { ADD_NODE_EVENT, ADD_REQUEST_EVENT, NODE_DRAG_MIME, REQUEST_DRAG_MIME } from "@/lib/workflows/defaults";
import type { NodeType, Step, WorkflowEdge, WorkflowNode } from "@/lib/workflows/schema";
import { NODE_WIDTH, edgePath, edgeStyle, portKey, type Point, type PortOffsets } from "./graph";
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
  selectedEdgeId: string | null;
  pulsingNodeId: string | null;
  /** Set while a run executes: the node running right now (null between nodes). */
  live?: { activeId: string | null };
  onSelect: (id: string | null) => void;
  onSelectEdge: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onMoveEnd: () => void;
  onAutoLayout: () => void;
  onAddNode: (type: NodeType, position: Point) => void;
  /** A saved request from Collections dropped (or double-clicked) onto the canvas. */
  onAddRequest: (requestId: string, position: Point) => void;
  onConnect: (source: string, sourcePort: string, target: string) => void;
};

type Drag = { id: string; pointerX: number; pointerY: number; originX: number; originY: number; moved: boolean };
type Wire = { source: string; port: string; from: Point; to: Point };

export function FlowCanvas({
  nodes,
  edges,
  steps,
  selectedId,
  selectedEdgeId,
  pulsingNodeId,
  live,
  onSelect,
  onSelectEdge,
  onMoveNode,
  onMoveEnd,
  onAutoLayout,
  onAddNode,
  onAddRequest,
  onConnect,
}: FlowCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [ports, setPorts] = useState<PortOffsets>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [wire, setWire] = useState<Wire | null>(null);
  const [viewport, setViewport] = useState({ width: 1120, height: 640 });
  const [showMinimap, setShowMinimap] = useState(true);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const viewRef = useRef({ pan, zoom, viewport });
  const nodeIds = nodes.map((n) => n.id).join(",");

  useEffect(() => {
    zoomRef.current = zoom;
    viewRef.current = { pan, zoom, viewport };
  }, [pan, zoom, viewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: container.clientWidth, height: container.clientHeight }),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Top-bar zoom / minimap buttons, and the zoom readout they display.
  useEffect(
    () =>
      onCanvasCommand((command) => {
        const step = (delta: number) =>
          setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 10) / 10)));
        if (command === "zoom-in") step(0.1);
        if (command === "zoom-out") step(-0.1);
        if (command === "toggle-minimap") setShowMinimap((v) => !v);
      }),
    [],
  );
  useEffect(() => publishCanvasState({ zoom }), [zoom]);

  // Double-clicking a Node Library block or saved request adds it at the centre of the current view.
  useEffect(() => {
    const centre = () => {
      const { pan: p, zoom: z, viewport: v } = viewRef.current;
      return { x: Math.round((v.width / 2 - p.x) / z - NODE_WIDTH / 2), y: Math.round((v.height / 2 - p.y) / z - 80) };
    };
    const addNode = (event: Event) => onAddNode((event as CustomEvent<NodeType>).detail, centre());
    const addRequest = (event: Event) => onAddRequest((event as CustomEvent<string>).detail, centre());
    window.addEventListener(ADD_NODE_EVENT, addNode);
    window.addEventListener(ADD_REQUEST_EVENT, addRequest);
    return () => {
      window.removeEventListener(ADD_NODE_EVENT, addNode);
      window.removeEventListener(ADD_REQUEST_EVENT, addRequest);
    };
  }, [onAddNode, onAddRequest]);

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

  /** Converts a viewport point to unscaled canvas coordinates. */
  const toCanvas = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNode) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("input, button")) return;

    // Pressing an output port starts a wire instead of moving the node.
    const port = target.closest<HTMLElement>("[data-port]")?.dataset.port;
    if (port && port !== "in") {
      const offset = ports[portKey(node.id, port)];
      if (!offset) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const from = { x: node.position.x + offset.x, y: node.position.y + offset.y };
      setWire({ source: node.id, port, from, to: from });
      return;
    }
    if (port) return;

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
    if (wire) {
      setWire({ ...wire, to: toCanvas(event.clientX, event.clientY) });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    onMoveNode(
      drag.id,
      Math.round(drag.originX + (event.clientX - drag.pointerX) / zoom),
      Math.round(drag.originY + (event.clientY - drag.pointerY) / zoom),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (wire) {
      // Search every element under the pointer: wire hit areas overlap the input ports they end on.
      const port = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((el) => el.closest('[data-port="in"]'));
      const target = port?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (target) onConnect(wire.source, wire.port, target);
      setWire(null);
      return;
    }
    if (dragRef.current?.moved) onMoveEnd();
    dragRef.current = null;
    setDraggingId(null);
  };

  const changeZoom = (delta: number) =>
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 10) / 10)));

  // Dragging empty canvas pans the view; a plain click on it clears the selection.
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-node-id], [data-edge-id], button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: pan.x, originY: pan.y };
    setPanning(true);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag) return;
    setPan({ x: drag.originX + event.clientX - drag.pointerX, y: drag.originY + event.clientY - drag.pointerY });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (drag && Math.abs(event.clientX - drag.pointerX) + Math.abs(event.clientY - drag.pointerY) < 4) onSelect(null);
    panRef.current = null;
    setPanning(false);
  };

  const acceptsDrop = (event: DragEvent) =>
    event.dataTransfer.types.includes(NODE_DRAG_MIME) || event.dataTransfer.types.includes(REQUEST_DRAG_MIME);

  const drop = (event: DragEvent<HTMLDivElement>) => {
    const type = event.dataTransfer.getData(NODE_DRAG_MIME) as NodeType;
    const requestId = event.dataTransfer.getData(REQUEST_DRAG_MIME);
    if (!type && !requestId) return;
    event.preventDefault();
    const point = toCanvas(event.clientX, event.clientY);
    const position = { x: Math.round(point.x - NODE_WIDTH / 2), y: Math.round(point.y - 20) };
    if (type) onAddNode(type, position);
    else onAddRequest(requestId, position);
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
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={drop}
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

      <div
        ref={layerRef}
        className="relative w-full h-full origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
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
            const style = edgeStyle(edge, from, steps, !!live);
            const selected = edge.id === selectedEdgeId;
            const d = edgePath(a, b);
            return (
              <g key={edge.id} opacity={selected ? 1 : style.opacity}>
                {selected && <path d={d} fill="none" stroke="#d3e4fe" strokeOpacity={0.35} strokeWidth={8} />}
                <path
                  className={style.animated ? "animate-dash" : undefined}
                  d={d}
                  fill="none"
                  filter={style.glow ? `url(#glow-${style.glow})` : undefined}
                  stroke={style.stroke}
                  strokeDasharray={style.dash}
                  strokeWidth={style.width}
                />
                {/* Wide invisible hit area so thin wires are easy to select. */}
                <path
                  data-edge-id={edge.id}
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  pointerEvents="stroke"
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectEdge(edge.id);
                  }}
                >
                  <title>
                    {edge.source}.{edge.sourcePort} → {edge.target} (select, then press Delete to remove)
                  </title>
                </path>
                {style.flowing && (
                  <circle fill="#acedff" r="4.5" filter="url(#glow-primary)">
                    <animateMotion dur="0.7s" path={d} repeatCount="indefinite" />
                  </circle>
                )}
                {style.animated && !live && (
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
          {wire && (
            <path d={edgePath(wire.from, wire.to)} fill="none" stroke="#4cd7f6" strokeDasharray="5,4" strokeWidth={2} />
          )}
        </svg>

        {nodes.map((node) => {
          const selected = node.id === selectedId;
          const active = live?.activeId === node.id;
          const waiting = !!live && !active && !steps.has(node.id);
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
              } ${active ? "animate-node-running ring-2 ring-primary z-25" : ""} ${waiting ? "opacity-50" : ""} ${
                wire && wire.source !== node.id ? "[&_[data-port=in]]:ring-2 [&_[data-port=in]]:ring-primary" : ""}`}
              style={{ top: node.position.y, left: node.position.x, width: NODE_WIDTH }}
              onPointerDown={(e) => startDrag(e, node)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <NodeCard node={node} step={steps.get(node.id)} selected={selected} running={active} waiting={waiting} />
            </div>
          );
        })}
      </div>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-outline font-body-md">
          Drag a block from the Node Library to start.
        </div>
      )}

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
      <div
        className={`absolute bottom-space-md right-[20px] z-30 w-44 h-28 bg-surface-container-lowest/90 backdrop-blur-xl rounded-xl shadow-2xl p-space-xs flex-col justify-between overflow-hidden ${
          showMinimap ? "flex" : "hidden"
        }`}
      >
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
