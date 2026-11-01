"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ADD_NODE_EVENT, NODE_DRAG_MIME } from "@/lib/workflows/defaults";
import type { NodeType } from "@/lib/workflows/schema";

const CORE_BLOCKS: { type: NodeType; icon: string; label: string; tag: string; tone: string }[] = [
  { type: "http", icon: "http", label: "Send HTTP", tag: "REST", tone: "text-primary" },
  { type: "webhook", icon: "webhook", label: "Webhook Trigger", tag: "EVENT", tone: "text-tertiary" },
  { type: "transform", icon: "transform", label: "Data Mapping", tag: "TRANS", tone: "text-secondary" },
  { type: "condition", icon: "call_split", label: "Condition/Filter", tag: "FLOW", tone: "text-primary-fixed" },
  { type: "delay", icon: "hourglass_top", label: "Delay / Sleep", tag: "WAIT", tone: "text-outline" },
  { type: "response", icon: "output_circle", label: "Response / Output", tag: "EXIT", tone: "text-primary-container" },
];

/** Drag a block onto the Flow Canvas (or double-click it) to add a node. */
export function NodeLibrary() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const blocks = CORE_BLOCKS.filter((b) => !q || `${b.label} ${b.tag} ${b.type}`.toLowerCase().includes(q));

  return (
    <>
      <div className="p-space-sm">
        <label className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container-lowest text-on-surface-variant">
          <Icon name="search" className="text-body-md" />
          <input
            className="w-full bg-transparent font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:outline-none"
            placeholder="Filter nodes..."
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="px-space-sm pt-space-xs pb-space-sm">
        <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider px-space-xs mb-space-xs">
          Core Blocks
        </div>
        <div className="space-y-space-xxs">
          {blocks.map((block) => (
            <div
              key={block.type}
              draggable
              title="Drag onto the canvas, or double-click to add"
              onDragStart={(e) => {
                e.dataTransfer.setData(NODE_DRAG_MIME, block.type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onDoubleClick={() => window.dispatchEvent(new CustomEvent(ADD_NODE_EVENT, { detail: block.type }))}
              className="flex items-center justify-between p-space-xs rounded bg-surface-container hover:bg-surface-container-high transition-colors cursor-grab select-none"
            >
              <div className="flex items-center gap-space-xs">
                <Icon name={block.icon} className={`${block.tone} text-body-lg`} />
                <span className="font-body-sm text-body-sm text-on-surface">{block.label}</span>
              </div>
              <span
                className={`font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest ${block.tone}`}
              >
                {block.tag}
              </span>
            </div>
          ))}
          {blocks.length === 0 && <div className="px-space-xs font-body-sm text-body-sm text-outline">No matching blocks.</div>}
        </div>
      </div>
    </>
  );
}
