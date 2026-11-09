import "server-only";

import { sendRequest } from "@/lib/collections/send";
import type { SendOutcome } from "@/lib/collections/schema";
import { getRequest, requestScopes, requestWorkspace } from "@/lib/collections/store";
import type { Environment } from "@/lib/workflows/schema";
import { DEFAULT_ROLE, flowRoles, type TestUser, type UserHandle } from "./schema";
import { findTestUser, getSettings, getTestUser, listTestUsers, markSession, readUserValue, usersWithRole, writeUserValue } from "./store";

type Scope = { workspaceId: string; environment: Environment };
type Net = { baseUrl: string; fetch?: typeof fetch };

/** A handle on a stored test user for templates and scripts; `seen` collects values read or written (to scrub). */
export function userHandle(user: Pick<TestUser, "id" | "name" | "roles">, role: string, seen?: Set<string>): UserHandle {
  const track = (value: string | null | undefined) => {
    if (seen && value && value.length >= 6) seen.add(value);
  };
  return {
    id: user.id,
    name: user.name,
    roles: user.roles,
    role,
    get: (name) => {
      const value = readUserValue(user.id, name);
      track(value);
      return value;
    },
    set: (name, value) => {
      writeUserValue(user.id, name, value);
      track(value);
    },
  };
}

/**
 * Who plays each role: the given user (id or name) or, when none is given, the first user with that role tag —
 * or, for a flow that names no roles (just "user"), the first user at all. Roles nobody can play map to why not.
 */
export function assignUsers(
  scope: Scope,
  roles: readonly string[] | undefined,
  given: Record<string, string> = {},
): Map<string, TestUser | { missing: string }> {
  const all = flowRoles(roles);
  const out = new Map<string, TestUser | { missing: string }>();
  const env = scope.environment[0].toUpperCase() + scope.environment.slice(1);
  for (const role of all) {
    const ref = given[role];
    if (ref) {
      out.set(role, findTestUser(scope, ref) ?? { missing: `test user "${ref}" (for ${role}) doesn't exist in ${env}` });
      continue;
    }
    const tagged = usersWithRole(scope, role)[0];
    const fallback = role === DEFAULT_ROLE && all.length === 1 ? listTestUsers(scope).users[0] : undefined;
    out.set(
      role,
      tagged ??
        fallback ?? {
          missing:
            role === DEFAULT_ROLE && all.length === 1
              ? `no test users in ${env}: add one on the Secrets page (Test Users)`
              : `no test user plays “${role}” in ${env}: give a user the role "${role}" on the Secrets page (Test Users), or pick one under Run as`,
        },
    );
  }
  return out;
}

export type LoginResult = { ok: true; status: number; durationMs: number; saved: string[] } | { ok: false; error: string };

/**
 * Sends the environment's login request as `user` (its post-response script saves the token with rq.user.set),
 * and records the session. Without a login request configured, there's nothing to do.
 */
export async function loginAs(scope: Scope, user: UserHandle, net: Net): Promise<LoginResult> {
  const { loginRequestId } = getSettings(scope);
  if (!loginRequestId) return { ok: false, error: "no login request is set for this environment (Secrets page → Test Users)" };
  const saved = getRequest(loginRequestId);
  if (!saved || requestWorkspace(saved.id) !== scope.workspaceId) {
    return { ok: false, error: "the login request was deleted — choose another on the Secrets page (Test Users)" };
  }
  const scopes = requestScopes(saved.collectionId, saved.folderId);
  let raw: SendOutcome | undefined;
  const scrubbed = await sendRequest(
    { name: saved.name, definition: saved.definition, collection: scopes.collection, folders: scopes.folders },
    {
      workspaceId: scope.workspaceId,
      environment: scope.environment,
      baseUrl: net.baseUrl,
      user,
      onUnscrubbed: (o) => {
        raw = o;
      },
      ...(net.fetch ? { fetch: net.fetch } : {}),
    },
  );
  const outcome = raw ?? scrubbed;
  if ("error" in outcome) return { ok: false, error: outcome.error };
  const scriptError = outcome.scripts.errors[0];
  if (scriptError) return { ok: false, error: `its ${scriptError.phase === "pre" ? "pre-request" : "post-response"} script failed: ${scriptError.message}` };
  const failed = [...outcome.assertions.filter((a) => !a.passed), ...outcome.scripts.tests.filter((t) => !t.passed)];
  if (failed.length) return { ok: false, error: `${failed.length} test${failed.length === 1 ? "" : "s"} failed` };
  if (outcome.status >= 400) return { ok: false, error: `the login request answered ${outcome.status}` };
  markSession(user.id, new Date().toISOString());
  return { ok: true, status: outcome.status, durationMs: outcome.durationMs, saved: Object.keys(outcome.scripts.user ?? {}) };
}

// One login at a time per user: concurrent steps (load test virtual users) wait for the same login.
const logins: Map<string, Promise<void>> = ((globalThis as { __reqoraLogins?: Map<string, Promise<void>> }).__reqoraLogins ??= new Map());

/**
 * Makes sure `user` has a fresh session before they act: logs in when they never did, the session is older than
 * the environment's session length, or `force` (after a 401). No-op without a login request. Throws on failure.
 */
export async function ensureSession(scope: Scope, user: UserHandle, net: Net, { force = false } = {}): Promise<void> {
  const settings = getSettings(scope);
  if (!settings.loginRequestId) return;
  const sessionAt = getTestUser(user.id)?.sessionAt;
  const fresh = sessionAt && Date.now() - Date.parse(sessionAt) < settings.sessionMinutes * 60_000;
  if (fresh && !force) return;
  const pending = logins.get(user.id);
  if (pending) return pending;
  const login = loginAs(scope, user, net)
    .then((result) => {
      if (!result.ok) throw new Error(`automatic login as “${user.name}” failed: ${result.error}`);
    })
    .finally(() => logins.delete(user.id));
  logins.set(user.id, login);
  return login;
}

/**
 * The user a Collections send acts as (`ref`: id or name), logged in first when a login request is set — unless
 * the request being sent is that login request. Returns the handle, or why not.
 */
export async function sendAsUser(
  scope: Scope,
  ref: string,
  requestId: string | null | undefined,
  net: Net,
): Promise<{ user: UserHandle } | { error: string; notFound?: boolean }> {
  const found = findTestUser(scope, ref);
  if (!found) return { error: `test user "${ref}" not found`, notFound: true };
  const user = userHandle(found, found.roles[0] ?? DEFAULT_ROLE);
  if (requestId && requestId === loginRequestOf(scope)) return { user };
  try {
    await ensureSession(scope, user, net);
  } catch (error) {
    return { error: (error as Error).message };
  }
  return { user };
}

/**
 * After a Collections send as `user`: sending the login request itself by hand counts as logging in when it
 * succeeds (its script saved the token), so the next step doesn't log in again.
 */
export function noteManualLogin(scope: Scope, user: UserHandle, requestId: string | null | undefined, outcome: SendOutcome) {
  if (!requestId || requestId !== loginRequestOf(scope) || "error" in outcome) return;
  const failed = outcome.status >= 400 || outcome.scripts.errors.length > 0 || outcome.assertions.some((a) => !a.passed) || outcome.scripts.tests.some((t) => !t.passed);
  if (!failed) markSession(user.id, new Date().toISOString());
}

/** The login request's id for an environment (so the login request itself isn't preceded by a login). */
export const loginRequestOf = (scope: Scope) => getSettings(scope).loginRequestId;
