import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/workflows/store";

export type User = { id: string; email: string; name: string; createdAt: string };

type UserRow = { id: string; email: string; name: string; password_hash: string; created_at: string };

let ready = false;
function conn() {
  const d = db();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
    `);
    ready = true;
  }
  return d;
}

const toUser = (row: UserRow): User => ({ id: row.id, email: row.email, name: row.name, createdAt: row.created_at });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function countUsers(): number {
  return (conn().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function findUserByEmail(email: string): (User & { passwordHash: string }) | undefined {
  const row = conn().prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined;
  return row && { ...toUser(row), passwordHash: row.password_hash };
}

export function insertUser(input: { email: string; name: string; passwordHash: string }): User {
  const user: User = {
    id: `usr_${randomBytes(8).toString("hex")}`,
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    createdAt: new Date().toISOString(),
  };
  conn()
    .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(user.id, user.email, user.name, input.passwordHash, user.createdAt);
  return user;
}

// Only a hash of the session token is stored, so a leaked database can't be replayed as live sessions.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(userId: string, ttlMs: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs);
  const d = conn();
  d.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date(now).toISOString());
  d.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function userForSession(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const row = conn()
    .prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), new Date().toISOString()) as UserRow | undefined;
  return row && toUser(row);
}

export function deleteSession(token: string | undefined) {
  if (token) conn().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function passwordHashOf(userId: string): string | undefined {
  return (conn().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined)
    ?.password_hash;
}

/** Sets a new password hash and signs the user out of every other session (`keepToken` stays signed in). */
export function updatePassword(userId: string, passwordHash: string, keepToken: string | undefined) {
  const d = conn();
  d.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  d.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, keepToken ? hashToken(keepToken) : "");
}
