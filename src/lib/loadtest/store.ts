import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { db } from "@/lib/workflows/store";
import { toSummary, type LoadTest, type LoadTestSummary } from "./schema";

let ready = false;

function conn(): DatabaseSync {
  const database = db();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS load_tests (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS load_tests_by_workflow ON load_tests (workflow_id, started_at DESC);
    `);
    ready = true;
  }
  return database;
}

/** Inserts or replaces a load test report. */
export function saveLoadTest(test: LoadTest) {
  conn()
    .prepare("INSERT OR REPLACE INTO load_tests (id, workflow_id, status, started_at, data) VALUES (?, ?, ?, ?, ?)")
    .run(test.id, test.workflowId, test.status, test.startedAt, JSON.stringify(test));
}

export function getStoredLoadTest(id: string): LoadTest | undefined {
  const row = conn().prepare("SELECT data FROM load_tests WHERE id = ?").get(id) as { data: string } | undefined;
  return row && (JSON.parse(row.data) as LoadTest);
}

export function listStoredLoadTests(workflowId: string, limit: number): LoadTest[] {
  return (
    conn().prepare("SELECT data FROM load_tests WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?").all(workflowId, limit) as {
      data: string;
    }[]
  ).map((r) => JSON.parse(r.data) as LoadTest);
}

/** The workspace a load test belongs to (its workflow's). */
export function loadTestWorkspace(id: string): string | undefined {
  return (
    conn().prepare("SELECT w.workspace_id FROM load_tests t JOIN workflows w ON w.id = t.workflow_id WHERE t.id = ?").get(id) as
      | { workspace_id: string }
      | undefined
  )?.workspace_id;
}

export const summaries = (tests: LoadTest[]): LoadTestSummary[] => tests.map(toSummary);
