"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/workflows/client";
import type { Environment } from "@/lib/workflows/schema";
import type { ColumnKind, TestUser, TestUserColumn, TestUserSettings, TestUsersResponse } from "./schema";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string; title?: string; issues?: { path: string; message: string }[] };
    const issues = problem.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new ApiError(response.status, [problem.detail ?? problem.title ?? response.statusText, issues].filter(Boolean).join(" — "));
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const base = (env: Environment) => `/api/environments/${env}`;

export const fetchTestUsers = (env: Environment) => call<TestUsersResponse>(`${base(env)}/test-users`);
export const createTestUser = (env: Environment, input: { name: string; roles: string[]; values?: Record<string, string | null> }) =>
  call<TestUser>(`${base(env)}/test-users`, { method: "POST", body: JSON.stringify(input) });
export const patchTestUser = (id: string, patch: { name?: string; roles?: string[]; values?: Record<string, string | null> }) =>
  call<TestUser>(`/api/test-users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteTestUser = (id: string) => call<void>(`/api/test-users/${id}`, { method: "DELETE" });
export const putColumn = (env: Environment, name: string, kind: ColumnKind) =>
  call<TestUserColumn>(`${base(env)}/test-user-columns/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ kind }) });
export const deleteColumn = (env: Environment, name: string) =>
  call<void>(`${base(env)}/test-user-columns/${encodeURIComponent(name)}`, { method: "DELETE" });
export const putUserSettings = (env: Environment, settings: TestUserSettings) =>
  call<TestUserSettings>(`${base(env)}/test-user-settings`, { method: "PUT", body: JSON.stringify(settings) });
export const importTestUsers = (env: Environment, csv: string) =>
  call<{ created: number; updated: number; errors: string[] }>(`${base(env)}/test-users/import`, { method: "POST", body: JSON.stringify({ csv }) });
export const exportTestUsersUrl = (env: Environment) => `${base(env)}/test-users/import`;
export const userFromVariables = (env: Environment, input: { name: string; roles: string[]; variables: string[] }) =>
  call<TestUser>(`${base(env)}/test-users/from-variables`, { method: "POST", body: JSON.stringify(input) });
export type LoginResult = { ok: true; status: number; durationMs: number; saved: string[] } | { ok: false; error: string };
export const loginNow = (id: string) => call<LoginResult>(`/api/test-users/${id}/login`, { method: "POST" });
export const logoutUser = (id: string) => call<{ ok: true }>(`/api/test-users/${id}/login?logout=1`, { method: "POST" });

/** Window event fired after test users change in this tab (pickers elsewhere reload). */
export const TEST_USERS_CHANGED = "reqora:test-users-changed";
export const testUsersChanged = () => window.dispatchEvent(new Event(TEST_USERS_CHANGED));

/** The environment's test users, reloaded when they change in this tab. */
export function useTestUsers(env: Environment): TestUsersResponse | null {
  const [state, setState] = useState<TestUsersResponse | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetchTestUsers(env)
        .then((r) => live && setState(r))
        .catch(() => live && setState({ environment: env, users: [], columns: [], settings: { loginRequestId: null, sessionMinutes: 30 } }));
    void load();
    window.addEventListener(TEST_USERS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(TEST_USERS_CHANGED, load);
    };
  }, [env]);
  return state?.environment === env ? state : null;
}

// Choices remembered in this browser: the user Collections sends as, and who plays each role when running a flow.
const PICK_EVENT = "reqora:user-pick";
function writeJson(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(PICK_EVENT));
}
function subscribe(onChange: () => void) {
  window.addEventListener(PICK_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PICK_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The test user Collections sends as in an environment (null: nobody — {{user.*}} then fails). */
export function useSendAs(env: Environment): [string | null, (userId: string | null) => void] {
  const key = `reqora:send-as:${env}`;
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key),
    () => null,
  );
  const parsed = value ? (JSON.parse(value) as string) : null;
  return [parsed, (userId) => writeJson(key, userId)];
}

/** Who plays each role when this flow runs from the canvas in `env` (role → user id; missing: automatic). */
export function useRunAs(workflowId: string, env: Environment): [Record<string, string>, (next: Record<string, string>) => void] {
  const key = `reqora:run-as:${workflowId}:${env}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) ?? "{}",
    () => "{}",
  );
  return [JSON.parse(raw) as Record<string, string>, (next) => writeJson(key, Object.keys(next).length ? next : null)];
}

