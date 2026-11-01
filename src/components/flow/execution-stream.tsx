"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/icon";
import type { Run } from "@/lib/workflows/schema";
import { TYPE_STYLE } from "./node-cards";

export function ExecutionStream({ run, onClear }: { run?: Run; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const executed = run?.steps.filter((s) => s.status !== "skipped").length ?? 0;

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
          {run && (
            <div className="flex items-center gap-space-xs font-body-sm text-body-sm text-outline">
              <span>
                Session: <span className="text-on-surface font-mono">{run.id}</span>
              </span>
              <span>•</span>
              <span className={run.status === "failed" ? "text-error" : "text-primary"}>
                {executed} of {run.steps.length} Nodes Executed · {run.status.toUpperCase()} · {run.durationMs}ms
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-space-xs">
          <button
            className="px-space-xs py-space-xxs rounded text-outline hover:text-on-surface font-label-sm text-label-sm hover:bg-surface-container transition-colors"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
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
        {!run && <span className="text-outline italic">No runs yet. Emit a webhook test to execute the flow.</span>}
        {run?.steps.map((step, i) => {
          const style = TYPE_STYLE[step.nodeType];
          const response = step.output as { status?: number } | undefined;
          return (
            <Fragment key={step.nodeId}>
              {i > 0 && <Icon name="arrow_forward" className="text-outline text-body-sm shrink-0" />}
              <div
                className={`flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg shrink-0 ${
                  step.status === "skipped" ? "bg-surface-container-lowest shadow-inner opacity-60" : "bg-surface-container-high shadow-sm"
                }`}
                title={step.error}
              >
                <span className={`w-2 h-2 rounded-full ${step.status === "failed" ? "bg-error" : style.dot}`} />
                <span className={`${style.text} font-bold text-label-sm`}>
                  #{i + 1} {step.name.toUpperCase()}
                </span>
                <span className="text-outline">→</span>
                {step.status === "skipped" && <span className="text-on-surface-variant italic">skipped</span>}
                {step.status === "failed" && <span className="text-error max-w-72 truncate">{step.error}</span>}
                {step.status === "succeeded" && step.port && step.nodeType === "condition" && (
                  <span className="text-tertiary">Condition {step.port.toUpperCase()}</span>
                )}
                {step.request && step.status === "succeeded" && (
                  <span className="text-on-surface">
                    {step.request.method} {new URL(step.request.url).pathname}
                  </span>
                )}
                {step.nodeType === "webhook" && step.status === "succeeded" && <span className="text-on-surface">received</span>}
                {response?.status !== undefined && (
                  <span
                    className={`px-space-xs py-space-xxs rounded text-label-sm font-semibold ${
                      response.status >= 400 ? "bg-error-container text-on-error-container" : "bg-primary/20 text-primary"
                    }`}
                  >
                    {response.status}
                  </span>
                )}
                {step.status !== "skipped" && <span className="text-outline text-label-sm">{step.durationMs}ms</span>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
