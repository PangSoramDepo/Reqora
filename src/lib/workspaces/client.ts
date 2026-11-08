"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/workflows/client";
import type { Member, Role, Workspace } from "./schema";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new ApiError(response.status, problem.detail ?? problem.title ?? response.statusText);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export type WorkspacesState = { data: Workspace[]; active: string };

export const fetchWorkspaces = () => call<WorkspacesState>("/api/workspaces");
export const createWorkspace = (name: string) => call<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
export const renameWorkspace = (id: string, name: string) =>
  call<Workspace>(`/api/workspaces/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const deleteWorkspace = (id: string) => call<void>(`/api/workspaces/${id}`, { method: "DELETE" });
export const selectWorkspace = (id: string) => call<Workspace>(`/api/workspaces/${id}/select`, { method: "POST" });
export const fetchMembers = (id: string) => call<{ data: Member[] }>(`/api/workspaces/${id}/members`).then((r) => r.data);
export const addMember = (id: string, input: { email: string; role: Role; name?: string; password?: string }) =>
  call<Member & { accountCreated: boolean }>(`/api/workspaces/${id}/members`, { method: "POST", body: JSON.stringify(input) });
export const setMemberRole = (id: string, userId: string, role: Role) =>
  call<Member>(`/api/workspaces/${id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
export const removeMember = (id: string, userId: string) => call<void>(`/api/workspaces/${id}/members/${userId}`, { method: "DELETE" });

/** Window event fired after the workspace list or the active workspace changed in this tab. */
export const WORKSPACES_CHANGED_EVENT = "reqora:workspaces-changed";

// One request shared by every component showing workspace info on the page.
let pending: Promise<WorkspacesState> | undefined;
function load(fresh = false) {
  if (!pending || fresh) pending = fetchWorkspaces().catch((e) => ((pending = undefined), Promise.reject(e)));
  return pending;
}

/** The signed-in user's workspaces and the active one (with their role in it). */
export function useWorkspaces() {
  const [state, setState] = useState<WorkspacesState | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = (fresh: boolean) =>
      load(fresh)
        .then((s) => live && setState(s))
        .catch(() => undefined);
    void refresh(false);
    const onChange = () => void refresh(true);
    window.addEventListener(WORKSPACES_CHANGED_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(WORKSPACES_CHANGED_EVENT, onChange);
    };
  }, []);
  const current = state?.data.find((w) => w.id === state.active);
  return { state, current, role: current?.role };
}

export const workspacesChanged = () => window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));

/**
 * Switches the app to another workspace. Everything on screen belongs to the old one, so the page reloads —
 * on the section's start page when it showed one item (a flow).
 */
export async function switchWorkspace(id: string) {
  await selectWorkspace(id);
  const path = window.location.pathname.startsWith("/flow/") ? "/flow" : window.location.pathname;
  window.location.assign(path);
}

/**
 * Makes the workspace of an item opened by link the active one (when the user belongs to it), so the sidebar
 * lists match what's on screen. Reloads only when it had to switch.
 */
export async function followWorkspace(workspaceId: string) {
  const state = await load();
  if (state.active === workspaceId || !state.data.some((w) => w.id === workspaceId)) return;
  await selectWorkspace(workspaceId);
  window.location.reload();
}
