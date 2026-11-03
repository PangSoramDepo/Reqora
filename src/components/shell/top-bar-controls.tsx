"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { onCanvasState, sendCanvasCommand, type CanvasState } from "@/lib/canvas-events";
import { ENVIRONMENT_LABELS, setEnvironment, useEnvironment } from "@/lib/environment";
import { ENVIRONMENTS, type Environment } from "@/lib/workflows/schema";

const SECTIONS: [prefix: string, label: string][] = [
  ["/flow", "Flow Canvas"],
  ["/executions", "Execution History"],
  ["/secrets", "Environment Secrets"],
  ["/telemetry", "Telemetry & Metrics"],
];

const ICON_BUTTON =
  "p-space-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors rounded disabled:opacity-40 disabled:pointer-events-none";

export function TopBarControls() {
  const pathname = usePathname();
  const environment = useEnvironment();
  const onCanvas = pathname.startsWith("/flow/");
  const section = SECTIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "";
  const [canvas, setCanvas] = useState<CanvasState>({ zoom: 1, running: false, deploying: false, undeployed: false });
  const [copied, setCopied] = useState(false);
  const env = ENVIRONMENT_LABELS[environment];

  useEffect(() => onCanvasState((state) => setCanvas((prev) => ({ ...prev, ...state }))), []);

  const share = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex-1 flex items-center justify-between pl-space-md">
      <div className="flex items-center gap-space-md">
        <div className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
          <span className="text-outline">/</span>
          <span>Workspaces</span>
          <span className="text-outline">/</span>
          <span>Default</span>
          <span className="text-outline">/</span>
          <span className="text-on-surface font-medium">{section}</span>
        </div>
        <label
          className={`flex items-center gap-space-xxs px-space-xs py-space-xxs rounded bg-surface-container-highest border border-outline-variant/30 ${env.tone}`}
          title="Environment used for test runs and shown on the Secrets page"
        >
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${env.dot}`} />
          <select
            aria-label="Environment"
            className="bg-transparent font-label-sm text-label-sm uppercase focus:outline-none cursor-pointer"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as Environment)}
          >
            {ENVIRONMENTS.map((id) => (
              <option key={id} value={id} className="bg-surface-container-high text-on-surface">
                {ENVIRONMENT_LABELS[id].label} {ENVIRONMENT_LABELS[id].region}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-space-sm">
        <div className="flex items-center rounded bg-surface-container-highest p-space-xxs">
          <button className={ICON_BUTTON} disabled={!onCanvas} onClick={() => sendCanvasCommand("zoom-out")} title="Zoom Out" type="button">
            <Icon name="remove" className="text-body-md" />
          </button>
          <span className="px-space-xs font-label-sm text-label-sm text-on-surface w-11 text-center">
            {onCanvas ? `${Math.round(canvas.zoom * 100)}%` : "—"}
          </span>
          <button className={ICON_BUTTON} disabled={!onCanvas} onClick={() => sendCanvasCommand("zoom-in")} title="Zoom In" type="button">
            <Icon name="add" className="text-body-md" />
          </button>
          <button
            className={`${ICON_BUTTON} ml-space-xxs`}
            disabled={!onCanvas}
            onClick={() => sendCanvasCommand("toggle-minimap")}
            title="Toggle Minimap"
            type="button"
          >
            <Icon name="map" className="text-body-md" />
          </button>
        </div>
        <button
          className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-body-sm text-body-sm transition-colors"
          onClick={share}
          title="Copy a link to this page"
          type="button"
        >
          <Icon name={copied ? "check" : "share"} className="text-body-md" />
          <span>{copied ? "Copied" : "Share"}</span>
        </button>
        <button
          className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-secondary-container hover:bg-secondary-container/80 text-on-secondary-container font-body-sm text-body-sm transition-colors disabled:opacity-50 disabled:pointer-events-none"
          disabled={!onCanvas || canvas.deploying || !canvas.undeployed}
          onClick={() => sendCanvasCommand("deploy")}
          title={
            !onCanvas
              ? "Open a workflow to deploy it"
              : canvas.undeployed
                ? "Make the current draft live on the webhook endpoint"
                : "The live version matches the draft"
          }
          type="button"
        >
          <Icon name={canvas.deploying ? "progress_activity" : "cloud_upload"} className={`text-body-md ${canvas.deploying ? "animate-spin" : ""}`} />
          <span>{canvas.deploying ? "Deploying…" : onCanvas && !canvas.undeployed ? "Deployed" : "Deploy"}</span>
        </button>
        <button
          className="flex items-center gap-space-xs px-space-md py-space-xs rounded bg-primary text-on-primary hover:bg-primary-container font-body-sm text-body-sm font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none"
          disabled={!onCanvas || canvas.running}
          onClick={() => sendCanvasCommand("run")}
          title={onCanvas ? `Run the draft with a sample payload in ${env.label}` : "Open a workflow to run it"}
          type="button"
        >
          <Icon name={canvas.running ? "progress_activity" : "play_arrow"} className={`text-body-md ${canvas.running ? "animate-spin" : ""}`} />
          <span>{canvas.running ? "Running…" : "Run Workflow"}</span>
          {canvas.running && <span className="w-2 h-2 rounded-full bg-on-primary animate-ping" />}
        </button>
        <div className="flex items-center gap-space-xs pl-space-xs">
          <span
            className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-label-md flex items-center justify-center"
            title="Profile"
          >
            PS
          </span>
        </div>
      </div>
    </div>
  );
}
