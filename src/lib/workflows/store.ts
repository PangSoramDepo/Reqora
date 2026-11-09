import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeploymentDetail, DeploymentRecord, Run, Workflow, WorkflowInput, WorkflowSummary } from "./schema";
import { SEED_WORKFLOWS } from "./seed";

type WorkflowRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  version: number;
  definition: string;
  created_at: string;
  updated_at: string;
  deployed_version: number | null;
  deployed_definition: string | null;
  deployed_at: string | null;
};

function open(): DatabaseSync {
  const file = process.env.REQORA_DB_PATH ?? path.join(process.cwd(), ".data", "reqora.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  const hadMembers = tableExists(db, "workspace_members");
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS members_by_user ON workspace_members (user_id);
  `);
  const variablesBeforeWorkspaces = tableExists(db, "variables") && !hasColumn(db, "variables", "workspace_id");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER NOT NULL,
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_by_workflow ON runs (workflow_id, started_at DESC);
  `);
  // Workspaces arrived later: rows from before them belong to the "Default" workspace.
  addWorkspaceColumn(db, "workflows");
  addWorkspaceColumn(db, "runs");
  db.exec("CREATE INDEX IF NOT EXISTS runs_by_workspace ON runs (workspace_id, started_at DESC)");
  // Variables are keyed per workspace, so the table is rebuilt with the new primary key.
  if (variablesBeforeWorkspaces) {
    ensureDefaultWorkspace(db);
    db.exec(`
      ALTER TABLE variables RENAME TO variables_before_workspaces;
      ${VARIABLES_TABLE}
      INSERT INTO variables (workspace_id, environment, name, kind, value, description, updated_at)
        SELECT '${DEFAULT_WORKSPACE_ID}', environment, name, kind, value, description, updated_at FROM variables_before_workspaces;
      DROP TABLE variables_before_workspaces;
    `);
  } else {
    db.exec(VARIABLES_TABLE);
  }
  // Everyone who used Reqora before workspaces keeps access to its data: the first account owns it.
  if (!hadMembers && db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(DEFAULT_WORKSPACE_ID)) {
    const users = db.prepare("SELECT id FROM users ORDER BY created_at, rowid").all() as { id: string }[];
    const add = db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, added_at) VALUES (?, ?, ?, ?)");
    users.forEach((u, i) => add.run(DEFAULT_WORKSPACE_ID, u.id, i === 0 ? "owner" : "editor", new Date().toISOString()));
  }

  // Columns added after the first release; ALTER only when missing so existing databases upgrade in place.
  const columns = new Set((db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[]).map((c) => c.name));
  for (const [column, type] of [
    ["deployed_version", "INTEGER"],
    ["deployed_definition", "TEXT"],
    ["deployed_at", "TEXT"],
  ]) {
    if (!columns.has(column)) db.exec(`ALTER TABLE workflows ADD COLUMN ${column} ${type}`);
  }

  // Deployment history. Workflows deployed before it existed get their current deployment as the first entry.
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      definition TEXT NOT NULL,
      deployed_at TEXT NOT NULL,
      deployed_by TEXT,
      rollback_of TEXT
    );
    CREATE INDEX IF NOT EXISTS deployments_by_workflow ON deployments (workflow_id, deployed_at DESC);
  `);
  const undocumented = db
    .prepare(
      `SELECT id, deployed_version, deployed_definition, deployed_at FROM workflows
       WHERE deployed_definition IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deployments d WHERE d.workflow_id = workflows.id)`,
    )
    .all() as { id: string; deployed_version: number; deployed_definition: string; deployed_at: string }[];
  for (const w of undocumented) {
    db.prepare("INSERT INTO deployments (id, workflow_id, version, definition, deployed_at) VALUES (?, ?, ?, ?, ?)").run(
      newDeploymentId(),
      w.id,
      w.deployed_version,
      w.deployed_definition,
      w.deployed_at,
    );
  }

  const { count } = db.prepare("SELECT COUNT(*) AS count FROM workflows").get() as { count: number };
  // A new database starts with the sample flows in the "Default" workspace; the first account to sign in owns it.
  if (count === 0 && !hadMembers) {
    const now = new Date().toISOString();
    ensureDefaultWorkspace(db);
    for (const seed of SEED_WORKFLOWS) {
      insertWorkflow(db, DEFAULT_WORKSPACE_ID, seed.id, seed.input, now);
      db.prepare("UPDATE workflows SET deployed_version = 1, deployed_definition = definition, deployed_at = ? WHERE id = ?").run(
        now,
        seed.id,
      );
      db.prepare(
        "INSERT INTO deployments (id, workflow_id, version, definition, deployed_at) SELECT ?, id, 1, definition, ? FROM workflows WHERE id = ?",
      ).run(newDeploymentId(), now, seed.id);
    }
  }
  return db;
}

/** Holds everything created before workspaces existed (and the sample flows of a new database). */
export const DEFAULT_WORKSPACE_ID = "ws_default";

const VARIABLES_TABLE = `
  CREATE TABLE IF NOT EXISTS variables (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, environment, name)
  );`;

function tableExists(conn: DatabaseSync, table: string) {
  return Boolean(conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function hasColumn(conn: DatabaseSync, table: string, column: string) {
  return (conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

function ensureDefaultWorkspace(conn: DatabaseSync) {
  conn
    .prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, 'Default', ?)")
    .run(DEFAULT_WORKSPACE_ID, new Date().toISOString());
}

/**
 * Adds `workspace_id` to a table created before workspaces, moving its rows into the "Default" workspace.
 * (SQLite can only add a foreign-key column whose default is NULL, so rows are filled in afterwards.)
 */
export function addWorkspaceColumn(conn: DatabaseSync, table: string) {
  if (hasColumn(conn, table, "workspace_id")) return;
  ensureDefaultWorkspace(conn);
  conn.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE`);
  conn.prepare(`UPDATE ${table} SET workspace_id = ?`).run(DEFAULT_WORKSPACE_ID);
}

// One connection per server process; kept on globalThis so dev-mode HMR doesn't leak handles.
const globalForDb = globalThis as unknown as { reqoraDb?: DatabaseSync };
export function db() {
  return (globalForDb.reqoraDb ??= open());
}

/** Runs stored before environments existed default to production. */
function parseRun(data: string): Run {
  const run = JSON.parse(data) as Omit<Run, "environment"> & { environment?: Run["environment"] };
  return { ...run, environment: run.environment ?? "production" };
}

function insertWorkflow(conn: DatabaseSync, workspaceId: string, id: string, input: WorkflowInput, now: string) {
  conn
    .prepare(
      "INSERT INTO workflows (id, workspace_id, name, description, version, definition, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
    )
    .run(id, workspaceId, input.name, input.description ?? null, definitionJson(input), now, now);
}

/** What a draft or deployment stores: the graph and the flow's roles. */
const definitionJson = (input: Pick<WorkflowInput, "nodes" | "edges" | "roles">) =>
  JSON.stringify({ nodes: input.nodes, edges: input.edges, ...(input.roles?.length ? { roles: input.roles } : {}) });

function toWorkflow(row: WorkflowRow): Workflow {
  const { nodes, edges, roles } = JSON.parse(row.definition) as Pick<Workflow, "nodes" | "edges" | "roles">;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    version: row.version,
    ...(roles?.length ? { roles } : {}),
    nodes,
    edges,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deployed_version === null ? {} : { deployment: { version: row.deployed_version, deployedAt: row.deployed_at! } }),
  };
}

export function listWorkflows(workspaceId: string): WorkflowSummary[] {
  const rows = db().prepare("SELECT * FROM workflows WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as WorkflowRow[];
  return rows.map((row) => {
    const wf = toWorkflow(row);
    return {
      id: wf.id,
      name: wf.name,
      ...(wf.description === undefined ? {} : { description: wf.description }),
      version: wf.version,
      nodeCount: wf.nodes.length,
      updatedAt: wf.updatedAt,
      ...(wf.deployment ? { deployment: wf.deployment } : {}),
    };
  });
}

/** Every workflow of a workspace with its full draft definition (for cross-workflow scans such as variable usage). */
export function allWorkflows(workspaceId: string): Workflow[] {
  return (db().prepare("SELECT * FROM workflows WHERE workspace_id = ? ORDER BY name").all(workspaceId) as WorkflowRow[]).map(toWorkflow);
}

/** The workspace a workflow belongs to (undefined when it doesn't exist). */
export function workflowWorkspace(id: string): string | undefined {
  return (db().prepare("SELECT workspace_id FROM workflows WHERE id = ?").get(id) as { workspace_id: string } | undefined)?.workspace_id;
}

/** The workspace a run belongs to. */
export function runWorkspace(id: string): string | undefined {
  return (db().prepare("SELECT workspace_id FROM runs WHERE id = ?").get(id) as { workspace_id: string } | undefined)?.workspace_id;
}

/** The deployed snapshot that webhooks execute, or undefined if never deployed. */
export function getDeployedWorkflow(id: string): Workflow | undefined {
  const row = db().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
  if (!row || row.deployed_definition === null) return undefined;
  return { ...toWorkflow({ ...row, definition: row.deployed_definition }), version: row.deployed_version! };
}

export type DeployResult = { ok: true; workflow: Workflow } | { ok: false; reason: "not_found" | "conflict"; current?: number };

const newDeploymentId = () => `dep_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

type DeployedBy = { id: string; name: string };

/**
 * Snapshots the current draft as the live version, if the caller has seen that exact version, and records it in
 * the deployment history.
 */
export function deployWorkflow(id: string, expectedVersion: number, by?: DeployedBy): DeployResult {
  const conn = db();
  const at = new Date().toISOString();
  conn.exec("BEGIN");
  let changes: number;
  try {
    changes = Number(
      conn
        .prepare(
          `UPDATE workflows SET deployed_version = version, deployed_definition = definition, deployed_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(at, id, expectedVersion).changes,
    );
    if (changes === 1) {
      conn
        .prepare(
          `INSERT INTO deployments (id, workflow_id, version, definition, deployed_at, deployed_by)
           SELECT ?, id, version, definition, ?, ? FROM workflows WHERE id = ?`,
        )
        .run(newDeploymentId(), at, by ? JSON.stringify(by) : null, id);
    }
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
  if (changes === 1) return { ok: true, workflow: getWorkflow(id)! };
  const existing = getWorkflow(id);
  return existing ? { ok: false, reason: "conflict", current: existing.version } : { ok: false, reason: "not_found" };
}

export function getWorkflow(id: string): Workflow | undefined {
  const row = db().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
  return row && toWorkflow(row);
}

export function createWorkflow(workspaceId: string, input: WorkflowInput): Workflow {
  const id = `wf_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  insertWorkflow(db(), workspaceId, id, input, new Date().toISOString());
  return getWorkflow(id)!;
}

export type ReplaceResult = { ok: true; workflow: Workflow } | { ok: false; reason: "not_found" | "conflict"; current?: number };

export function replaceWorkflow(id: string, input: WorkflowInput, expectedVersion: number): ReplaceResult {
  const result = db()
    .prepare(
      `UPDATE workflows SET name = ?, description = ?, definition = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .run(
      input.name,
      input.description ?? null,
      definitionJson(input),
      new Date().toISOString(),
      id,
      expectedVersion,
    );
  if (result.changes === 1) return { ok: true, workflow: getWorkflow(id)! };

  const existing = getWorkflow(id);
  return existing ? { ok: false, reason: "conflict", current: existing.version } : { ok: false, reason: "not_found" };
}

export function deleteWorkflow(id: string): boolean {
  return db().prepare("DELETE FROM workflows WHERE id = ?").run(id).changes === 1;
}

/** Stores a run in its workflow's workspace. */
export function insertRun(run: Run) {
  db()
    .prepare(
      `INSERT INTO runs (id, workspace_id, workflow_id, status, started_at, data)
       SELECT ?, workspace_id, id, ?, ?, ? FROM workflows WHERE id = ?`,
    )
    .run(run.id, run.status, run.startedAt, JSON.stringify(run), run.workflowId);
}

export function getRun(id: string): Run | undefined {
  const row = db().prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
  return row && parseRun(row.data);
}

export type RunQuery = { workspaceId: string; limit: number; since?: string; status?: Run["status"]; workflowId?: string };

/** Runs across a workspace's workflows, newest first. */
export function queryRuns({ workspaceId, limit, since, status, workflowId }: RunQuery): Run[] {
  const filters: [string, string | undefined][] = [
    ["workspace_id = ?", workspaceId],
    ["started_at >= ?", since],
    ["status = ?", status],
    ["workflow_id = ?", workflowId],
  ];
  const active = filters.filter(([, value]) => value !== undefined) as [string, string][];
  const where = active.map(([clause]) => clause);
  const params = active.map(([, value]) => value);
  const rows = db()
    .prepare(
      `SELECT data FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...params, limit) as { data: string }[];
  return rows.map((row) => parseRun(row.data));
}

/** Deletes a workspace's stored runs (one workflow's, or all); returns how many. */
export function deleteRuns(workspaceId: string, workflowId?: string): number {
  const statement = workflowId
    ? db().prepare("DELETE FROM runs WHERE workspace_id = ? AND workflow_id = ?").run(workspaceId, workflowId)
    : db().prepare("DELETE FROM runs WHERE workspace_id = ?").run(workspaceId);
  return Number(statement.changes);
}

/** A workspace's runs started in [from, to). */
export function countRuns(workspaceId: string, from: string, to: string): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE workspace_id = ? AND started_at >= ? AND started_at < ?")
    .get(workspaceId, from, to) as { n: number };
  return Number(row.n);
}

export type RunStats = {
  total: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export function runStats(workspaceId: string, since: string): RunStats {
  const rows = db()
    .prepare("SELECT status, json_extract(data, '$.durationMs') AS duration FROM runs WHERE workspace_id = ? AND started_at >= ?")
    .all(workspaceId, since) as { status: Run["status"]; duration: number }[];
  const durations = rows.map((r) => r.duration).sort((a, b) => a - b);
  const succeeded = rows.filter((r) => r.status === "succeeded").length;
  return {
    total: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    successRate: rows.length ? succeeded / rows.length : null,
    avgDurationMs: rows.length ? Math.round(durations.reduce((a, b) => a + b, 0) / rows.length) : null,
    p95DurationMs: rows.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : null,
  };
}

export function listRuns(workflowId: string, limit: number): Run[] {
  const rows = db()
    .prepare("SELECT data FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(workflowId, limit) as { data: string }[];
  return rows.map((row) => parseRun(row.data));
}

type DeploymentRow = {
  id: string;
  workflow_id: string;
  version: number;
  definition: string;
  deployed_at: string;
  deployed_by: string | null;
  rollback_of: string | null;
};

function toDeployment(row: DeploymentRow, liveId: string | undefined, versions: Map<string, number>): DeploymentDetail {
  const { nodes, edges, roles } = JSON.parse(row.definition) as Pick<Workflow, "nodes" | "edges" | "roles">;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    deployedAt: row.deployed_at,
    ...(row.deployed_by ? { deployedBy: JSON.parse(row.deployed_by) as DeployedBy } : {}),
    ...(row.rollback_of ? { rollbackOf: { id: row.rollback_of, version: versions.get(row.rollback_of) ?? 0 } } : {}),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    live: row.id === liveId,
    ...(roles?.length ? { roles } : {}),
    nodes,
    edges,
  };
}

function deploymentRows(workflowId: string): DeploymentRow[] {
  return db()
    .prepare("SELECT * FROM deployments WHERE workflow_id = ? ORDER BY deployed_at DESC, rowid DESC")
    .all(workflowId) as DeploymentRow[];
}

/** The workflow's deployment history, newest first (the newest entry is the live one). */
export function listDeployments(workflowId: string, limit = 50): DeploymentRecord[] {
  const rows = deploymentRows(workflowId);
  const versions = new Map(rows.map((r) => [r.id, r.version]));
  return rows.slice(0, limit).map((row) => {
    const { nodes: _nodes, edges: _edges, ...record } = toDeployment(row, rows[0]?.id, versions);
    void _nodes;
    void _edges;
    return record;
  });
}

export function getDeployment(workflowId: string, deploymentId: string): DeploymentDetail | undefined {
  const rows = deploymentRows(workflowId);
  const row = rows.find((r) => r.id === deploymentId);
  return row && toDeployment(row, rows[0]?.id, new Map(rows.map((r) => [r.id, r.version])));
}

export type RollbackResult = { ok: true; workflow: Workflow } | { ok: false; reason: "not_found" | "already_live" };

/**
 * Makes an earlier deployment live again (webhooks run it from now on) and records that as a new history entry.
 * The draft is left as it is.
 */
export function rollbackDeployment(workflowId: string, deploymentId: string, by?: DeployedBy): RollbackResult {
  const rows = deploymentRows(workflowId);
  const target = rows.find((r) => r.id === deploymentId);
  if (!target) return { ok: false, reason: "not_found" };
  if (rows[0]?.id === deploymentId) return { ok: false, reason: "already_live" };
  const conn = db();
  const at = new Date().toISOString();
  conn.exec("BEGIN");
  try {
    conn
      .prepare("UPDATE workflows SET deployed_version = ?, deployed_definition = ?, deployed_at = ? WHERE id = ?")
      .run(target.version, target.definition, at, workflowId);
    conn
      .prepare(
        "INSERT INTO deployments (id, workflow_id, version, definition, deployed_at, deployed_by, rollback_of) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(newDeploymentId(), workflowId, target.version, target.definition, at, by ? JSON.stringify(by) : null, target.id);
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, workflow: getWorkflow(workflowId)! };
}
