"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/icon";
import { EXECUTION_STEPS } from "./data";

export function ExecutionStream() {
  const [collapsed, setCollapsed] = useState(false);
  const [steps, setSteps] = useState(EXECUTION_STEPS);
  const executed = steps.filter((s) => !s.pending).length;

  return (
    <div
      className={`relative w-full bg-surface-container-low/95 backdrop-blur-xl z-20 flex flex-col shadow-2xl transition-all duration-300 ${
        collapsed ? "h-9 overflow-hidden" : ""
      }`}
    >
      <div
        className="h-9 shrink-0 px-space-md flex items-center justify-between bg-surface-container-lowest/80 cursor-pointer"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs font-label-md text-label-md text-on-surface font-semibold">
            <Icon name="terminal" className="text-body-md text-primary" />
            <span>EXECUTION STREAM</span>
          </div>
          <div className="flex items-center gap-space-xs font-body-sm text-body-sm text-outline">
            <span>
              Session: <span className="text-on-surface font-mono">run_8182_checkout</span>
            </span>
            <span>•</span>
            <span className="text-primary">
              {executed} of {EXECUTION_STEPS.length} Nodes Executed
            </span>
          </div>
        </div>
        <div className="flex items-center gap-space-xs">
          <button
            className="px-space-xs py-space-xxs rounded text-outline hover:text-on-surface font-label-sm text-label-sm hover:bg-surface-container transition-colors"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSteps([]);
            }}
          >
            Clear Console
          </button>
          <button
            className="p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            title={collapsed ? "Expand console" : "Collapse console"}
            type="button"
          >
            <Icon name={collapsed ? "keyboard_arrow_up" : "keyboard_arrow_down"} className="text-body-md" />
          </button>
        </div>
      </div>

      <div className="p-space-sm flex items-center gap-space-md overflow-x-auto bg-surface-container-lowest/40 font-mono text-body-sm min-h-[46px]">
        {steps.length === 0 && <span className="text-outline italic">Console cleared. Waiting for next run…</span>}
        {steps.map((step, i) => (
          <Fragment key={step.label}>
            {i > 0 && <Icon name="arrow_forward" className="text-outline text-body-sm shrink-0" />}
            <div
              className={`flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg shrink-0 ${
                step.pending ? "bg-surface-container-lowest shadow-inner" : "bg-surface-container-high shadow-sm"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${step.dot} ${step.pending ? "animate-pulse" : ""}`} />
              <span className={`${step.text} font-bold text-label-sm`}>{step.label}</span>
              <span className="text-outline">→</span>
              <span
                className={
                  step.pending ? "text-on-surface-variant italic" : (step.messageTone ?? "text-on-surface")
                }
              >
                {step.message}
              </span>
              {step.status && (
                <span className="px-space-xs py-space-xxs rounded bg-primary/20 text-primary text-label-sm font-semibold">
                  {step.status}
                </span>
              )}
              {step.duration && <span className="text-outline text-label-sm">{step.duration}</span>}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
