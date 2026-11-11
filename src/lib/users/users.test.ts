import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowInput, WorkflowNode } from "@/lib/workflows/schema";

process.env.REQORA_DB_PATH = ":memory:";
process.env.REQORA_SECRET_KEY = "b".repeat(64);

let store: typeof import("./store");
let flows: typeof import("@/lib/workflows/store");
let runner: typeof import("@/lib/workflows/runner");
let collections: typeof import("@/lib/collections/store");
let variables: typeof import("@/lib/secrets/variables");
let loadtests: typeof import("@/lib/loadtest/runner");
let loadSchema: typeof import("@/lib/loadtest/schema");

const WS = "ws_default";
const scope = { workspaceId: WS, environment: "sandbox" as const };

beforeAll(async () => {
  flows = await import("@/lib/workflows/store");
  store = await import("./store");
  runner = await import("@/lib/workflows/runner");
  collections = await import("@/lib/collections/store");
  variables = await import("@/lib/secrets/variables");
  loadtests = await import("@/lib/loadtest/runner");
  loadSchema = await import("@/lib/loadtest/schema");
});

/** A fake bank API: /login hands out tokens per login_id; other calls need a valid one (revoked ones get 401). */
function bank() {
  const state = { logins: [] as string[], calls: [] as { path: string; auth: string | null }[], revoked: new Set<string>(), n: 0 };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/login") {
      const { login_id } = JSON.parse(String(init?.body)) as { login_id: string };
      state.logins.push(login_id);
      state.n += 1;
      return Response.json({ token: `tok-${login_id}-${state.n}` });
    }
    const auth = new Headers(init?.headers).get("authorization");
    state.calls.push({ path: url.pathname, auth });
    if (!auth?.startsWith("Bearer tok-") || state.revoked.has(auth.slice(7))) return Response.json({ error: "expired" }, { status: 401 });
    return Response.json({ ok: true });
  }) as typeof globalThis.fetch;
  return { state, fetch };
}

const webhook: WorkflowNode = { id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/x" } };
const call = (id: string, path: string, runAs?: string): WorkflowNode => ({
  id,
  name: id,
  type: "http",
  position: { x: 0, y: 0 },
  ...(runAs ? { runAs } : {}),
  config: { method: "POST", url: `https://api.test${path}`, headers: { Authorization: "Bearer {{user.access_token}}" }, timeoutMs: 5000 },
});
const chain = (name: string, roles: string[] | undefined, ...nodes: WorkflowNode[]): WorkflowInput => {
  const all = [webhook, ...nodes];
  return { name, ...(roles ? { roles } : {}), nodes: all, edges: nodes.map((n, i) => ({ id: `e${i}`, source: all[i].id, sourcePort: "out", target: n.id })) };
};

describe("test users", () => {
  it("keeps credentials encrypted per user, with secret columns picked from the name", () => {
    const created = store.createTestUser(scope, { name: "maker01", roles: ["maker"], values: { login_id: "1001", password: "pw-maker-1" } });
    if (!created.ok) throw new Error(created.reason);
    store.createTestUser(scope, { name: "auth01", roles: ["authorizer"], values: { login_id: "2001", password: "pw-auth-1" } });

    const listed = store.listTestUsers(scope);
    expect(listed.columns).toEqual([
      { name: "login_id", kind: "plain" },
      { name: "password", kind: "secret" },
    ]);
    const maker = listed.users.find((u) => u.name === "maker01")!;
    expect(maker.values.login_id.value).toBe("1001");
    expect(maker.values.password.value).toBeNull(); // write-only
    expect(store.readUserValue(maker.id, "password")).toBe("pw-maker-1");
    expect(store.createTestUser(scope, { name: "maker01", roles: [], values: {} })).toEqual({ ok: false, reason: "name_taken" });

    // Making a column secret re-encrypts the values; plain again decrypts them.
    store.putColumn(scope, "login_id", "secret");
    expect(store.listTestUsers(scope).users.find((u) => u.name === "maker01")!.values.login_id.value).toBeNull();
    expect(store.readUserValue(maker.id, "login_id")).toBe("1001");
    store.putColumn(scope, "login_id", "plain");
    expect(store.getTestUser(maker.id)!.values.login_id.value).toBe("1001");
  });

  it("reorders columns, and refuses an order that doesn't list exactly the current columns", () => {
    const scope2 = { workspaceId: WS, environment: "staging" as const };
    store.createTestUser(scope2, { name: "u1", roles: [], values: { a: "1", b: "2", c: "3" } });
    expect(store.listTestUsers(scope2).columns.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(store.reorderColumns(scope2, ["c", "a", "b"])?.map((c) => c.name)).toEqual(["c", "a", "b"]);
    expect(store.listTestUsers(scope2).columns.map((c) => c.name)).toEqual(["c", "a", "b"]);
    expect(store.exportTestUsers(scope2).split("\n")[0]).toBe("user,roles,c,a,b");
    expect(store.reorderColumns(scope2, ["a", "b"])).toBeNull();
    expect(store.reorderColumns(scope2, ["a", "a", "b"])).toBeNull();
    expect(store.reorderColumns(scope2, ["a", "b", "x"])).toBeNull();
    store.createTestUser(scope2, { name: "u2", roles: [], values: { d: "4" } });
    expect(store.listTestUsers(scope2).columns.map((c) => c.name)).toEqual(["c", "a", "b", "d"]); // new columns go last
  });

  it("changes only what a patch gives (roles survive a value update)", async () => {
    const { userPatchSchema } = await import("./schema");
    expect(userPatchSchema.parse({ values: { login_id: "1" } })).toEqual({ values: { login_id: "1" } });
  });

  it("imports and exports CSV, and moves environment variables into a user", () => {
    const result = store.importTestUsers(scope, "user,roles,login_id,password\nmaker02,maker,1002,pw-2\nmaker01,maker;approver,,\nbad name!,x,1,2\n");
    expect(result).toEqual({ created: 1, updated: 1, errors: ['row 4: invalid user name "bad name!"'] });
    expect(store.findTestUser(scope, "maker01")!.roles).toEqual(["maker", "approver"]);
    expect(store.readUserValue(store.findTestUser(scope, "maker01")!.id, "login_id")).toBe("1001"); // empty cell: kept
    expect(store.exportTestUsers(scope).split("\n")[0]).toBe("user,roles,login_id,password");
    expect(store.exportTestUsers(scope)).toContain("maker02,maker,1002,\n");

    variables.putVariable(WS, "sandbox", "legacy_id", { kind: "plain", value: "9001" });
    variables.putVariable(WS, "sandbox", "legacy_token", { kind: "secret", value: "tok-legacy-0" });
    const moved = store.userFromVariables(scope, { name: "legacy", roles: [], variables: ["legacy_id", "legacy_token"] });
    if (!moved.ok) throw new Error("not moved");
    expect(store.readUserValue(moved.user.id, "legacy_token")).toBe("tok-legacy-0");
    expect(moved.user.values.legacy_token.value).toBeNull();
    store.deleteTestUser(moved.user.id);
    store.deleteTestUser(store.findTestUser(scope, "maker02")!.id);
  });

  it("runs each step as its role's user, logging each in once with the login request", async () => {
    const col = collections.createCollection(WS, { name: "Bank" });
    const login = collections.createRequest(col.id, { name: "Login", folderId: null });
    if (!login.ok) throw new Error(login.reason);
    collections.replaceRequest(login.request.id, {
      name: "Login",
      folderId: null,
      definition: {
        ...login.request.definition,
        method: "POST",
        url: "https://api.test/login",
        body: { type: "json", text: '{ "login_id": "{{user.login_id}}", "password": "{{user.password}}" }' },
        postScript: 'rq.user.set("access_token", rq.response.json().token);',
      },
    });
    store.putSettings(scope, { loginRequestId: login.request.id, sessionMinutes: 30 });

    const wf = flows.createWorkflow(WS, chain("Maker-checker", ["maker", "authorizer"], call("create", "/create", "maker"), call("approve", "/approve", "authorizer")));
    const { state, fetch } = bank();
    const first = await runner.executeScrubbed(wf, { source: "manual" }, { baseUrl: "http://reqora.test", environment: "sandbox", fetch });
    expect(first.status).toBe("succeeded");
    expect(state.logins).toEqual(["1001", "2001"]);
    expect(state.calls).toEqual([
      { path: "/create", auth: "Bearer tok-1001-1" },
      { path: "/approve", auth: "Bearer tok-2001-2" },
    ]);
    expect(first.steps.map((s) => s.actor)).toEqual([undefined, { role: "maker", user: "maker01" }, { role: "authorizer", user: "auth01" }]); // the trigger acts for nobody
    expect(store.readUserValue(store.findTestUser(scope, "maker01")!.id, "access_token")).toBe("tok-1001-1");

    // Sessions are reused…
    await runner.executeScrubbed(wf, { source: "manual" }, { baseUrl: "http://reqora.test", environment: "sandbox", fetch });
    expect(state.logins).toHaveLength(2);
    // …until a 401: then the user logs in again and the request is retried once.
    state.revoked.add("tok-1001-1");
    const third = await runner.executeScrubbed(wf, { source: "manual" }, { baseUrl: "http://reqora.test", environment: "sandbox", fetch });
    expect(third.status).toBe("succeeded");
    expect(state.logins).toEqual(["1001", "2001", "1001"]);
    expect(state.calls.slice(-3).map((c) => c.auth)).toEqual(["Bearer tok-1001-1", "Bearer tok-1001-3", "Bearer tok-2001-2"]);
  });

  it("explains a role nobody plays, and takes explicit users by name", async () => {
    const wf = flows.createWorkflow(WS, chain("Checker", ["checker"], call("check", "/check")));
    const { fetch } = bank();
    const result = await runner.executeScrubbed(wf, { source: "manual" }, { baseUrl: "http://reqora.test", environment: "sandbox", fetch });
    expect(result.steps[1].error).toMatch(/no test user plays “checker” in Sandbox/);

    const picked = await runner.executeScrubbed(wf, { source: "manual" }, { baseUrl: "http://reqora.test", environment: "sandbox", fetch, users: { checker: "auth01" } });
    expect(picked.status).toBe("succeeded");
    expect(picked.steps[1].actor).toEqual({ role: "checker", user: "auth01" });
  });

  it("load tests take turns through a role's users and report per user", async () => {
    store.createTestUser(scope, { name: "maker03", roles: ["maker"], values: { login_id: "1003", password: "pw-3" } });
    const wf = flows.createWorkflow(WS, chain("Makers", ["maker"], call("create", "/create")));
    const { state, fetch } = bank();
    const config = loadSchema.loadTestConfigSchema.parse({ environment: "sandbox", virtualUsers: 1, iterations: 4, users: { assignment: "per-run" } });
    const started = loadtests.startLoadTest(wf, config, { baseUrl: "http://reqora.test", fetch });
    if (!started.ok) throw new Error("not started");
    const final = await loadtests.waitForLoadTest(started.test.id)!;
    expect(final.iterations.succeeded).toBe(4);
    expect(final.userPools).toEqual([{ role: "maker", users: ["maker01", "maker03"] }]);
    expect(final.users?.map((u) => [u.user, u.runs])).toEqual([
      ["maker01", 2],
      ["maker03", 2],
    ]);
    expect(state.calls).toHaveLength(4);

    const unknown = loadtests.startLoadTest(wf, loadSchema.loadTestConfigSchema.parse({ environment: "sandbox", virtualUsers: 1, iterations: 1, users: { roles: { maker: ["ghost"] } } }), {
      baseUrl: "http://reqora.test",
      fetch,
    });
    expect(unknown).toMatchObject({ ok: false, reason: "unknown_users" });
  });
});
