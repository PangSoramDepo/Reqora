import "server-only";

import type { DatabaseSync } from "node:sqlite";
import type { Environment } from "@/lib/workflows/schema";
import { db } from "@/lib/workflows/store";
import type { RequestMethod, ScriptReport, SendOutcome, SentRequest } from "./schema";

/** How many sends are kept; older ones are pruned on insert. */
const KEEP = 200;
/** Response bodies above this are stored truncated (the console is for inspection, not archiving). */
const MAX_BODY_CHARS = 256 * 1024;

export type LoggedResponse = { headers: Record<string, string>; body: string; truncated: boolean };

/**
 * One Collections send, as shown in the Live Execution Console: the request as sent and the response
 * (headers and body, capped), tests and script output. Like Postman's console, it is recorded
 * before scrubbing, so resolved env/secret values appear (and copy) as their real values.
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
  /** null when the send failed before a request was built (e.g. a pre-request script error). */
  request: SentRequest | null;
  response: LoggedResponse | null;
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
  request: string | null;
  response: string | null;
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
    // Request/response logging arrived after the first version of this table.
    const cols = new Set((database.prepare("PRAGMA table_info(request_sends)").all() as { name: string }[]).map((c) => c.name));
    for (const column of ["request", "response"]) {
      if (!cols.has(column)) database.exec(`ALTER TABLE request_sends ADD COLUMN ${column} TEXT`);
    }
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
  let response: LoggedResponse | null = null;
  if (ok) {
    const text = typeof outcome.body === "string" ? outcome.body : (JSON.stringify(outcome.body) ?? "");
    response = { headers: outcome.headers, body: text.slice(0, MAX_BODY_CHARS), truncated: text.length > MAX_BODY_CHARS };
  }
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
    request: outcome.request ?? null,
    response,
    sentAt: new Date().toISOString(),
  };
  const database = conn();
  database
    .prepare(
      `INSERT INTO request_sends (id, request_id, collection_id, name, method, url, environment, status, status_text, error,
         duration_ms, size, tests_passed, tests_total, scripts, request, response, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      record.request ? JSON.stringify(record.request) : null,
      record.response ? JSON.stringify(record.response) : null,
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
    request: r.request ? (JSON.parse(r.request) as SentRequest) : null,
    response: r.response ? (JSON.parse(r.response) as LoggedResponse) : null,
    sentAt: r.sent_at,
  }));
}
