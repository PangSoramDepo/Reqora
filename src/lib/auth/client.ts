"use client";

export type SessionUser = { id: string; email: string; name: string };
export type SessionInfo = { user: SessionUser | null; signupOpen: boolean; firstRun: boolean };

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string; issues?: { message: string }[] };
    throw new Error(problem.issues?.[0]?.message ?? problem.detail ?? response.statusText);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const fetchSession = () => fetch("/api/auth/session").then((r) => r.json() as Promise<SessionInfo>);

export const login = (input: { email: string; password: string; remember: boolean }) =>
  post<SessionUser>("/api/auth/login", input);

export const signup = (input: { name: string; email: string; password: string; remember: boolean }) =>
  post<SessionUser>("/api/auth/signup", input);

export const logout = () => post<void>("/api/auth/logout");
/** Changes the signed-in user's password; other sessions are signed out. */
export const changePassword = (input: { currentPassword: string; newPassword: string }) => post<void>("/api/auth/password", input);
