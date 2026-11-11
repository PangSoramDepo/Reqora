import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { decrypt, encrypt } from "@/lib/secrets/crypto";
import { resolveVariable } from "@/lib/secrets/variables";
import type { Environment } from "@/lib/workflows/schema";
import { db } from "@/lib/workflows/store";
import {
  type ColumnKind,
  SECRET_HINT,
  type TestUser,
  type TestUserColumn,
  type TestUserSettings,
  type TestUsersResponse,
  USER_NAME,
  ROLE_NAME,
} from "./schema";

let ready = false;
function conn(): DatabaseSync {
  const database = db();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS test_users (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        environment TEXT NOT NULL,
        name TEXT NOT NULL,
        roles TEXT NOT NULL,
        session_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, environment, name)
      );
      CREATE TABLE IF NOT EXISTS test_user_columns (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        environment TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, environment, name)
      );
      CREATE TABLE IF NOT EXISTS test_user_values (
        user_id TEXT NOT NULL REFERENCES test_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, name)
      );
      CREATE TABLE IF NOT EXISTS test_user_settings (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        environment TEXT NOT NULL,
        login_request_id TEXT,
        session_minutes INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, environment)
      );
    `);
    ready = true;
  }
  return database;
}

const now = () => new Date().toISOString();
const newId = () => `tu_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
// Binds each ciphertext to its user and name, so a value can't be moved to another user or column.
const aad = (userId: string, name: string) => `reqora:test-user:${userId}:${name}`;

type UserRow = { id: string; workspace_id: string; environment: Environment; name: string; roles: string; session_at: string | null; created_at: string; updated_at: string };
type Scope = { workspaceId: string; environment: Environment };

function columns({ workspaceId, environment }: Scope): TestUserColumn[] {
  return (
    conn()
      .prepare("SELECT name, kind FROM test_user_columns WHERE workspace_id = ? AND environment = ? ORDER BY position, name")
      .all(workspaceId, environment) as TestUserColumn[]
  ).map((c) => ({ name: c.name, kind: c.kind }));
}

function columnKind(scope: Scope, name: string): ColumnKind | undefined {
  return (
    conn()
      .prepare("SELECT kind FROM test_user_columns WHERE workspace_id = ? AND environment = ? AND name = ?")
      .get(scope.workspaceId, scope.environment, name) as { kind: ColumnKind } | undefined
  )?.kind;
}

/** Adds a column (new names default to secret when they look like a credential). */
function ensureColumn(scope: Scope, name: string, kind?: ColumnKind): ColumnKind {
  const existing = columnKind(scope, name);
  if (existing) return existing;
  const chosen = kind ?? (SECRET_HINT.test(name) ? "secret" : "plain");
  const { max } = conn()
    .prepare("SELECT MAX(position) AS max FROM test_user_columns WHERE workspace_id = ? AND environment = ?")
    .get(scope.workspaceId, scope.environment) as { max: number | null };
  conn()
    .prepare("INSERT INTO test_user_columns (workspace_id, environment, name, kind, position) VALUES (?, ?, ?, ?, ?)")
    .run(scope.workspaceId, scope.environment, name, chosen, (max ?? -1) + 1);
  return chosen;
}

function toUser(row: UserRow, kinds: Map<string, ColumnKind>): TestUser {
  const values = conn().prepare("SELECT name, value, updated_at FROM test_user_values WHERE user_id = ?").all(row.id) as {
    name: string;
    value: string;
    updated_at: string;
  }[];
  return {
    id: row.id,
    name: row.name,
    roles: JSON.parse(row.roles) as string[],
    sessionAt: row.session_at,
    values: Object.fromEntries(
      values.map((v) => [v.name, { value: kinds.get(v.name) === "secret" ? null : v.value, updatedAt: v.updated_at }]),
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSettings({ workspaceId, environment }: Scope): TestUserSettings {
  const row = conn()
    .prepare("SELECT login_request_id, session_minutes FROM test_user_settings WHERE workspace_id = ? AND environment = ?")
    .get(workspaceId, environment) as { login_request_id: string | null; session_minutes: number } | undefined;
  return { loginRequestId: row?.login_request_id ?? null, sessionMinutes: row?.session_minutes ?? 30 };
}

export function putSettings(scope: Scope, settings: TestUserSettings): TestUserSettings {
  conn()
    .prepare(
      `INSERT INTO test_user_settings (workspace_id, environment, login_request_id, session_minutes) VALUES (?, ?, ?, ?)
       ON CONFLICT (workspace_id, environment) DO UPDATE SET login_request_id = excluded.login_request_id, session_minutes = excluded.session_minutes`,
    )
    .run(scope.workspaceId, scope.environment, settings.loginRequestId, settings.sessionMinutes);
  // A different login means earlier sessions may not fit it any more.
  conn().prepare("UPDATE test_users SET session_at = NULL WHERE workspace_id = ? AND environment = ?").run(scope.workspaceId, scope.environment);
  return getSettings(scope);
}

/** Every test user of an environment with their (non-secret) values, the columns and the login settings. */
export function listTestUsers(scope: Scope): TestUsersResponse {
  const cols = columns(scope);
  const kinds = new Map(cols.map((c) => [c.name, c.kind]));
  const rows = conn()
    .prepare("SELECT * FROM test_users WHERE workspace_id = ? AND environment = ? ORDER BY name COLLATE NOCASE")
    .all(scope.workspaceId, scope.environment) as UserRow[];
  return { environment: scope.environment, users: rows.map((r) => toUser(r, kinds)), columns: cols, settings: getSettings(scope) };
}

function row(id: string): UserRow | undefined {
  return conn().prepare("SELECT * FROM test_users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getTestUser(id: string): TestUser | undefined {
  const r = row(id);
  return r && toUser(r, new Map(columns({ workspaceId: r.workspace_id, environment: r.environment }).map((c) => [c.name, c.kind])));
}

/** Where a test user lives (undefined when it doesn't exist). */
export function testUserScope(id: string): Scope | undefined {
  const r = row(id);
  return r && { workspaceId: r.workspace_id, environment: r.environment };
}

/** A user of the environment by id or by name. */
export function findTestUser(scope: Scope, ref: string): TestUser | undefined {
  const r = conn()
    .prepare("SELECT * FROM test_users WHERE workspace_id = ? AND environment = ? AND (id = ? OR name = ?)")
    .get(scope.workspaceId, scope.environment, ref, ref) as UserRow | undefined;
  return r && getTestUser(r.id);
}

/** Users with a role tag (case-insensitive), by name. */
export function usersWithRole(scope: Scope, role: string): TestUser[] {
  return listTestUsers(scope).users.filter((u) => u.roles.some((r) => r.toLowerCase() === role.toLowerCase()));
}

export type WriteResult = { ok: true; user: TestUser } | { ok: false; reason: "name_taken" | "not_found" };

function writeValues(userId: string, scope: Scope, values: Record<string, string | null>) {
  const at = now();
  for (const [name, value] of Object.entries(values)) {
    if (value === null) {
      conn().prepare("DELETE FROM test_user_values WHERE user_id = ? AND name = ?").run(userId, name);
      continue;
    }
    const kind = ensureColumn(scope, name);
    const stored = kind === "secret" ? encrypt(value, aad(userId, name)) : value;
    conn()
      .prepare(
        `INSERT INTO test_user_values (user_id, name, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(userId, name, stored, at);
  }
}

const nameTaken = (scope: Scope, name: string, except?: string) =>
  Boolean(
    conn()
      .prepare("SELECT 1 FROM test_users WHERE workspace_id = ? AND environment = ? AND name = ? AND id != ?")
      .get(scope.workspaceId, scope.environment, name, except ?? ""),
  );

export function createTestUser(scope: Scope, input: { name: string; roles: string[]; values: Record<string, string | null> }): WriteResult {
  if (nameTaken(scope, input.name)) return { ok: false, reason: "name_taken" };
  const id = newId();
  const at = now();
  conn().exec("BEGIN");
  try {
    conn()
      .prepare("INSERT INTO test_users (id, workspace_id, environment, name, roles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, scope.workspaceId, scope.environment, input.name, JSON.stringify(input.roles), at, at);
    writeValues(id, scope, input.values);
    conn().exec("COMMIT");
  } catch (error) {
    conn().exec("ROLLBACK");
    throw error;
  }
  return { ok: true, user: getTestUser(id)! };
}

export function updateTestUser(id: string, patch: { name?: string; roles?: string[]; values?: Record<string, string | null> }): WriteResult {
  const r = row(id);
  if (!r) return { ok: false, reason: "not_found" };
  const scope = { workspaceId: r.workspace_id, environment: r.environment };
  if (patch.name !== undefined && nameTaken(scope, patch.name, id)) return { ok: false, reason: "name_taken" };
  conn()
    .prepare("UPDATE test_users SET name = ?, roles = ?, updated_at = ? WHERE id = ?")
    .run(patch.name ?? r.name, JSON.stringify(patch.roles ?? JSON.parse(r.roles)), now(), id);
  if (patch.values) writeValues(id, scope, patch.values);
  return { ok: true, user: getTestUser(id)! };
}

export function deleteTestUser(id: string): boolean {
  return conn().prepare("DELETE FROM test_users WHERE id = ?").run(id).changes === 1;
}

/** Plaintext value for a run or send; undefined when the user has none. */
export function readUserValue(userId: string, name: string): string | undefined {
  const r = row(userId);
  if (!r) return undefined;
  const value = conn().prepare("SELECT value FROM test_user_values WHERE user_id = ? AND name = ?").get(userId, name) as
    | { value: string }
    | undefined;
  if (!value) return undefined;
  return columnKind({ workspaceId: r.workspace_id, environment: r.environment }, name) === "secret" ? decrypt(value.value, aad(userId, name)) : value.value;
}

/** Saves a value from a script (rq.user.set) or a login; null clears it. Returns the column's kind. */
export function writeUserValue(userId: string, name: string, value: string | null): ColumnKind | null {
  const r = row(userId);
  if (!r) throw new Error("the test user was deleted");
  const scope = { workspaceId: r.workspace_id, environment: r.environment };
  writeValues(userId, scope, { [name]: value });
  return value === null ? null : (columnKind(scope, name) ?? null);
}

/** Adds a column, or changes its kind (values are re-encrypted or decrypted). */
export function putColumn(scope: Scope, name: string, kind: ColumnKind): TestUserColumn {
  const previous = columnKind(scope, name);
  if (!previous) {
    ensureColumn(scope, name, kind);
    return { name, kind };
  }
  if (previous !== kind) {
    const values = conn()
      .prepare(
        `SELECT v.user_id, v.value FROM test_user_values v JOIN test_users u ON u.id = v.user_id
         WHERE u.workspace_id = ? AND u.environment = ? AND v.name = ?`,
      )
      .all(scope.workspaceId, scope.environment, name) as { user_id: string; value: string }[];
    conn().exec("BEGIN");
    try {
      for (const v of values) {
        const plain = previous === "secret" ? decrypt(v.value, aad(v.user_id, name)) : v.value;
        const stored = kind === "secret" ? encrypt(plain, aad(v.user_id, name)) : plain;
        conn().prepare("UPDATE test_user_values SET value = ? WHERE user_id = ? AND name = ?").run(stored, v.user_id, name);
      }
      conn()
        .prepare("UPDATE test_user_columns SET kind = ? WHERE workspace_id = ? AND environment = ? AND name = ?")
        .run(kind, scope.workspaceId, scope.environment, name);
      conn().exec("COMMIT");
    } catch (error) {
      conn().exec("ROLLBACK");
      throw error;
    }
  }
  return { name, kind };
}

/**
 * Puts the columns in the given order (every current column, each once). Returns the columns, or null when
 * `names` isn't exactly the current set (e.g. someone else added or removed one meanwhile).
 */
export function reorderColumns(scope: Scope, names: string[]): TestUserColumn[] | null {
  const current = columns(scope);
  const known = new Set(current.map((c) => c.name));
  if (names.length !== current.length || new Set(names).size !== names.length || !names.every((n) => known.has(n))) return null;
  conn().exec("BEGIN");
  try {
    const update = conn().prepare("UPDATE test_user_columns SET position = ? WHERE workspace_id = ? AND environment = ? AND name = ?");
    names.forEach((name, i) => update.run(i, scope.workspaceId, scope.environment, name));
    conn().exec("COMMIT");
  } catch (error) {
    conn().exec("ROLLBACK");
    throw error;
  }
  return columns(scope);
}

/** Removes a column and every user's value in it. */
export function deleteColumn(scope: Scope, name: string): boolean {
  conn()
    .prepare(
      `DELETE FROM test_user_values WHERE name = ? AND user_id IN (SELECT id FROM test_users WHERE workspace_id = ? AND environment = ?)`,
    )
    .run(name, scope.workspaceId, scope.environment);
  return (
    conn().prepare("DELETE FROM test_user_columns WHERE workspace_id = ? AND environment = ? AND name = ?").run(scope.workspaceId, scope.environment, name)
      .changes === 1
  );
}

/** Records a successful login (or clears it with null, so the next step logs in again). */
export function markSession(userId: string, at: string | null) {
  conn().prepare("UPDATE test_users SET session_at = ? WHERE id = ?").run(at, userId);
}

/** Splits one CSV line (quotes with "" escapes). */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

export type ImportResult = { created: number; updated: number; errors: string[] };

/**
 * Imports users from CSV: a header row `user,roles,<column>,…`, then one row per user. Roles are separated by
 * `;` or `|`. Existing users (same name) are updated; empty cells leave a value as it is.
 */
export function importTestUsers(scope: Scope, csv: string): ImportResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  if (lines.length < 2) return { ...result, errors: ["the CSV needs a header row and at least one user"] };
  const header = csvLine(lines[0]);
  const userCol = header.findIndex((h) => /^(user|name|username)$/i.test(h));
  const rolesCol = header.findIndex((h) => /^roles?$/i.test(h));
  if (userCol < 0) return { ...result, errors: ['the header needs a "user" column'] };
  const valueCols = header.map((h, i) => [h, i] as const).filter(([, i]) => i !== userCol && i !== rolesCol);
  const bad = valueCols.filter(([h]) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(h)).map(([h]) => h);
  if (bad.length) return { ...result, errors: [`invalid column names: ${bad.join(", ")} (letters, digits and _)`] };

  lines.slice(1).forEach((line, index) => {
    const cells = csvLine(line);
    const name = cells[userCol] ?? "";
    if (!USER_NAME.test(name)) {
      result.errors.push(`row ${index + 2}: invalid user name "${name}"`);
      return;
    }
    const roles = rolesCol >= 0 ? (cells[rolesCol] ?? "").split(/[;|]/).map((r) => r.trim()).filter(Boolean) : [];
    const badRole = roles.find((r) => !ROLE_NAME.test(r));
    if (badRole) {
      result.errors.push(`row ${index + 2}: invalid role "${badRole}"`);
      return;
    }
    const values = Object.fromEntries(valueCols.flatMap(([h, i]) => (cells[i] ? [[h, cells[i]]] : [])));
    const existing = findTestUser(scope, name);
    if (existing) {
      updateTestUser(existing.id, { ...(rolesCol >= 0 ? { roles } : {}), values });
      result.updated += 1;
    } else {
      createTestUser(scope, { name, roles, values });
      result.created += 1;
    }
  });
  return result;
}

/** CSV of the users: plain values filled in, secret columns left empty. */
export function exportTestUsers(scope: Scope): string {
  const { users, columns: cols } = listTestUsers(scope);
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = [["user", "roles", ...cols.map((c) => c.name)].join(",")];
  for (const u of users) {
    lines.push([u.name, u.roles.join(";"), ...cols.map((c) => (c.kind === "secret" ? "" : (u.values[c.name]?.value ?? "")))].map(quote).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** Creates a user from environment variables (same names), so existing setups move over in one step. */
export function userFromVariables(scope: Scope, input: { name: string; roles: string[]; variables: string[] }): WriteResult | { ok: false; reason: "missing"; names: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of input.variables) {
    const value = resolveVariable(scope.workspaceId, scope.environment, name);
    if (value === undefined) missing.push(name);
    else values[name] = value;
  }
  if (missing.length) return { ok: false, reason: "missing", names: missing };
  for (const name of input.variables) {
    // Keep the variable's kind.
    const secret = (conn()
      .prepare("SELECT kind FROM variables WHERE workspace_id = ? AND environment = ? AND name = ?")
      .get(scope.workspaceId, scope.environment, name) as { kind: ColumnKind } | undefined)?.kind;
    if (secret) ensureColumn(scope, name, secret);
  }
  return createTestUser(scope, { name: input.name, roles: input.roles, values });
}
