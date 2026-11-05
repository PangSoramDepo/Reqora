import { Icon } from "@/components/icon";
import type { RepeatCheck } from "@/lib/workflows/schema";

/** One line per "repeat until" check: met or not (or the script error), plus what the script logged. */
export function RepeatChecks({ checks, attempts }: { checks: RepeatCheck[]; attempts?: number }) {
  const hidden = (attempts ?? checks.length) - checks.length;
  return (
    <div className="flex flex-col gap-space-xxs" data-testid="repeat-checks">
      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider flex items-center gap-1">
        <Icon name="autorenew" className="text-body-sm text-tertiary" /> Repeat until checks
        {hidden > 0 && <span className="normal-case tracking-normal">(last {checks.length} of {attempts})</span>}
      </span>
      <ol className="flex flex-col gap-px rounded bg-surface-container-lowest p-space-xs font-mono text-[11px] max-h-48 overflow-auto">
        {checks.map((c) => (
          <li key={c.attempt} className="flex flex-col">
            <span className={c.error ? "text-error" : c.met ? "text-primary" : "text-on-surface-variant"}>
              #{c.attempt} {c.error ? `error — ${c.error}` : c.met ? "met → continue" : "not met → retry"}
            </span>
            {c.logs?.map((line, i) => (
              <span key={i} className="pl-space-sm text-outline whitespace-pre-wrap break-all">
                {line}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Plain-text lines for a log view. */
export function repeatCheckLines(checks: RepeatCheck[]): string[] {
  return checks.flatMap((c) => [
    `        ↻ #${c.attempt} ${c.error ? `error — ${c.error}` : c.met ? "met" : "not met"}`,
    ...(c.logs ?? []).map((l) => `            ${l}`),
  ]);
}

/** A script node's console output. */
export function ScriptLogs({ logs }: { logs: string[] }) {
  return (
    <div className="flex flex-col gap-space-xxs" data-testid="script-logs">
      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider flex items-center gap-1">
        <Icon name="terminal" className="text-body-sm text-tertiary" /> Console
      </span>
      <ol className="flex flex-col gap-px rounded bg-surface-container-lowest p-space-xs font-mono text-[11px] max-h-48 overflow-auto">
        {logs.map((line, i) => (
          <li key={i} className={`whitespace-pre-wrap break-all ${line.startsWith("[error]") ? "text-error" : line.startsWith("[warn]") ? "text-tertiary" : "text-on-surface-variant"}`}>
            {line}
          </li>
        ))}
      </ol>
    </div>
  );
}
