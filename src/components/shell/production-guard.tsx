"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";
import { setEnvironment } from "@/lib/environment";
import type { Environment } from "@/lib/workflows/schema";

type Ask = { action: string; resolve: (ok: boolean) => void };

const EVENT = "reqora:confirm-production";
/** Set for the rest of the tab session after "Don't ask again in this tab". */
const SKIP_KEY = "reqora:production-confirmed";

/**
 * Asks before something runs against Production (live APIs, production secrets). Resolves true right away for
 * other environments, or when the user chose not to be asked again in this tab. `action` names what's about to
 * happen, e.g. "Run “Checkout”".
 */
export function confirmProduction(environment: Environment, action: string): Promise<boolean> {
  if (environment !== "production") return Promise.resolve(true);
  try {
    if (sessionStorage.getItem(SKIP_KEY) === "1") return Promise.resolve(true);
  } catch {
    // Storage unavailable: ask every time.
  }
  return new Promise((resolve) => {
    const event = new CustomEvent<Ask>(EVENT, { detail: { action, resolve }, cancelable: true });
    // The dialog (mounted in the app shell) takes it; without one, fall back to the browser's confirm.
    if (window.dispatchEvent(event)) resolve(window.confirm(`${action} in Production? It uses Production variables and calls your live APIs.`));
  });
}

/** The confirmation dialog behind confirmProduction(); mounted once in the app shell. */
export function ProductionGuard() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const onAsk = (e: Event) => {
      e.preventDefault();
      setRemember(false);
      setAsk((e as CustomEvent<Ask>).detail);
    };
    window.addEventListener(EVENT, onAsk);
    return () => window.removeEventListener(EVENT, onAsk);
  }, []);

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ask.resolve(false);
        setAsk(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask]);

  if (!ask) return null;
  const answer = (ok: boolean) => {
    if (ok && remember) {
      try {
        sessionStorage.setItem(SKIP_KEY, "1");
      } catch {
        // Ignore: they'll be asked again.
      }
    }
    ask.resolve(ok);
    setAsk(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm" onMouseDown={() => answer(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="production-guard-title"
        data-testid="production-guard"
        className="w-[440px] max-w-[calc(100vw-2rem)] rounded-xl bg-surface-container-high border-t-4 border-tertiary shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] p-space-lg flex flex-col gap-space-md"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-space-sm">
          <span className="h-10 w-10 shrink-0 rounded-full bg-tertiary/15 flex items-center justify-center">
            <Icon name="warning" className="text-tertiary text-headline-md" />
          </span>
          <div className="flex flex-col gap-space-xxs">
            <h2 id="production-guard-title" className="font-headline-sm text-headline-sm text-on-surface">
              {ask.action} in Production?
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              This uses <span className="text-tertiary font-semibold">Production</span> variables and secrets and calls your live APIs. Real
              data may change.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant cursor-pointer">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Don&apos;t ask again in this tab
        </label>
        <div className="flex flex-wrap items-center justify-end gap-space-xs">
          <button
            type="button"
            className="mr-auto font-label-md text-label-md text-primary hover:underline"
            onClick={() => {
              setEnvironment("sandbox");
              answer(false);
            }}
            title="Switch the top bar to Sandbox; run again from there"
          >
            Switch to Sandbox
          </button>
          <button
            type="button"
            autoFocus
            className="px-space-md py-space-xs rounded bg-surface-container-highest hover:bg-surface-bright text-on-surface font-body-sm text-body-sm"
            onClick={() => answer(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-space-md py-space-xs rounded bg-tertiary text-on-tertiary hover:bg-tertiary-container font-body-sm text-body-sm font-semibold"
            onClick={() => answer(true)}
          >
            Yes, use Production
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
