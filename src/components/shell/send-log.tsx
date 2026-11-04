"use client";

import Link from "next/link";
import { useState } from "react";
import { ago, shortId, utcTime } from "@/components/executions/format";
import { Icon } from "@/components/icon";
import type { SendRecord } from "@/lib/collections/history";
import { ENVIRONMENT_LABELS } from "@/lib/environment";

const LEVEL_TONE: Record<string, string> = {
  log: "text-on-surface",
  info: "text-secondary",
  warn: "text-tertiary",
  error: "text-error",
};

function statusTone(send: SendRecord) {
  if (send.error || send.status === null) return { dot: "bg-error", badge: "bg-error-container text-on-error-container", label: "ERROR" };
  if (send.status >= 400) return { dot: "bg-error", badge: "bg-error-container text-on-error-container", label: String(send.status) };
  if (send.tests.passed < send.tests.total || (send.scripts?.errors.length ?? 0) > 0) {
    return { dot: "bg-tertiary", badge: "bg-tertiary-container text-on-tertiary-container", label: String(send.status) };
  }
  return { dot: "bg-primary", badge: "bg-surface-container-highest text-primary", label: String(send.status) };
}

/** Collections sends: list on the left, the selected send's tests and script output on the right. */
export function SendLog({ sends, now, loading }: { sends: SendRecord[]; now: number; loading: boolean }) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const selected = sends.find((s) => s.id === pinnedId) ?? sends[0];

  if (sends.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-space-xs text-outline font-body-sm text-body-sm p-space-md text-center">
        {loading ? (
          <>
            <Icon name="progress_activity" className="animate-spin text-headline-sm" /> Loading requests…
          </>
        ) : (
          <>
            <Icon name="send" className="text-headline-md" />
            <span className="text-on-surface-variant">No requests sent yet</span>
            <span>Requests you send from Collections &amp; Requests appear here with their tests and script output.</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      <ul className="w-80 shrink-0 overflow-y-auto overscroll-contain bg-surface-container-lowest/40 p-space-xs flex flex-col gap-space-xxs">
        {sends.map((send) => {
          const tone = statusTone(send);
          const active = send.id === selected?.id;
          return (
            <li key={send.id}>
              <button
                aria-pressed={active}
                className={`w-full text-left rounded px-space-sm py-space-xs transition-colors ${active ? "bg-surface-container-high" : "hover:bg-surface-container"}`}
                onClick={() => setPinnedId(send.id)}
                type="button"
              >
                <div className="flex items-center gap-space-xs">
                  <span className={`w-2 h-2 shrink-0 rounded-full ${tone.dot}`} />
                  <span className="font-label-sm text-label-sm font-mono font-bold text-secondary shrink-0">{send.method}</span>
                  <span className={`font-label-md text-label-md truncate ${active ? "text-primary" : "text-on-surface"}`}>{send.name}</span>
                  <span className={`px-space-xs rounded font-label-sm text-label-sm font-mono font-bold shrink-0 ${tone.badge}`}>{tone.label}</span>
                  <span className="ml-auto font-label-sm text-label-sm text-outline font-mono shrink-0">{ago(send.sentAt, now)}</span>
                </div>
                <div className="mt-space-xxs flex items-center gap-space-sm font-label-sm text-label-sm text-outline">
                  <span className="font-mono text-on-surface-variant shrink-0">{send.durationMs}ms</span>
                  {send.tests.total > 0 && (
                    <span className={`shrink-0 whitespace-nowrap ${send.tests.passed === send.tests.total ? "text-primary" : "text-tertiary"}`}>
                      tests {send.tests.passed}/{send.tests.total}
                    </span>
                  )}
                  <span className="truncate font-mono min-w-0">{send.url}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {selected && <SendDetail send={selected} />}
    </div>
  );
}

function SendDetail({ send }: { send: SendRecord }) {
  const tone = statusTone(send);
  const env = ENVIRONMENT_LABELS[send.environment];
  const scripts = send.scripts;
  const envChanges = Object.entries(scripts?.environment ?? {});
  const vars = Object.entries(scripts?.variables ?? {});

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-space-sm flex-wrap px-space-md py-space-xs shrink-0 font-label-sm text-label-sm text-outline">
        <span className="font-label-md text-label-md font-mono text-on-surface font-semibold">{shortId(send.id)}</span>
        <span className={`px-space-xs rounded font-mono font-bold ${tone.badge}`}>
          {send.status === null ? "ERROR" : `${send.status} ${send.statusText ?? ""}`.trim()}
        </span>
        <span className="text-on-surface-variant">{send.name}</span>
        <span className={env.tone}>{env.label}</span>
        <span className="font-mono">{utcTime(send.sentAt)}</span>
        <span className="font-mono text-on-surface-variant">{send.durationMs}ms</span>
        {send.size !== null && <span className="font-mono">{send.size} B</span>}
        {send.requestId && send.collectionId && (
          <Link className="text-primary hover:underline flex items-center gap-space-xxs" href={`/collections?request=${send.requestId}`}>
            Open request <Icon name="open_in_new" className="text-body-sm" />
          </Link>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain px-space-md pb-space-sm flex flex-col gap-space-sm font-mono font-label-sm text-label-sm">
        <div className="text-on-surface-variant break-all">
          <span className="text-secondary font-bold">{send.method}</span> {send.url}
        </div>
        {send.error && (
          <div role="alert" className="p-space-xs rounded bg-error-container/30 text-on-error-container break-all">
            {send.error}
          </div>
        )}

        {scripts?.errors.map((e, i) => (
          <div key={`e${i}`} className="p-space-xs rounded bg-error-container/20 text-error break-all">
            {e.phase === "pre" ? "Pre-request" : "Post-response"} script error ({e.scope} “{e.source}”): {e.message}
          </div>
        ))}

        {(scripts?.tests.length ?? 0) > 0 && (
          <Section title={`Script tests ${scripts!.tests.filter((t) => t.passed).length}/${scripts!.tests.length}`}>
            {scripts!.tests.map((t, i) => (
              <div key={i} className="flex gap-space-xs">
                <span className={t.passed ? "text-primary" : "text-error font-bold"}>{t.passed ? "PASS" : "FAIL"}</span>
                <span className="text-on-surface">{t.name}</span>
                {t.error && <span className="text-error truncate">— {t.error}</span>}
              </div>
            ))}
          </Section>
        )}

        {(scripts?.logs.length ?? 0) > 0 && (
          <Section title="Console">
            {scripts!.logs.map((l, i) => (
              <div key={i} className={`flex gap-space-xs ${LEVEL_TONE[l.level] ?? ""}`}>
                <span className="w-10 shrink-0 uppercase opacity-70">{l.level}</span>
                <span className="flex-1 whitespace-pre-wrap break-all">{l.message}</span>
                <span className="text-outline shrink-0">{l.scope}</span>
              </div>
            ))}
          </Section>
        )}

        {envChanges.length > 0 && (
          <Section title="Environment updated">
            {envChanges.map(([k, v]) => (
              <div key={k} className="flex gap-space-sm">
                <span className="text-tertiary">{k}</span>
                <span className={v === null ? "text-outline italic" : "text-on-surface break-all"}>{v === null ? "unset" : v}</span>
              </div>
            ))}
          </Section>
        )}

        {vars.length > 0 && (
          <Section title="Variables {{vars.*}}">
            {vars.map(([k, v]) => (
              <div key={k} className="flex gap-space-sm">
                <span className="text-tertiary">{k}</span>
                <span className="text-on-surface break-all">{v}</span>
              </div>
            ))}
          </Section>
        )}

        {!send.error && !scripts?.errors.length && !scripts?.logs.length && !scripts?.tests.length && send.tests.total === 0 && (
          <span className="text-outline font-body-sm text-body-sm">No tests or script output for this send.</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-outline uppercase tracking-wider mb-0.5">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
