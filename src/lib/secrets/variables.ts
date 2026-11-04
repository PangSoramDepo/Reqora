import "server-only";

import type { Environment, Variable } from "@/lib/workflows/schema";
import { db } from "@/lib/workflows/store";
import { decrypt, encrypt } from "./crypto";

type VariableRow = {
  environment: Environment;
  name: string;
  kind: Variable["kind"];
  value: string;
  description: string | null;
  updated_at: string;
};

// Binds each ciphertext to its slot so a value can't be copied to another name or environment.
const aad = (environment: Environment, name: string) => `reqora:variable:${environment}:${name}`;

export function listVariables(environment: Environment): Variable[] {
  const rows = db()
    .prepare("SELECT * FROM variables WHERE environment = ? ORDER BY name")
    .all(environment) as VariableRow[];
  return rows.map((row) => ({
    name: row.name,
    kind: row.kind,
    value: row.kind === "secret" ? null : row.value,
    ...(row.description === null ? {} : { description: row.description }),
    updatedAt: row.updated_at,
  }));
}

export function putVariable(
  environment: Environment,
  name: string,
  input: { kind: Variable["kind"]; value: string; description?: string },
): { created: boolean } {
  const existed = db().prepare("SELECT 1 FROM variables WHERE environment = ? AND name = ?").get(environment, name);
  const stored = input.kind === "secret" ? encrypt(input.value, aad(environment, name)) : input.value;
  db()
    .prepare(
      `INSERT INTO variables (environment, name, kind, value, description, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (environment, name) DO UPDATE SET
         kind = excluded.kind, value = excluded.value, description = excluded.description, updated_at = excluded.updated_at`,
    )
    .run(environment, name, input.kind, stored, input.description ?? null, new Date().toISOString());
  return { created: !existed };
}

export function deleteVariable(environment: Environment, name: string): boolean {
  return db().prepare("DELETE FROM variables WHERE environment = ? AND name = ?").run(environment, name).changes === 1;
}

/** Plaintext value for workflow execution; undefined when the variable isn't set in that environment. */
export function resolveVariable(environment: Environment, name: string): string | undefined {
  const row = db()
    .prepare("SELECT kind, value FROM variables WHERE environment = ? AND name = ?")
    .get(environment, name) as Pick<VariableRow, "kind" | "value"> | undefined;
  if (!row) return undefined;
  return row.kind === "secret" ? decrypt(row.value, aad(environment, name)) : row.value;
}

/**
 * Writes a value from a script (rq.environment.set): keeps an existing variable's kind and description,
 * so setting a secret stays encrypted; new names are stored as plain. `null` deletes the variable.
 */
export function setVariableValue(environment: Environment, name: string, value: string | null): { kind: Variable["kind"] | null } {
  if (value === null) {
    deleteVariable(environment, name);
    return { kind: null };
  }
  const existing = db()
    .prepare("SELECT kind, description FROM variables WHERE environment = ? AND name = ?")
    .get(environment, name) as Pick<VariableRow, "kind" | "description"> | undefined;
  const kind = existing?.kind ?? "plain";
  putVariable(environment, name, { kind, value, ...(existing?.description ? { description: existing.description } : {}) });
  return { kind };
}
