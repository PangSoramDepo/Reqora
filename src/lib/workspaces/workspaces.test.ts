import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

process.env.REQORA_DB_PATH = ":memory:";
process.env.REQORA_SECRET_KEY = "a".repeat(64);

let ws: typeof import("./store");
let access: typeof import("./access");
let auth: typeof import("@/lib/auth/store");
let flows: typeof import("@/lib/workflows/store");
let collections: typeof import("@/lib/collections/store");
let variables: typeof import("@/lib/secrets/variables");

beforeAll(async () => {
  flows = await import("@/lib/workflows/store");
  ws = await import("./store");
  access = await import("./access");
  auth = await import("@/lib/auth/store");
  collections = await import("@/lib/collections/store");
  variables = await import("@/lib/secrets/variables");
});

let n = 0;
function user(name: string) {
  n += 1;
  return auth.insertUser({ email: `${name.toLowerCase()}${n}@example.com`, name, passwordHash: "x" });
}

/** A request signed in as `userId`, optionally with the active-workspace cookie or header. */
function request(userId: string, { cookie, header }: { cookie?: string; header?: string } = {}) {
  const { token } = auth.createSession(userId, 60_000);
  const cookies = [`reqora_session=${token}`, ...(cookie ? [`reqora_workspace=${cookie}`] : [])].join("; ");
  return new NextRequest("http://reqora.test/api/x", { headers: { cookie: cookies, ...(header ? { "x-reqora-workspace": header } : {}) } });
}

const flow = (name: string) => ({
  name,
  nodes: [{ id: "in", name: "In", type: "webhook" as const, position: { x: 0, y: 0 }, config: { method: "POST" as const, path: "/x" } }],
  edges: [],
});

describe("workspaces", () => {
  it("gives the first account the sample Default workspace, and later accounts a workspace of their own", () => {
    const ann = user("Ann");
    expect(ws.ensureWorkspace(ann).map((w) => [w.id, w.role])).toEqual([[flows.DEFAULT_WORKSPACE_ID, "owner"]]);
    expect(flows.listWorkflows(flows.DEFAULT_WORKSPACE_ID).length).toBeGreaterThan(0);

    const bob = user("Bob");
    const [own] = ws.ensureWorkspace(bob);
    expect(own).toMatchObject({ name: "Bob's workspace", role: "owner", memberCount: 1 });
    expect(flows.listWorkflows(own.id)).toEqual([]);
  });

  it("keeps flows, collections and secrets apart, and resolves the active workspace from header or cookie", () => {
    const cat = user("Cat");
    const a = ws.createWorkspace("Payments", cat.id);
    const b = ws.createWorkspace("Lending", cat.id);
    const wf = flows.createWorkflow(a.id, flow("Only in Payments"));
    collections.createCollection(b.id, { name: "Lending API" });
    variables.putVariable(a.id, "sandbox", "TOKEN", { kind: "secret", value: "payments-secret" });
    variables.putVariable(b.id, "sandbox", "TOKEN", { kind: "plain", value: "lending" });

    expect(flows.listWorkflows(b.id).map((w) => w.name)).toEqual([]);
    expect(collections.listCollections(a.id)).toEqual([]);
    expect(variables.resolveVariable(a.id, "sandbox", "TOKEN")).toBe("payments-secret");
    expect(variables.resolveVariable(b.id, "sandbox", "TOKEN")).toBe("lending");
    expect(flows.getWorkflow(wf.id)?.workspaceId).toBe(a.id);

    const viaCookie = access.activeWorkspace(request(cat.id, { cookie: b.id }));
    expect("workspaceId" in viaCookie && viaCookie.workspaceId).toBe(b.id);
    const viaHeader = access.activeWorkspace(request(cat.id, { cookie: b.id, header: a.id }));
    expect("workspaceId" in viaHeader && viaHeader.workspaceId).toBe(a.id);
    // A cookie for a workspace you're not in falls back to one you are in; an explicit header is a 404.
    const stale = access.activeWorkspace(request(cat.id, { cookie: "ws_gone" }));
    expect("workspaceId" in stale && [a.id, b.id]).toContain((stale as { workspaceId: string }).workspaceId);
    const wrong = access.activeWorkspace(request(cat.id, { header: flows.DEFAULT_WORKSPACE_ID }));
    expect("error" in wrong && wrong.error.status).toBe(404);
  });

  it("enforces roles: non-members get 404, viewers can't edit, only owners manage", () => {
    const owner = user("Dee");
    const viewer = user("Eve");
    const outsider = user("Fay");
    const space = ws.createWorkspace("Ops", owner.id);
    ws.addMember(space.id, viewer.id, "viewer");
    const wf = flows.createWorkflow(space.id, flow("Ops flow"));
    const where = flows.workflowWorkspace(wf.id);

    const read = access.accessTo(request(viewer.id), where, "viewer", "workflow");
    expect("role" in read && read.role).toBe("viewer");
    const write = access.accessTo(request(viewer.id), where, "editor", "workflow");
    expect("error" in write && write.error.status).toBe(403);
    const stranger = access.accessTo(request(outsider.id), where, "viewer", "workflow");
    expect("error" in stranger && stranger.error.status).toBe(404);
    const manage = access.accessTo(request(owner.id), where, "owner", "workflow");
    expect("role" in manage && manage.role).toBe("owner");
  });

  it("always keeps an owner, and deleting a workspace deletes what's in it", () => {
    const gus = user("Gus");
    const hal = user("Hal");
    const space = ws.createWorkspace("Temp", gus.id);
    expect(ws.setMemberRole(space.id, gus.id, "editor")).toEqual({ ok: false, reason: "last_owner" });
    expect(ws.removeMember(space.id, gus.id)).toEqual({ ok: false, reason: "last_owner" });
    expect(ws.addMember(space.id, hal.id, "owner").ok).toBe(true);
    expect(ws.addMember(space.id, hal.id, "owner")).toEqual({ ok: false, reason: "already_member" });
    expect(ws.setMemberRole(space.id, gus.id, "viewer").ok).toBe(true);
    expect(ws.listMembers(space.id).map((m) => [m.name, m.role])).toEqual([
      ["Hal", "owner"],
      ["Gus", "viewer"],
    ]);

    const wf = flows.createWorkflow(space.id, flow("Doomed"));
    const col = collections.createCollection(space.id, { name: "Doomed API" });
    variables.putVariable(space.id, "production", "KEY", { kind: "plain", value: "v" });
    expect(ws.deleteWorkspace(space.id)).toBe(true);
    expect(flows.getWorkflow(wf.id)).toBeUndefined();
    expect(collections.getCollection(col.id)).toBeUndefined();
    expect(variables.listVariables(space.id, "production")).toEqual([]);
    expect(ws.workspacesOf(hal.id).some((w) => w.id === space.id)).toBe(false);
  });
});
