"use client";

import { Icon } from "@/components/icon";
import { NumberField } from "@/components/number-field";
import { ScriptCodeEditor } from "@/components/collections/script-code-editor";
import { conditionOperators, MAX_REPEAT_WAIT_MS, type RepeatUntil, type WorkflowNode } from "@/lib/workflows/schema";
import { TemplateField } from "./template-field";

type HttpNode = Extract<WorkflowNode, { type: "http" }>;

const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const FIELD =
  "min-w-0 px-space-sm py-space-xs rounded bg-surface-container-lowest font-mono text-body-sm text-on-surface shadow-inner focus:outline-none focus:ring-1 focus:ring-primary";

const SCRIPT_TEMPLATE = `// Return true when the flow should continue. For example, find an item in a list:
// const item = response.body.data.find((i) => i.id === rq.environment.get("id"));
// return item !== undefined && item.status === 2;
return response.body.status === "COMPLETED";`;

/** Most attempts that fit in the maximum wait for an interval. */
const attemptsCap = (intervalMs: number) => Math.min(100, Math.floor(MAX_REPEAT_WAIT_MS / intervalMs) + 1);

/**
 * "Repeat until": the node sends again on an interval until a condition on its own response is true — for
 * polling a status before the flow moves on.
 */
export function RepeatUntilEditor({ node, onChange }: { node: HttpNode; onChange: (n: WorkflowNode) => void }) {
  const repeat = node.config.repeat;
  const set = (next: RepeatUntil | undefined) => {
    const { repeat: _old, ...config } = node.config;
    void _old;
    onChange({ ...node, config: next ? { ...config, repeat: next } : config });
  };
  const patch = (change: Partial<RepeatUntil>) => {
    if (!repeat) return;
    const next = { ...repeat, ...change };
    next.maxAttempts = Math.min(next.maxAttempts, attemptsCap(next.intervalMs));
    set(next);
  };

  return (
    <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container/60 p-space-sm" data-testid="repeat-until">
      <label className="flex items-center gap-space-xs cursor-pointer">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-primary cursor-pointer"
          checked={!!repeat}
          onChange={(e) =>
            set(
              e.target.checked
                ? { mode: "compare", left: `{{${node.id}.body.status}}`, operator: "==", right: "", intervalMs: 2_000, maxAttempts: 10 }
                : undefined,
            )
          }
        />
        <Icon name="autorenew" className="text-body-md text-tertiary" />
        <span className="font-label-md text-label-md text-on-surface font-semibold">Repeat until</span>
      </label>
      {!repeat ? (
        <span className="font-body-sm text-body-sm text-outline">
          Poll: send this request again until its response matches a condition, then continue the flow.
        </span>
      ) : (
        <>
          <div role="radiogroup" aria-label="Condition type" className="flex rounded bg-surface-container-lowest p-0.5 font-label-sm text-label-sm">
            {(
              [
                ["compare", "Compare a value"],
                ["script", "Script"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={repeat.mode === mode}
                onClick={() => patch(mode === "script" && !repeat.script ? { mode, script: SCRIPT_TEMPLATE } : { mode })}
                className={`flex-1 py-1 rounded ${repeat.mode === mode ? "bg-surface-container-highest text-primary font-semibold" : "text-on-surface-variant hover:text-on-surface"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {repeat.mode === "script" ? (
            <>
              <div className="h-44 flex flex-col rounded overflow-hidden shadow-inner bg-surface-container-lowest" data-testid="repeat-script">
                <ScriptCodeEditor
                  key={node.id}
                  phase="post"
                  label="Repeat until script"
                  wrap
                  value={repeat.script ?? ""}
                  onValue={(script) => patch({ script })}
                />
              </div>
              <span className="font-body-sm text-body-sm text-outline">
                Return <span className="text-primary font-mono">true</span> when done. <span className="text-primary font-mono">response.body</span>{" "}
                is the parsed response; <span className="text-primary font-mono">rq.environment.get()</span>,{" "}
                <span className="text-primary font-mono">rq.variables</span>, <span className="text-primary font-mono">pm</span> and{" "}
                <span className="text-primary font-mono">_</span> (lodash) work like in request scripts.
              </span>
            </>
          ) : (
            <>
          <span className={LABEL}>Value to check</span>
          <TemplateField aria-label="Repeat until value" mode="value" className={`${FIELD} w-full`} value={repeat.left} placeholder={`{{${node.id}.body.status}}`} onChange={(left) => patch({ left })} />
          <div className="flex gap-space-xs">
            <select
              aria-label="Repeat until operator"
              className={`${FIELD} w-24 shrink-0`}
              value={repeat.operator}
              onChange={(e) => patch({ operator: e.target.value as RepeatUntil["operator"] })}
            >
              {conditionOperators.map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            {repeat.operator !== "exists" && (
              <TemplateField
                aria-label="Repeat until expected value"
                mode="value"
                className={`${FIELD} w-full`}
                placeholder="expected, e.g. COMPLETED"
                value={repeat.right ?? ""}
                onChange={(right) => patch({ right })}
              />
            )}
          </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-space-xs">
            <label className="flex flex-col gap-space-xxs">
              <span className={LABEL}>Every (seconds)</span>
              <NumberField
                className={`${FIELD} w-full`}
                label="Repeat interval seconds"
                value={repeat.intervalMs / 1000}
                min={0.1}
                max={60}
                step={0.5}
                onCommit={(seconds) => patch({ intervalMs: Math.round(seconds * 1000) })}
              />
            </label>
            <label className="flex flex-col gap-space-xxs">
              <span className={LABEL}>Max attempts</span>
              <NumberField
                className={`${FIELD} w-full`}
                label="Repeat max attempts"
                value={repeat.maxAttempts}
                min={2}
                max={attemptsCap(repeat.intervalMs)}
                integer
                onCommit={(maxAttempts) => patch({ maxAttempts })}
              />
            </label>
          </div>
          <span className="font-body-sm text-body-sm text-outline">
            Checks the response after each send. When it matches, the flow continues; after {repeat.maxAttempts} attempts (about{" "}
            {formatDuration(repeat.intervalMs * (repeat.maxAttempts - 1))}) without a match, the step fails. Use{" "}
            <span className="text-primary font-mono">{`{{${node.id}.body.…}}`}</span> for this node&apos;s latest response.
          </span>
        </>
      )}
    </div>
  );
}

function formatDuration(ms: number) {
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
