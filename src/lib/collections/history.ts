import "server-only";

import type { DatabaseSync } from "node:sqlite";
import type { Environment } from "@/lib/workflows/schema";
import { db } from "@/lib/workflows/store";
import type { RequestMethod, ScriptReport, SendOutcome } from "./schema";

/** How many sends are kept; older ones are pruned on insert. */
const KEEP = 500;

/**
 * One Collections send, as shown in the Live Execution Console. Values come from the already-scrubbed
 * outcome, and the response body is not stored — only status, timing, tests and script output.
 */
export type SendRecord = {
  id: string;
  requestId: string | null;
  collectionId: string | null;
  name: string;
  method: string;
  url: string;
  environment: Environment;
  status: number | null;
  statusText: string | null;
  error: string | null;
  durationMs: number;
  size: number | null;
  tests: { passed: number; total: number };
  scripts: ScriptReport | null;
  sentAt: string;
};

type Row = {
  id: string;
  request_id: string | null;
  collection_id: string | null;
  name: string;
  method: string;
  url: string;
  environment: Environment;
  status: number | null;
  status_text: string | null;
  error: string | null;
  duration_ms: number;
  size: number | null;
  tests_passed: number;
  tests_total: number;
  scripts: string | null;
  sent_at: string;
};

let ready = false;
function conn(): DatabaseSync {
  const database = db();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS request_sends (
        id TEXT PRIMARY KEY,
        request_id TEXT,
        collection_id TEXT,
        name TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        environment TEXT NOT NULL,
        status INTEGER,
        status_text TEXT,
        error TEXT,
        duration_ms INTEGER NOT NULL,
        size INTEGER,
        tests_passed INTEGER NOT NULL,
        tests_total INTEGER NOT NULL,
        scripts TEXT,
        sent_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sends_by_time ON request_sends (sent_at);
    `);
    ready = true;
  }
  return database;
}

export type SendContext = {
  requestId?: string | null;
  collectionId?: string | null;
  name: string;
  method: RequestMethod | string;
  /** Used when the outcome has no resolved URL (e.g. a template or pre-request script error). */
  url: string;
  environment: Environment;
};

export function recordSend(ctx: SendContext, outcome: SendOutcome): SendRecord {
  const ok = "status" in outcome;
  const scriptTests = outcome.scripts?.tests ?? [];
  const assertions = ok ? outcome.assertions : [];
  const passed = assertions.filter((a) => a.passed).length + scriptTests.filter((t) => t.passed).length;
  const total = assertions.length + scriptTests.length;
  const record: SendRecord = {
    id: `snd_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    requestId: ctx.requestId ?? null,
    collectionId: ctx.collectionId ?? null,
    name: ctx.name,
    method: ctx.method,
    url: outcome.url ?? ctx.url,
    environment: ctx.environment,
    status: ok ? outcome.status : null,
    statusText: ok ? outcome.statusText : null,
    error: ok ? null : outcome.error,
    durationMs: outcome.durationMs,
    size: ok ? outcome.size : null,
    tests: { passed, total },
    scripts: outcome.scripts ?? null,
    sentAt: new Date().toISOString(),
  };
  const database = conn();
  database
    .prepare(
      `INSERT INTO request_sends (id, request_id, collection_id, name, method, url, environment, status, status_text, error,
         duration_ms, size, tests_passed, tests_total, scripts, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.requestId,
      record.collectionId,
      record.name,
      record.method,
      record.url,
      record.environment,
      record.status,
      record.statusText,
      record.error,
      record.durationMs,
      record.size,
      passed,
      total,
      record.scripts ? JSON.stringify(record.scripts) : null,
      record.sentAt,
    );
  database
    .prepare(`DELETE FROM request_sends WHERE id NOT IN (SELECT id FROM request_sends ORDER BY sent_at DESC LIMIT ?)`)
    .run(KEEP);
  return record;
}

export function listSends(limit = 25): SendRecord[] {
  const rows = conn()
    .prepare("SELECT * FROM request_sends ORDER BY sent_at DESC, rowid DESC LIMIT ?")
    .all(Math.min(Math.max(1, limit), 200)) as Row[];
  return rows.map((r) => ({
    id: r.id,
    requestId: r.request_id,
    collectionId: r.collection_id,
    name: r.name,
    method: r.method,
    url: r.url,
    environment: r.environment,
    status: r.status,
    statusText: r.status_text,
    error: r.error,
    durationMs: r.duration_ms,
    size: r.size,
    tests: { passed: r.tests_passed, total: r.tests_total },
    scripts: r.scripts ? (JSON.parse(r.scripts) as ScriptReport) : null,
    sentAt: r.sent_at,
  }));
}
