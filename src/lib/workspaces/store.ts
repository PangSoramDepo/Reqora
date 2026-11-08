import "server-only";

import { DEFAULT_WORKSPACE_ID, db } from "@/lib/workflows/store";
import type { Member, Role, Workspace } from "./schema";

const newId = () => `ws_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

type WorkspaceRow = { id: string; name: string; created_at: string; role: Role; member_count: number };

const toWorkspace = (r: WorkspaceRow): Workspace => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  role: r.role,
  memberCount: Number(r.member_count),
});

const WORKSPACES_OF = `
  SELECT w.id, w.name, w.created_at, m.role,
    (SELECT COUNT(*) FROM workspace_members x WHERE x.workspace_id = w.id) AS member_count
  FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?`;

/** The workspaces a user belongs to, by name. */
export function workspacesOf(userId: string): Workspace[] {
  return (db().prepare(`${WORKSPACES_OF} ORDER BY w.name COLLATE NOCASE, w.created_at`).all(userId) as WorkspaceRow[]).map(toWorkspace);
}

export function workspaceOf(userId: string, workspaceId: string): Workspace | undefined {
  const row = db().prepare(`${WORKSPACES_OF} WHERE w.id = ?`).get(userId, workspaceId) as WorkspaceRow | undefined;
  return row && toWorkspace(row);
}

export function workspaceExists(id: string): boolean {
  return Boolean(db().prepare("SELECT 1 FROM workspaces WHERE id = ?").get(id));
}

export function roleIn(workspaceId: string, userId: string): Role | undefined {
  return (
    db().prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as
      | { role: Role }
      | undefined
  )?.role;
}

export function createWorkspace(name: string, ownerId: string): Workspace {
  const id = newId();
  const at = new Date().toISOString();
  const conn = db();
  conn.exec("BEGIN");
  try {
    conn.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(id, name, at);
    conn.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, ownerId, at);
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
  return workspaceOf(ownerId, id)!;
}

export function renameWorkspace(id: string, name: string): boolean {
  return db().prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, id).changes === 1;
}

/** Deletes the workspace and everything in it (flows, runs, collections, secrets, history). */
export function deleteWorkspace(id: string): boolean {
  return db().prepare("DELETE FROM workspaces WHERE id = ?").run(id).changes === 1;
}

/**
 * Makes sure a signed-in user has a workspace: the first account takes over an unowned "Default" workspace
 * (a new database's sample flows); anyone else gets a workspace of their own.
 */
export function ensureWorkspace(user: { id: string; name: string }): Workspace[] {
  const existing = workspacesOf(user.id);
  if (existing.length) return existing;
  const conn = db();
  const unowned = conn
    .prepare("SELECT 1 FROM workspaces w WHERE w.id = ? AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id)")
    .get(DEFAULT_WORKSPACE_ID);
  if (unowned) {
    conn
      .prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)")
      .run(DEFAULT_WORKSPACE_ID, user.id, new Date().toISOString());
  } else {
    const first = user.name.trim().split(/\s+/)[0] || "My";
    createWorkspace(`${first}'s workspace`, user.id);
  }
  return workspacesOf(user.id);
}

export function listMembers(workspaceId: string): Member[] {
  const rows = db()
    .prepare(
      `SELECT u.id, u.name, u.email, m.role, m.added_at FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`,
    )
    .all(workspaceId) as { id: string; name: string; email: string; role: Role; added_at: string }[];
  return rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, role: r.role, addedAt: r.added_at }));
}

export type MemberResult = { ok: true; member: Member } | { ok: false; reason: "already_member" | "not_member" | "last_owner" };

export function addMember(workspaceId: string, userId: string, role: Role): MemberResult {
  if (roleIn(workspaceId, userId)) return { ok: false, reason: "already_member" };
  db()
    .prepare("INSERT INTO workspace_members (workspace_id, user_id, role, added_at) VALUES (?, ?, ?, ?)")
    .run(workspaceId, userId, role, new Date().toISOString());
  return { ok: true, member: listMembers(workspaceId).find((m) => m.userId === userId)! };
}

const ownerCount = (workspaceId: string) =>
  Number(
    (db().prepare("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(workspaceId) as { n: number }).n,
  );

/** Changes a member's role; a workspace always keeps at least one owner. */
export function setMemberRole(workspaceId: string, userId: string, role: Role): MemberResult {
  const current = roleIn(workspaceId, userId);
  if (!current) return { ok: false, reason: "not_member" };
  if (current === "owner" && role !== "owner" && ownerCount(workspaceId) === 1) return { ok: false, reason: "last_owner" };
  db().prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?").run(role, workspaceId, userId);
  return { ok: true, member: listMembers(workspaceId).find((m) => m.userId === userId)! };
}

/** Removes a member (or lets someone leave); the last owner can't go. */
export function removeMember(workspaceId: string, userId: string): { ok: true } | { ok: false; reason: "not_member" | "last_owner" } {
  const current = roleIn(workspaceId, userId);
  if (!current) return { ok: false, reason: "not_member" };
  if (current === "owner" && ownerCount(workspaceId) === 1) return { ok: false, reason: "last_owner" };
  db().prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
  return { ok: true };
}
