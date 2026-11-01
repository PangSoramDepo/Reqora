import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Run, Workflow, WorkflowInput, WorkflowSummary } from "./schema";
import { SEED_WORKFLOWS } from "./seed";

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  definition: string;
  created_at: string;
  updated_at: string;
};

function open(): DatabaseSync {
  const file = process.env.REQORA_DB_PATH ?? path.join(process.cwd(), ".data", "reqora.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER NOT NULL,
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_by_workflow ON runs (workflow_id, started_at DESC);
  `);

  const { count } = db.prepare("SELECT COUNT(*) AS count FROM workflows").get() as { count: number };
  if (count === 0) {
    const now = new Date().toISOString();
    for (const seed of SEED_WORKFLOWS) insertWorkflow(db, seed.id, seed.input, now);
  }
  return db;
}

// One connection per server process; kept on globalThis so dev-mode HMR doesn't leak handles.
const globalForDb = globalThis as unknown as { reqoraDb?: DatabaseSync };
function db() {
  return (globalForDb.reqoraDb ??= open());
}

function insertWorkflow(conn: DatabaseSync, id: string, input: WorkflowInput, now: string) {
  conn
    .prepare(
      "INSERT INTO workflows (id, name, description, version, definition, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    )
    .run(id, input.name, input.description ?? null, JSON.stringify({ nodes: input.nodes, edges: input.edges }), now, now);
}

function toWorkflow(row: WorkflowRow): Workflow {
  const { nodes, edges } = JSON.parse(row.definition) as Pick<Workflow, "nodes" | "edges">;
  return {
    id: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    version: row.version,
    nodes,
    edges,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorkflows(): WorkflowSummary[] {
  const rows = db().prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all() as WorkflowRow[];
  return rows.map((row) => {
    const wf = toWorkflow(row);
    return {
      id: wf.id,
      name: wf.name,
      ...(wf.description === undefined ? {} : { description: wf.description }),
      version: wf.version,
      nodeCount: wf.nodes.length,
      updatedAt: wf.updatedAt,
    };
  });
}

export function getWorkflow(id: string): Workflow | undefined {
  const row = db().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
  return row && toWorkflow(row);
}

export function createWorkflow(input: WorkflowInput): Workflow {
  const id = `wf_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  insertWorkflow(db(), id, input, new Date().toISOString());
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
      JSON.stringify({ nodes: input.nodes, edges: input.edges }),
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

export function insertRun(run: Run) {
  db()
    .prepare("INSERT INTO runs (id, workflow_id, status, started_at, data) VALUES (?, ?, ?, ?, ?)")
    .run(run.id, run.workflowId, run.status, run.startedAt, JSON.stringify(run));
}

export function getRun(id: string): Run | undefined {
  const row = db().prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
  return row && (JSON.parse(row.data) as Run);
}

export function listRuns(workflowId: string, limit: number): Run[] {
  const rows = db()
    .prepare("SELECT data FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(workflowId, limit) as { data: string }[];
  return rows.map((row) => JSON.parse(row.data) as Run);
}
