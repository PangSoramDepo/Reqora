"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { INITIAL_NODES } from "./data";
import { ExecutionStream } from "./execution-stream";
import { FlowCanvas } from "./flow-canvas";
import { NodeInspector } from "./node-inspector";

const SELECTED_NODE_ID = "node-2";

export function FlowWorkspace() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const moveNode = (id: string, x: number, y: number) =>
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));

  const pulse = () => {
    clearTimeout(pulseTimer.current);
    setPulsingNodeId(SELECTED_NODE_ID);
    pulseTimer.current = setTimeout(() => setPulsingNodeId(null), 300);
  };

  return (
    <div className="flex flex-col w-full text-on-surface select-none">
      <div className="relative w-full h-[calc(100vh-3.5rem-2.5rem)] overflow-hidden flex">
        {/* Canvas context strip */}
        <div className="absolute top-space-sm left-space-md z-30 flex items-center gap-space-xs bg-surface-container/90 backdrop-blur-md px-space-md py-space-xs rounded-xl shadow-xl">
          <div className="flex items-center gap-space-xs font-label-md text-label-md text-primary">
            <Icon name="sync" className="text-body-md animate-spin" style={{ animationDuration: "4s" }} />
            <span>FLOW GRAPH: CHECKOUT-V2</span>
          </div>
          <span className="text-outline-variant font-label-sm text-label-sm">|</span>
          <div className="flex items-center gap-space-xxs text-on-surface-variant font-body-sm text-body-sm">
            <span>Branch:</span>
            <span className="text-tertiary font-mono">main@7f29a0c</span>
          </div>
          <span className="text-outline-variant font-label-sm text-label-sm">|</span>
          <span className="px-space-xs py-space-xxs rounded bg-primary/10 text-primary font-label-sm text-label-sm font-semibold tracking-wider">
            LIVE RECORDING
          </span>
        </div>

        {/* Simulation actions */}
        <div className="absolute top-space-sm right-[390px] z-30 flex items-center gap-space-xs">
          <button
            className="flex items-center gap-space-xs px-space-md py-space-xs bg-surface-container-high/90 hover:bg-surface-container-highest text-on-surface rounded-xl backdrop-blur-md shadow-lg transition-all active:scale-95 font-body-sm text-body-sm"
            type="button"
          >
            <Icon name="skip_next" className="text-body-md text-tertiary" />
            <span>Step Run</span>
          </button>
          <button
            className="flex items-center gap-space-xs px-space-md py-space-xs bg-primary text-on-primary rounded-xl shadow-lg transition-all hover:bg-primary-container active:scale-95 font-body-sm text-body-sm font-semibold"
            type="button"
            onClick={pulse}
          >
            <Icon name="bolt" className="text-body-md" />
            <span>Emit Webhook Test</span>
          </button>
        </div>

        <FlowCanvas
          nodes={nodes}
          onMoveNode={moveNode}
          onAutoLayout={() => setNodes(INITIAL_NODES)}
          pulsingNodeId={pulsingNodeId}
        />
        <NodeInspector onTestRequest={pulse} />
      </div>
      <ExecutionStream />
    </div>
  );
}
