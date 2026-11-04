import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import type { NodeType, Step, WorkflowNode } from "@/lib/workflows/schema";

type TypeStyle = { icon: string; tag: string; bar: string; text: string; dot: string; minimap: string };

/** Category colours follow the design system's node semantic spectrum. */
export const TYPE_STYLE: Record<NodeType, TypeStyle> = {
  webhook: { icon: "webhook", tag: "EVENT", bar: "bg-secondary", text: "text-secondary", dot: "bg-secondary", minimap: "bg-secondary" },
  http: { icon: "http", tag: "REST", bar: "bg-primary-container", text: "text-primary", dot: "bg-primary", minimap: "bg-primary-container" },
  condition: { icon: "call_split", tag: "EXPR", bar: "bg-secondary-fixed-dim", text: "text-secondary-fixed-dim", dot: "bg-secondary-fixed-dim", minimap: "bg-secondary-fixed" },
  transform: { icon: "transform", tag: "TRANS", bar: "bg-tertiary", text: "text-tertiary", dot: "bg-tertiary", minimap: "bg-tertiary" },
  delay: { icon: "hourglass_top", tag: "WAIT", bar: "bg-outline", text: "text-outline", dot: "bg-outline", minimap: "bg-outline" },
  response: { icon: "output_circle", tag: "EXIT", bar: "bg-error", text: "text-error", dot: "bg-error", minimap: "bg-error" },
};

const HEADER = "p-space-sm flex items-center justify-between";
const BODY = "p-space-sm flex flex-col gap-space-xs font-body-sm text-body-sm";
const FOOTER = "px-space-sm py-space-xs bg-surface-container-lowest/30 rounded-b-xl relative font-label-sm text-label-sm";
const INSET = "px-space-xs py-space-xxs rounded bg-surface-container-lowest";
const CODE = "p-space-xs rounded bg-surface-container-lowest font-mono text-[10px] leading-tight text-on-surface/80 overflow-hidden";

/** Connection terminal; `data-port` lets the canvas measure where to attach edges. */
function Port({ name, color, className, title }: { name: string; color: string; className: string; title?: string }) {
  return (
    <div
      data-port={name}
      className={`w-3.5 h-3.5 rounded-full ${color} shadow-md absolute flex items-center justify-center hover:scale-125 transition-transform z-30 ${
        name === "in" ? "cursor-default" : "cursor-crosshair"
      } ${className}`}
      title={title}
    >
      <div className="w-1.5 h-1.5 rounded-full bg-surface-container-lowest" />
    </div>
  );
}

function MethodPill({ method }: { method: string }) {
  return (
    <span className="px-space-xs py-space-xxs rounded bg-primary text-on-primary font-label-sm text-label-sm font-bold">
      {method}
    </span>
  );
}

function StatusBadge({ node, step, running, waiting }: { node: WorkflowNode; step?: Step; running?: boolean; waiting?: boolean }) {
  const style = TYPE_STYLE[node.type];
  const base = "font-label-sm text-label-sm px-space-xs py-space-xxs rounded font-semibold";
  if (running) {
    return (
      <span className={`${base} bg-primary/20 text-primary flex items-center gap-1`}>
        <Icon name="progress_activity" className="animate-spin text-[12px]" /> RUNNING
      </span>
    );
  }
  if (waiting) return <span className={`${base} bg-surface-container-highest text-outline`}>WAITING</span>;
  if (!step) return <span className={`${base} bg-surface-container-highest ${style.text}`}>{style.tag}</span>;
  if (step.status === "skipped") return <span className={`${base} bg-surface-container-highest text-outline`}>SKIPPED</span>;
  if (step.status === "failed") return <span className={`${base} bg-error-container text-on-error-container`}>FAILED</span>;
  return <span className={`${base} bg-primary/20 text-primary`}>OK · {step.durationMs}ms</span>;
}

function preview(value: unknown, lines = 4) {
  const text = JSON.stringify(value, null, 2) ?? "";
  const all = text.split("\n");
  return all.length > lines ? [...all.slice(0, lines), "  …"].join("\n") : text;
}

function placeholders(template = "") {
  return [...new Set([...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]))].slice(0, 3);
}

function WebhookBody({ node, step }: { node: Extract<WorkflowNode, { type: "webhook" }>; step?: Step }) {
  const payload = (step?.output as { body?: unknown } | undefined)?.body;
  return (
    <>
      <div className={`${BODY} text-on-surface-variant`}>
        <div className="flex items-center justify-between">
          <span className="px-space-xs py-space-xxs rounded bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold">
            {node.config.method}
          </span>
          <span className="font-mono text-outline truncate">{node.config.path}</span>
        </div>
        <pre className={CODE}>
          {payload === undefined ? "// Awaiting first event" : `// Last event\n${preview(payload)}`}
        </pre>
      </div>
      <div className={`${FOOTER} flex items-center justify-end`}>
        <span className="text-on-surface-variant mr-3">trigger.body</span>
        <Port name="out" color="bg-secondary" className="-right-2" title="Output: trigger payload" />
      </div>
    </>
  );
}

function HttpBody({ node, step }: { node: Extract<WorkflowNode, { type: "http" }>; step?: Step }) {
  const auth = Object.entries(node.config.headers).find(([name]) => name.toLowerCase() === "authorization");
  const response = step?.output as { status?: number } | undefined;
  const refs = placeholders(node.config.body);
  return (
    <>
      <div className={BODY}>
        <div className="flex items-center gap-space-xs">
          <MethodPill method={node.config.method} />
          <span className="font-mono text-outline truncate text-body-sm" title={node.config.url}>
            {node.config.url}
          </span>
        </div>
        {auth && (
          <div className={`flex items-center justify-between gap-space-xs ${INSET} font-label-sm text-label-sm`}>
            <span className="text-outline">{auth[0]}</span>
            <span className="text-tertiary font-mono truncate">{auth[1]}</span>
          </div>
        )}
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {refs.map((ref) => (
              <span key={ref} className="px-space-xs py-0.5 rounded bg-surface-container-lowest text-tertiary font-mono text-[10px]">
                {`{{${ref}}}`}
              </span>
            ))}
          </div>
        )}
        {step && step.status !== "skipped" && (
          <div className={`flex items-center justify-between ${INSET}`}>
            <div className="flex items-center gap-space-xxs min-w-0">
              <span className={`w-2 h-2 shrink-0 rounded-full ${step.status === "failed" ? "bg-error" : "bg-primary"}`} />
              <span className="font-label-sm text-label-sm text-on-surface font-semibold truncate" title={step.error}>
                {response?.status ?? step.error}
              </span>
            </div>
            <span className="font-mono text-outline text-body-sm">{step.durationMs}ms</span>
          </div>
        )}
      </div>
      <div className={`${FOOTER} flex items-center justify-end`}>
        <span className="text-on-surface-variant mr-3">{node.id}.body</span>
        <Port name="out" color="bg-primary" className="-right-2" title="Output: response" />
      </div>
    </>
  );
}

function ConditionBody({ node, step }: { node: Extract<WorkflowNode, { type: "condition" }>; step?: Step }) {
  const { left, operator, right } = node.config;
  return (
    <>
      <div className={BODY}>
        <div className={`${INSET} font-mono text-on-surface break-all`}>
          <span className="text-primary">{left}</span> <span className="text-tertiary font-bold">{operator}</span>{" "}
          {operator !== "exists" && <span className="text-secondary-fixed">{right}</span>}
        </div>
        <div className="text-[10px] text-outline">
          {step?.port ? `Last run: ${step.port.toUpperCase()}` : "Evaluates to Boolean state"}
        </div>
      </div>
      <div className={`${FOOTER} flex flex-col gap-1.5`}>
        {(["true", "false"] as const).map((port) => (
          <div key={port} className="flex items-center justify-between relative">
            <span className={port === "true" ? "text-tertiary font-bold" : "text-outline"}>
              {port.toUpperCase()}
              {step?.port === port && " ●"}
            </span>
            <Port name={port} color={port === "true" ? "bg-tertiary" : "bg-outline"} className="-right-5" />
          </div>
        ))}
      </div>
    </>
  );
}

function SimpleBody({ node, children }: { node: WorkflowNode; children: ReactNode }) {
  return (
    <>
      <div className={BODY}>{children}</div>
      <div className={`${FOOTER} flex items-center justify-end min-h-6`}>
        {node.type !== "response" && (
          <>
            <span className="text-on-surface-variant mr-3">{node.id}</span>
            <Port name="out" color={TYPE_STYLE[node.type].dot} className="-right-2" />
          </>
        )}
      </div>
    </>
  );
}

function NodeBody({ node, step }: { node: WorkflowNode; step?: Step }) {
  switch (node.type) {
    case "webhook":
      return <WebhookBody node={node} step={step} />;
    case "http":
      return <HttpBody node={node} step={step} />;
    case "condition":
      return <ConditionBody node={node} step={step} />;
    case "transform":
      return (
        <SimpleBody node={node}>
          {Object.entries(node.config.output).map(([key, template]) => (
            <div key={key} className={`${INSET} font-mono truncate`}>
              <span className="text-primary">{key}</span>: <span className="text-tertiary">{template}</span>
            </div>
          ))}
        </SimpleBody>
      );
    case "delay":
      return (
        <SimpleBody node={node}>
          <span className="font-mono text-on-surface">Wait {node.config.ms}ms</span>
        </SimpleBody>
      );
    case "response":
      return (
        <SimpleBody node={node}>
          <span className="font-mono text-on-surface">HTTP {node.config.status}</span>
          {node.config.body && <pre className={CODE}>{node.config.body}</pre>}
        </SimpleBody>
      );
  }
}

export function NodeCard({
  node,
  step,
  selected,
  running,
  waiting,
}: {
  node: WorkflowNode;
  step?: Step;
  selected: boolean;
  /** This node is executing right now in a live run. */
  running?: boolean;
  /** A live run hasn't reached this node yet. */
  waiting?: boolean;
}) {
  const style = TYPE_STYLE[node.type];
  return (
    <>
      <div className={`${selected ? "h-1.5" : "h-1"} ${style.bar} rounded-t-xl w-full`} />
      {node.type !== "webhook" && <Port name="in" color={style.dot} className="-left-2 top-[60px]" title="Input" />}
      <div className={`${HEADER} ${selected ? "bg-surface-container-highest/60" : "bg-surface-container-lowest/40"}`}>
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name={style.icon} className={`${style.text} text-headline-sm`} />
          <span className="font-headline-sm text-headline-sm text-on-surface truncate">{node.name}</span>
          {node.type === "http" && node.config.requestId && (
            <span title="Linked to a Collections request — edits there apply on every run" className="shrink-0 flex">
              <Icon name="link" className="text-outline text-body-md" />
            </span>
          )}
        </div>
        <StatusBadge node={node} step={step} running={running} waiting={waiting} />
      </div>
      <NodeBody node={node} step={step} />
    </>
  );
}
