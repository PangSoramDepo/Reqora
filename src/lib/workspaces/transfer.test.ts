import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowNode } from "@/lib/workflows/schema";

process.env.REQORA_DB_PATH = ":memory:";
process.env.REQORA_SECRET_KEY = "c".repeat(64);

let ws: typeof import("./store");
let transfer: typeof import("./transfer");
let auth: typeof import("@/lib/auth/store");
let flows: typeof import("@/lib/workflows/store");
let collections: typeof import("@/lib/collections/store");
let variables: typeof import("@/lib/secrets/variables");
let users: typeof import("@/lib/users/store");

beforeAll(async () => {
  flows = await import("@/lib/workflows/store");
  ws = await import("./store");
  transfer = await import("./transfer");
  auth = await import("@/lib/auth/store");
  collections = await import("@/lib/collections/store");
  variables = await import("@/lib/secrets/variables");
  users = await import("@/lib/users/store");
});

const webhook: WorkflowNode = { id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/x" } };

describe("workspace export / import", () => {
  it("moves collections, flows, variables and test users to a new workspace, without secret values", () => {
    const owner = auth.insertUser({ email: "owner@example.com", name: "Owner", passwordHash: "x" });
    const source = ws.createWorkspace("Bank team", owner.id).id;

    // A collection with a login request.
    const col = collections.createCollection(source, { name: "Bank" });
    const login = collections.createRequest(col.id, { name: "Login", folderId: null });
    if (!login.ok) throw new Error("no request");
    collections.replaceRequest(login.request.id, {
      name: "Login",
      folderId: null,
      definition: { ...login.request.definition, method: "POST", url: "{{env.BASE_URL}}/login", headers: [{ key: "X-Api-Key", value: "typed-in-key-123", enabled: true }] },
    });

    // Flows: one with a step linked to Login, one calling it.
    const linked = flows.createWorkflow(source, {
      name: "Login flow",
      nodes: [
        webhook,
        { id: "login", name: "Login", type: "http", position: { x: 0, y: 0 }, config: { method: "POST", url: "/login", headers: {}, timeoutMs: 5000, requestId: login.request.id } },
      ],
      edges: [{ id: "e", source: "in", sourcePort: "out", target: "login" }],
    });
    const caller = flows.createWorkflow(source, {
      name: "Caller",
      roles: ["maker"],
      nodes: [webhook, { id: "call", name: "Call", type: "call", position: { x: 0, y: 0 }, config: { workflowId: linked.id } }],
      edges: [{ id: "e", source: "in", sourcePort: "out", target: "call" }],
    });
    void caller;

    // Variables and test users.
    variables.putVariable(source, "sandbox", "BASE_URL", { kind: "plain", value: "https://sandbox.bank.test" });
    variables.putVariable(source, "sandbox", "API_SECRET", { kind: "secret", value: "very-secret-value" });
    const scope = { workspaceId: source, environment: "sandbox" as const };
    users.createTestUser(scope, { name: "maker01", roles: ["maker"], values: { login_id: "1001", password: "pw-maker-01" } });
    users.putSettings(scope, { loginRequestId: login.request.id, sessionMinutes: 45 });

    const { file, findings } = transfer.exportWorkspace(source, "Bank team");
    const text = JSON.stringify(file);
    expect(text).not.toContain("very-secret-value");
    expect(text).not.toContain("pw-maker-01");
    expect(file.environments.sandbox?.variables).toEqual([
      { name: "API_SECRET", kind: "secret" },
      { name: "BASE_URL", kind: "plain", value: "https://sandbox.bank.test" },
    ]);
    expect(findings.map((f) => f.where)).toContain("Bank › Login › Header “X-Api-Key”");

    // Import into a new workspace (as another user, e.g. on another server).
    const other = auth.insertUser({ email: "other@example.com", name: "Other", passwordHash: "x" });
    const result = transfer.importWorkspace(transfer.parseWorkspaceExport(text), other.id);
    expect(result.counts).toEqual({ collections: 1, flows: 2, variables: 1, testUsers: 1 });
    expect(result.notes).toEqual([
      "Sandbox: set the secret variable API_SECRET (Secrets page) — secret values aren't exported.",
      "Sandbox: fill in each test user's password (Secrets › Test Users) — secret values aren't exported.",
    ]);
    const target = result.workspaceId;
    expect(ws.roleIn(target, other.id)).toBe("owner");

    const [newCol] = collections.listCollections(target);
    const newLogin = newCol.requests.find((r) => r.name === "Login")!;
    expect(newLogin.id).not.toBe(login.request.id);
    const imported = flows.allWorkflows(target);
    const newLinked = imported.find((w) => w.name === "Login flow")!;
    const step = newLinked.nodes.find((n) => n.id === "login")!;
    expect(step.type === "http" && step.config.requestId).toBe(newLogin.id);
    const newCaller = imported.find((w) => w.name === "Caller")!;
    const call = newCaller.nodes.find((n) => n.id === "call")!;
    expect(call.type === "call" && call.config.workflowId).toBe(newLinked.id);
    expect(newCaller.roles).toEqual(["maker"]);

    const tu = users.listTestUsers({ workspaceId: target, environment: "sandbox" });
    expect(tu.users.map((u) => [u.name, u.roles, u.values.login_id?.value, u.values.password?.value ?? null])).toEqual([["maker01", ["maker"], "1001", null]]);
    expect(tu.columns).toEqual([
      { name: "login_id", kind: "plain" },
      { name: "password", kind: "secret" },
    ]);
    expect(tu.settings).toEqual({ loginRequestId: newLogin.id, sessionMinutes: 45 });
    expect(variables.resolveVariable(target, "sandbox", "BASE_URL")).toBe("https://sandbox.bank.test");
    expect(variables.resolveVariable(target, "sandbox", "API_SECRET")).toBeUndefined();
  });

  it("explains files that aren't workspace exports", () => {
    expect(() => transfer.parseWorkspaceExport("{")).toThrow(/not valid JSON/);
    expect(() => transfer.parseWorkspaceExport('{"reqora":"collection"}')).toThrow(/collection export/);
    expect(() => transfer.parseWorkspaceExport('{"reqora":"workspace","version":1}')).toThrow(/invalid workspace export — workspace/);
  });
});
