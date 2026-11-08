import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

// A database as Reqora left it before workspaces existed.
const dir = mkdtempSync(path.join(tmpdir(), "reqora-migration-"));
const file = path.join(dir, "old.db");
{
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO users VALUES ('usr_first', 'first@example.com', 'First', 'x', '2026-01-01T00:00:00Z');
    INSERT INTO users VALUES ('usr_second', 'second@example.com', 'Second', 'x', '2026-02-01T00:00:00Z');
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, version INTEGER NOT NULL,
      definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO workflows VALUES ('wf_old', 'Old flow', NULL, 3, '{"nodes":[],"edges":[]}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    CREATE TABLE runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL, started_at TEXT NOT NULL, data TEXT NOT NULL);
    INSERT INTO runs VALUES ('run_old', 'wf_old', 'succeeded', '2026-01-02T00:00:00Z',
      '{"id":"run_old","workflowId":"wf_old","workflowVersion":3,"status":"succeeded","trigger":{"source":"manual"},"startedAt":"2026-01-02T00:00:00Z","finishedAt":"2026-01-02T00:00:00Z","durationMs":1,"steps":[]}');
    CREATE TABLE variables (environment TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
      description TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (environment, name));
    INSERT INTO variables VALUES ('sandbox', 'BASE', 'plain', 'https://old.test', NULL, '2026-01-01T00:00:00Z');
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO collections VALUES ('col_old', 'Old API', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
  old.close();
}
process.env.REQORA_DB_PATH = file;

afterAll(() => {
  const g = globalThis as unknown as { reqoraDb?: DatabaseSync };
  g.reqoraDb?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("upgrading a database from before workspaces", () => {
  it("moves everything into the Default workspace and keeps every existing user in it", async () => {
    const flows = await import("@/lib/workflows/store");
    const ws = await import("./store");
    const collections = await import("@/lib/collections/store");
    const variables = await import("@/lib/secrets/variables");
    const DEFAULT = flows.DEFAULT_WORKSPACE_ID;

    expect(flows.listWorkflows(DEFAULT).map((w) => w.id)).toEqual(["wf_old"]);
    expect(flows.queryRuns({ workspaceId: DEFAULT, limit: 10 }).map((r) => r.id)).toEqual(["run_old"]);
    expect(variables.resolveVariable(DEFAULT, "sandbox", "BASE")).toBe("https://old.test");
    expect(collections.listCollections(DEFAULT).map((c) => c.id)).toEqual(["col_old"]);
    expect(ws.listMembers(DEFAULT).map((m) => [m.userId, m.role])).toEqual([
      ["usr_first", "owner"],
      ["usr_second", "editor"],
    ]);
    // The sample flows aren't added to a database that already had data.
    expect(flows.listWorkflows(DEFAULT)).toHaveLength(1);
  });
});
