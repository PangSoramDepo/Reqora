#!/usr/bin/env node
// Admin CLI for accounts (there is no email delivery, so password resets happen here).
//   npm run user -- create <email> "<name>"     prompts for a password
//   npm run user -- reset-password <email>      prompts for a new password, signs out that user everywhere
//   npm run user -- list
// Uses REQORA_DB_PATH, defaulting to .data/reqora.db. Hash format matches src/lib/auth/password.ts.
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";

const MIN_PASSWORD_LENGTH = 10;
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

async function askPassword() {
  if (process.env.REQORA_PASSWORD) return process.env.REQORA_PASSWORD; // non-interactive use
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question(`Password (min ${MIN_PASSWORD_LENGTH} chars): `);
  rl.close();
  return password;
}

const db = new DatabaseSync(process.env.REQORA_DB_PATH ?? path.join(process.cwd(), ".data", "reqora.db"));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
`);

const [command, rawEmail, name] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (command === "list") {
  for (const u of db.prepare("SELECT email, name, created_at FROM users ORDER BY created_at").all()) {
    console.log(`${u.email}\t${u.name}\t${u.created_at}`);
  }
} else if (command === "create") {
  if (!email || !name) fail('usage: npm run user -- create <email> "<name>"');
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fail(`${email} already exists`);
  const password = await askPassword();
  if (password.length < MIN_PASSWORD_LENGTH) fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
    `usr_${randomBytes(8).toString("hex")}`,
    email,
    name.trim(),
    hashPassword(password),
    new Date().toISOString(),
  );
  console.log(`created ${email}`);
} else if (command === "reset-password") {
  if (!email) fail("usage: npm run user -- reset-password <email>");
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!user) fail(`no user ${email}`);
  const password = await askPassword();
  if (password.length < MIN_PASSWORD_LENGTH) fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  console.log(`password reset for ${email}; existing sessions signed out`);
} else {
  fail('usage: npm run user -- <create <email> "<name>" | reset-password <email> | list>');
}
