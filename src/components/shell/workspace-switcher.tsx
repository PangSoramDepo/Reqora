"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { createWorkspace, switchWorkspace, useWorkspaces } from "@/lib/workspaces/client";
import { ROLE_LABELS } from "@/lib/workspaces/schema";

const ITEM = "w-full flex items-center gap-space-xs px-space-sm py-space-xs rounded text-left font-body-sm text-body-sm hover:bg-surface-container-highest";

/** The active workspace in the top bar: switch between workspaces, create one, or open its settings. */
export function WorkspaceSwitcher() {
  const { state, current } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const workspace = await createWorkspace(name.trim());
      // Creating also made it active; show it.
      await switchWorkspace(workspace.id);
    });

  return (
    <div ref={rootRef} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-space-xxs px-space-xs py-space-xxs rounded hover:bg-surface-container-high text-on-surface font-body-sm text-body-sm max-w-56"
        onClick={() => setOpen((v) => !v)}
        title="Switch workspace"
        type="button"
        data-testid="workspace-switcher"
      >
        <Icon name="workspaces" className="text-body-md text-primary" />
        <span className="truncate font-medium">{current?.name ?? "…"}</span>
        {current?.role === "viewer" && (
          <span className="shrink-0 px-1 rounded bg-surface-container-highest text-tertiary font-label-sm text-label-sm" title={ROLE_LABELS.viewer.description}>
            VIEW ONLY
          </span>
        )}
        <Icon name="unfold_more" className="text-body-md text-outline" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-space-xs w-72 z-50 p-space-xs rounded-xl bg-surface-container-high shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] border border-outline-variant/30"
        >
          <div className="px-space-sm pt-space-xxs pb-space-xs font-label-sm text-label-sm text-outline uppercase tracking-wider">Workspaces</div>
          <div className="max-h-72 overflow-y-auto">
            {state?.data.map((w) => (
              <button
                key={w.id}
                role="menuitemradio"
                aria-checked={w.id === state.active}
                className={`${ITEM} ${w.id === state.active ? "text-primary" : "text-on-surface"}`}
                disabled={busy}
                onClick={() => (w.id === state.active ? setOpen(false) : run(() => switchWorkspace(w.id)))}
                type="button"
              >
                <Icon name={w.id === state.active ? "check" : "workspaces"} className="text-body-md shrink-0" />
                <span className="truncate flex-1">{w.name}</span>
                <span className="shrink-0 font-label-sm text-label-sm text-outline">
                  {ROLE_LABELS[w.role].label} · {w.memberCount}
                  <Icon name="person" className="text-[12px] align-middle" />
                </span>
              </button>
            ))}
          </div>
          <div className="h-px bg-outline-variant/30 my-space-xs" />
          {creating ? (
            <form
              className="flex items-center gap-space-xs px-space-xs"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void create();
              }}
            >
              <input
                autoFocus
                aria-label="New workspace name"
                className="flex-1 min-w-0 px-space-xs py-space-xxs rounded bg-surface-container-lowest font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40"
                maxLength={80}
                placeholder="Workspace name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="px-space-sm py-space-xxs rounded bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
                disabled={busy || !name.trim()}
                type="submit"
              >
                Create
              </button>
            </form>
          ) : (
            <button className={`${ITEM} text-on-surface`} onClick={() => setCreating(true)} type="button">
              <Icon name="add" className="text-body-md" /> New workspace
            </button>
          )}
          <Link href="/workspace" className={`${ITEM} text-on-surface`} onClick={() => setOpen(false)}>
            <Icon name="group" className="text-body-md" /> Members & settings
          </Link>
          {error && <div className="px-space-sm pt-space-xs font-body-sm text-body-sm text-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
