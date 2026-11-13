import "server-only";

import { z } from "zod";
import { collectionExportSchema, type CollectionExport } from "@/lib/collections/schema";
import { scanCollection, scanFlows, type SecretFinding } from "@/lib/collections/secret-scan";
import { exportCollection, insertImported, listCollections } from "@/lib/collections/store";
import { listVariables, putVariable } from "@/lib/secrets/variables";
import { USER_NAME, ROLE_NAME } from "@/lib/users/schema";
import { createTestUser, listTestUsers, putColumn, putSettings } from "@/lib/users/store";
import { ENVIRONMENTS, VARIABLE_NAME, workflowInputSchema, type Environment, type WorkflowInput } from "@/lib/workflows/schema";
import { allWorkflows, createWorkflow, replaceWorkflow } from "@/lib/workflows/store";
import { createWorkspace, deleteWorkspace } from "./store";

/**
 * A whole workspace as one file, to move a setup to another Reqora (e.g. a Docker deployment): collections, flows
 * (drafts) and, per environment, variables and test users. Secret values never leave: secret variables and secret
 * test-user columns are exported by name only, and the file says which ones to fill in after importing.
 * Run history, send history, load tests, deployments and members aren't included.
 */

const ref = z.string().min(1).max(100);
const exportedVariable = z.object({
  name: z.string().regex(VARIABLE_NAME),
  kind: z.enum(["secret", "plain"]),
  /** Plain values only. */
  value: z.string().max(10_000).optional(),
  description: z.string().max(500).optional(),
});
const exportedTestUsers = z.object({
  columns: z.array(z.object({ name: z.string().regex(VARIABLE_NAME), kind: z.enum(["secret", "plain"]) })).max(200),
  users: z
    .array(
      z.object({
        name: z.string().regex(USER_NAME),
        roles: z.array(z.string().regex(ROLE_NAME)).max(10),
        /** Plain columns only. */
        values: z.record(z.string().regex(VARIABLE_NAME), z.string().max(10_000)),
      }),
    )
    .max(1000),
  settings: z.object({ loginRequestRef: ref.nullable(), sessionMinutes: z.number().int().min(1).max(1440) }),
});

export const workspaceExportSchema = z.object({
  reqora: z.literal("workspace"),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  workspace: z.object({ name: z.string().trim().min(1).max(80) }),
  collections: z.array(collectionExportSchema.shape.collection).max(200),
  /** Drafts; `ref` is the flow's id where it was exported (Call Flow nodes point at it). */
  flows: z.array(workflowInputSchema.extend({ ref })).max(500),
  environments: z.partialRecord(
    z.enum(ENVIRONMENTS),
    z.object({ variables: z.array(exportedVariable).max(1000), testUsers: exportedTestUsers.optional() }),
  ),
});
export type WorkspaceExport = z.infer<typeof workspaceExportSchema>;

export function exportWorkspace(workspaceId: string, name: string): { file: WorkspaceExport; findings: SecretFinding[] } {
  const collections = listCollections(workspaceId)
    .map((c) => exportCollection(c.id, { refs: true }))
    .filter((c): c is CollectionExport => c !== undefined);
  const flows = allWorkflows(workspaceId).map((w) => ({
    ref: w.id,
    name: w.name,
    ...(w.description ? { description: w.description } : {}),
    ...(w.roles?.length ? { roles: w.roles } : {}),
    nodes: w.nodes,
    edges: w.edges,
  }));
  const environments: WorkspaceExport["environments"] = {};
  for (const environment of ENVIRONMENTS) {
    const scope = { workspaceId, environment };
    const variables = listVariables(workspaceId, environment).map((v) => ({
      name: v.name,
      kind: v.kind,
      ...(v.kind === "plain" && v.value !== null ? { value: v.value } : {}),
      ...(v.description ? { description: v.description } : {}),
    }));
    const users = listTestUsers(scope);
    const plain = new Set(users.columns.filter((c) => c.kind === "plain").map((c) => c.name));
    const testUsers = users.users.length || users.columns.length || users.settings.loginRequestId
      ? {
          columns: users.columns,
          users: users.users.map((u) => ({
            name: u.name,
            roles: u.roles,
            values: Object.fromEntries(Object.entries(u.values).flatMap(([k, v]) => (plain.has(k) && v.value !== null ? [[k, v.value]] : []))),
          })),
          settings: { loginRequestRef: users.settings.loginRequestId, sessionMinutes: users.settings.sessionMinutes },
        }
      : undefined;
    if (variables.length || testUsers) environments[environment] = { variables, ...(testUsers ? { testUsers } : {}) };
  }
  const file: WorkspaceExport = {
    reqora: "workspace",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { name },
    collections: collections.map((c) => c.collection),
    flows,
    environments,
  };
  return { file, findings: [...collections.flatMap((c) => scanCollection(c)), ...scanFlows(flows)].slice(0, 300) };
}

export class WorkspaceImportError extends Error {}

/** Validates a workspace export file; problems are reported with their JSON path. */
export function parseWorkspaceExport(text: string): WorkspaceExport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new WorkspaceImportError(`not valid JSON: ${(error as Error).message}`);
  }
  if ((json as { reqora?: unknown } | null)?.reqora !== "workspace") {
    throw new WorkspaceImportError(
      (json as { reqora?: unknown } | null)?.reqora === "collection"
        ? "this is a collection export — import it on the Collections page (Import › Reqora collection)"
        : 'not a Reqora workspace export (expected "reqora": "workspace")',
    );
  }
  const parsed = workspaceExportSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new WorkspaceImportError(`invalid workspace export — ${issues.join("; ")}`);
  }
  return parsed.data;
}

export type WorkspaceImportResult = {
  workspaceId: string;
  counts: { collections: number; flows: number; variables: number; testUsers: number };
  /** What to do next, e.g. secrets to fill in. */
  notes: string[];
};

const ENV_LABEL: Record<Environment, string> = { production: "Production", staging: "Staging", sandbox: "Sandbox" };

/**
 * Creates a new workspace (owned by `ownerId`) from an export: collections, then flows with their linked
 * requests and called flows pointed at the new copies, then variables and test users per environment.
 */
export function importWorkspace(file: WorkspaceExport, ownerId: string, name = file.workspace.name): WorkspaceImportResult {
  const workspace = createWorkspace(name, ownerId);
  try {
    return fill(workspace.id, file);
  } catch (error) {
    deleteWorkspace(workspace.id); // no half-imported workspace
    throw error;
  }
}

function fill(ws: string, file: WorkspaceExport): WorkspaceImportResult {
  const notes: string[] = [];

  const requests = new Map<string, string>();
  for (const c of file.collections) insertImported(ws, c, requests);

  // Flows: create each, then point Call Flow nodes at the new flows (they may call flows created later).
  const flows = new Map<string, string>();
  const relink = (input: WorkflowInput): { input: WorkflowInput; unlinked: number; calls: boolean } => {
    let unlinked = 0;
    let calls = false;
    const nodes = input.nodes.map((node) => {
      if (node.type === "http" && node.config.requestId) {
        const to = requests.get(node.config.requestId);
        if (to) return { ...node, config: { ...node.config, requestId: to } };
        unlinked += 1;
        const { requestId: _gone, ...config } = node.config;
        void _gone;
        return { ...node, config }; // keeps its stored copy, unlinked
      }
      if (node.type === "call" && node.config.workflowId) {
        calls = true;
        const to = flows.get(node.config.workflowId);
        return to ? { ...node, config: { ...node.config, workflowId: to } } : node;
      }
      return node;
    });
    return { input: { ...input, nodes }, unlinked, calls };
  };
  const created: { id: string; flow: WorkspaceExport["flows"][number] }[] = [];
  let unlinked = 0;
  for (const { ref: from, ...flow } of file.flows) {
    const linked = relink(flow);
    unlinked += linked.unlinked;
    const wf = createWorkflow(ws, linked.input);
    flows.set(from, wf.id);
    created.push({ id: wf.id, flow: { ref: from, ...linked.input } });
  }
  for (const { id, flow } of created) {
    const { ref: _ref, ...input } = flow;
    void _ref;
    const again = relink(input);
    if (again.calls) replaceWorkflow(id, again.input, 1);
  }
  if (unlinked) notes.push(`${unlinked} flow step${unlinked === 1 ? "" : "s"} pointed at requests that weren't in the file; they keep their own copy and are no longer linked.`);

  let variables = 0;
  let users = 0;
  for (const environment of ENVIRONMENTS) {
    const env = file.environments[environment];
    if (!env) continue;
    const label = ENV_LABEL[environment];
    const missing: string[] = [];
    for (const v of env.variables) {
      if (v.kind === "secret" || v.value === undefined) {
        missing.push(v.name);
        continue;
      }
      putVariable(ws, environment, v.name, { kind: "plain", value: v.value, ...(v.description ? { description: v.description } : {}) });
      variables += 1;
    }
    if (missing.length) notes.push(`${label}: set the secret variable${missing.length === 1 ? "" : "s"} ${missing.join(", ")} (Secrets page) — secret values aren't exported.`);

    const t = env.testUsers;
    if (!t) continue;
    const scope = { workspaceId: ws, environment };
    for (const c of t.columns) putColumn(scope, c.name, c.kind);
    for (const u of t.users) {
      const result = createTestUser(scope, { name: u.name, roles: u.roles, values: u.values });
      if (result.ok) users += 1;
    }
    const login = t.settings.loginRequestRef ? (requests.get(t.settings.loginRequestRef) ?? null) : null;
    putSettings(scope, { loginRequestId: login, sessionMinutes: t.settings.sessionMinutes });
    if (t.settings.loginRequestRef && !login) notes.push(`${label}: the test users' login request wasn't in the file — pick one under Secrets › Test Users.`);
    const secretColumns = t.columns.filter((c) => c.kind === "secret").map((c) => c.name);
    if (secretColumns.length && t.users.length) {
      notes.push(`${label}: fill in each test user's ${secretColumns.join(", ")} (Secrets › Test Users) — secret values aren't exported.`);
    }
  }

  return {
    workspaceId: ws,
    counts: { collections: file.collections.length, flows: file.flows.length, variables, testUsers: users },
    notes,
  };
}
