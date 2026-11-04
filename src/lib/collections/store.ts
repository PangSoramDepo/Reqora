import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { db } from "@/lib/workflows/store";
import type { ImportedCollection } from "./openapi";
import {
  emptyDefinition,
  emptyScopeSettings,
  requestDefinitionSchema,
  scopeSettingsSchema,
  type ScopeSettings,
  type Collection,
  type Example,
  type ExampleResponse,
  type Folder,
  type RequestDefinition,
  type RequestSummary,
  type SavedRequest,
} from "./schema";

let ready = false;

/** Creates this module's tables once per process (the shared connection already enables foreign keys). */
function conn(): DatabaseSync {
  const database = db();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_folders (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        folder_id TEXT REFERENCES collection_folders(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS request_examples (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status INTEGER NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS folders_by_collection ON collection_folders (collection_id, position);
      CREATE INDEX IF NOT EXISTS requests_by_collection ON requests (collection_id, position);
      CREATE INDEX IF NOT EXISTS examples_by_request ON request_examples (request_id, created_at);
    `);
    // Inherited auth/headers/scripts arrived later; add the column to databases created before it.
    for (const table of ["collections", "collection_folders"]) {
      const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === "settings")) database.exec(`ALTER TABLE ${table} ADD COLUMN settings TEXT`);
    }
    ready = true;
  }
  return database;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const now = () => new Date().toISOString();

type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  settings: string | null;
};
type FolderRow = { id: string; collection_id: string; name: string; position: number; settings: string | null };

function parseSettings(json: string | null): ScopeSettings {
  if (!json) return emptyScopeSettings();
  const parsed = scopeSettingsSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : emptyScopeSettings();
}
type RequestRow = {
  id: string;
  collection_id: string;
  folder_id: string | null;
  name: string;
  position: number;
  definition: string;
  created_at: string;
  updated_at: string;
};

/** Stored definitions are re-validated so older rows pick up new defaults. */
function parseDefinition(json: string): RequestDefinition {
  const parsed = requestDefinitionSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : emptyDefinition();
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  collectionId: r.collection_id,
  name: r.name,
  position: r.position,
  settings: parseSettings(r.settings),
});

function toSummary(r: RequestRow): RequestSummary {
  const def = parseDefinition(r.definition);
  return { id: r.id, name: r.name, method: def.method, url: def.url, folderId: r.folder_id };
}

function toRequest(r: RequestRow): SavedRequest {
  return {
    id: r.id,
    collectionId: r.collection_id,
    folderId: r.folder_id,
    name: r.name,
    position: r.position,
    definition: parseDefinition(r.definition),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function assemble(rows: CollectionRow[]): Collection[] {
  const c = conn();
  const folders = c.prepare("SELECT * FROM collection_folders ORDER BY position, name").all() as FolderRow[];
  const requests = c.prepare("SELECT * FROM requests ORDER BY position, name").all() as RequestRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settings: parseSettings(row.settings),
    folders: folders.filter((f) => f.collection_id === row.id).map(toFolder),
    requests: requests.filter((r) => r.collection_id === row.id).map(toSummary),
  }));
}

export function listCollections(): Collection[] {
  return assemble(conn().prepare("SELECT * FROM collections ORDER BY name COLLATE NOCASE").all() as CollectionRow[]);
}

export function getCollection(id: string): Collection | undefined {
  const row = conn().prepare("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRow | undefined;
  return row && assemble([row])[0];
}

export function createCollection(input: { name: string; description?: string }): Collection {
  const id = newId("col");
  const at = now();
  conn()
    .prepare("INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.name, input.description ?? null, at, at);
  return getCollection(id)!;
}

export function updateCollection(
  id: string,
  patch: { name?: string; description?: string | null; settings?: ScopeSettings },
): Collection | undefined {
  const existing = getCollection(id);
  if (!existing) return undefined;
  conn()
    .prepare("UPDATE collections SET name = ?, description = ?, settings = ?, updated_at = ? WHERE id = ?")
    .run(
      patch.name ?? existing.name,
      patch.description === undefined ? (existing.description ?? null) : patch.description,
      JSON.stringify(patch.settings ?? existing.settings),
      now(),
      id,
    );
  return getCollection(id);
}

const touch = (collectionId: string) =>
  conn().prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(now(), collectionId);

export function deleteCollection(id: string): boolean {
  return conn().prepare("DELETE FROM collections WHERE id = ?").run(id).changes === 1;
}

function nextPosition(table: "collection_folders" | "requests", collectionId: string): number {
  const { max } = conn().prepare(`SELECT MAX(position) AS max FROM ${table} WHERE collection_id = ?`).get(collectionId) as {
    max: number | null;
  };
  return (max ?? -1) + 1;
}

export function createFolder(collectionId: string, name: string): Folder | undefined {
  if (!getCollection(collectionId)) return undefined;
  const id = newId("fld");
  conn()
    .prepare("INSERT INTO collection_folders (id, collection_id, name, position) VALUES (?, ?, ?, ?)")
    .run(id, collectionId, name, nextPosition("collection_folders", collectionId));
  touch(collectionId);
  return getFolder(id);
}

export function getFolder(id: string): Folder | undefined {
  const row = conn().prepare("SELECT * FROM collection_folders WHERE id = ?").get(id) as FolderRow | undefined;
  return row && toFolder(row);
}

export function updateFolder(id: string, patch: { name?: string; settings?: ScopeSettings }): Folder | undefined {
  const folder = getFolder(id);
  if (!folder) return undefined;
  conn()
    .prepare("UPDATE collection_folders SET name = ?, settings = ? WHERE id = ?")
    .run(patch.name ?? folder.name, JSON.stringify(patch.settings ?? folder.settings), id);
  touch(folder.collectionId);
  return getFolder(id);
}

/** Runs fn in a transaction (node:sqlite has no helper for it). */
function transaction<T>(fn: () => T): T {
  const c = conn();
  c.exec("BEGIN");
  try {
    const result = fn();
    c.exec("COMMIT");
    return result;
  } catch (error) {
    c.exec("ROLLBACK");
    throw error;
  }
}

/** Moves a folder to `index` among its collection's folders and renumbers them 0..n. */
export function moveFolder(id: string, index: number): Folder | undefined {
  const folder = getFolder(id);
  if (!folder) return undefined;
  transaction(() => {
    const c = conn();
    const ids = (c.prepare("SELECT id FROM collection_folders WHERE collection_id = ? ORDER BY position, name").all(folder.collectionId) as { id: string }[])
      .map((r) => r.id)
      .filter((x) => x !== id);
    ids.splice(Math.min(index, ids.length), 0, id);
    const set = c.prepare("UPDATE collection_folders SET position = ? WHERE id = ?");
    ids.forEach((fid, i) => set.run(i, fid));
  });
  touch(folder.collectionId);
  return getFolder(id);
}

export type MoveResult =
  | { ok: true; request: SavedRequest }
  | { ok: false; reason: "request_not_found" | "collection_not_found" | "folder_mismatch" };

/**
 * Moves a request into a collection's root (folderId null) or one of its folders, at `index` among that
 * container's requests. Siblings are renumbered so positions stay dense.
 */
export function moveRequest(id: string, target: { collectionId: string; folderId: string | null; index: number }): MoveResult {
  const existing = getRequest(id);
  if (!existing) return { ok: false, reason: "request_not_found" };
  if (!getCollection(target.collectionId)) return { ok: false, reason: "collection_not_found" };
  if (!folderOk(target.collectionId, target.folderId)) return { ok: false, reason: "folder_mismatch" };

  transaction(() => {
    const c = conn();
    const siblings = (
      c
        .prepare("SELECT id FROM requests WHERE collection_id = ? AND folder_id IS ? AND id != ? ORDER BY position, name")
        .all(target.collectionId, target.folderId, id) as { id: string }[]
    ).map((r) => r.id);
    siblings.splice(Math.min(target.index, siblings.length), 0, id);
    c.prepare("UPDATE requests SET collection_id = ?, folder_id = ?, updated_at = ? WHERE id = ?").run(
      target.collectionId,
      target.folderId,
      now(),
      id,
    );
    const set = c.prepare("UPDATE requests SET position = ? WHERE id = ?");
    siblings.forEach((rid, i) => set.run(i, rid));
  });
  touch(existing.collectionId);
  if (target.collectionId !== existing.collectionId) touch(target.collectionId);
  return { ok: true, request: getRequest(id)! };
}

/** The collection and folder a request inherits from, as names + settings. */
export function requestScopes(collectionId: string | undefined, folderId: string | null | undefined) {
  const collection = collectionId ? getCollection(collectionId) : undefined;
  const folder = folderId ? getFolder(folderId) : undefined;
  return {
    collection: collection && { name: collection.name, settings: collection.settings },
    folder: folder && folder.collectionId === collection?.id ? { name: folder.name, settings: folder.settings } : undefined,
  };
}

/** Deletes the folder and the requests inside it. */
export function deleteFolder(id: string): boolean {
  const folder = getFolder(id);
  if (!folder) return false;
  const c = conn();
  c.exec("BEGIN");
  try {
    c.prepare("DELETE FROM requests WHERE folder_id = ?").run(id);
    c.prepare("DELETE FROM collection_folders WHERE id = ?").run(id);
    c.exec("COMMIT");
  } catch (error) {
    c.exec("ROLLBACK");
    throw error;
  }
  touch(folder.collectionId);
  return true;
}

export type RequestWriteResult =
  | { ok: true; request: SavedRequest }
  | { ok: false; reason: "collection_not_found" | "request_not_found" | "folder_mismatch" };

/** A folder id is valid only when it belongs to the same collection. */
function folderOk(collectionId: string, folderId: string | null | undefined) {
  if (folderId === null || folderId === undefined) return true;
  return getFolder(folderId)?.collectionId === collectionId;
}

export function createRequest(
  collectionId: string,
  input: { name: string; folderId?: string | null; definition?: RequestDefinition },
): RequestWriteResult {
  if (!getCollection(collectionId)) return { ok: false, reason: "collection_not_found" };
  if (!folderOk(collectionId, input.folderId)) return { ok: false, reason: "folder_mismatch" };
  const id = newId("req");
  const at = now();
  conn()
    .prepare(
      `INSERT INTO requests (id, collection_id, folder_id, name, position, definition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      collectionId,
      input.folderId ?? null,
      input.name,
      nextPosition("requests", collectionId),
      JSON.stringify(input.definition ?? emptyDefinition()),
      at,
      at,
    );
  touch(collectionId);
  return { ok: true, request: getRequest(id)! };
}

export function getRequest(id: string): SavedRequest | undefined {
  const row = conn().prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | undefined;
  return row && toRequest(row);
}

export function replaceRequest(
  id: string,
  input: { name: string; folderId: string | null; definition: RequestDefinition },
): RequestWriteResult {
  const existing = getRequest(id);
  if (!existing) return { ok: false, reason: "request_not_found" };
  if (!folderOk(existing.collectionId, input.folderId)) return { ok: false, reason: "folder_mismatch" };
  conn()
    .prepare("UPDATE requests SET name = ?, folder_id = ?, definition = ?, updated_at = ? WHERE id = ?")
    .run(input.name, input.folderId, JSON.stringify(input.definition), now(), id);
  touch(existing.collectionId);
  return { ok: true, request: getRequest(id)! };
}

export function deleteRequest(id: string): boolean {
  const existing = getRequest(id);
  if (!existing) return false;
  conn().prepare("DELETE FROM requests WHERE id = ?").run(id);
  touch(existing.collectionId);
  return true;
}

type ExampleRow = { id: string; request_id: string; name: string; status: number; response: string; created_at: string };
const toExample = (r: ExampleRow): Example => ({
  id: r.id,
  requestId: r.request_id,
  name: r.name,
  status: r.status,
  response: JSON.parse(r.response) as ExampleResponse,
  createdAt: r.created_at,
});

export function listExamples(requestId: string): Example[] {
  return (
    conn().prepare("SELECT * FROM request_examples WHERE request_id = ? ORDER BY created_at DESC").all(requestId) as ExampleRow[]
  ).map(toExample);
}

export function createExample(requestId: string, name: string, response: ExampleResponse): Example | undefined {
  if (!getRequest(requestId)) return undefined;
  const id = newId("ex");
  conn()
    .prepare("INSERT INTO request_examples (id, request_id, name, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, requestId, name, response.status, JSON.stringify(response), now());
  const row = conn().prepare("SELECT * FROM request_examples WHERE id = ?").get(id) as ExampleRow;
  return toExample(row);
}

export function deleteExample(id: string): boolean {
  return conn().prepare("DELETE FROM request_examples WHERE id = ?").run(id).changes === 1;
}

/** Creates a collection with folders and requests in one transaction. */
export function insertImported(imported: ImportedCollection): Collection {
  const c = conn();
  const at = now();
  const collectionId = newId("col");
  const insertRequest = c.prepare(
    `INSERT INTO requests (id, collection_id, folder_id, name, position, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let position = 0;
  c.exec("BEGIN");
  try {
    c.prepare("INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      collectionId,
      imported.name,
      imported.description ?? null,
      at,
      at,
    );
    imported.folders.forEach((folder, index) => {
      const folderId = newId("fld");
      c.prepare("INSERT INTO collection_folders (id, collection_id, name, position) VALUES (?, ?, ?, ?)").run(
        folderId,
        collectionId,
        folder.name,
        index,
      );
      for (const r of folder.requests) {
        insertRequest.run(newId("req"), collectionId, folderId, r.name, position++, JSON.stringify(r.definition), at, at);
      }
    });
    for (const r of imported.requests) {
      insertRequest.run(newId("req"), collectionId, null, r.name, position++, JSON.stringify(r.definition), at, at);
    }
    c.exec("COMMIT");
  } catch (error) {
    c.exec("ROLLBACK");
    throw error;
  }
  return getCollection(collectionId)!;
}

/** "<name> Copy" — the name Postman gives a duplicate. */
const copyName = (name: string) => `${name} Copy`;

/** Inserts a copy of a request row (and its saved examples) with a new id; call inside a transaction. */
function copyRequestRow(row: RequestRow, into: { collectionId: string; folderId: string | null; name: string; position: number }) {
  const c = conn();
  const id = newId("req");
  const at = now();
  c.prepare(
    `INSERT INTO requests (id, collection_id, folder_id, name, position, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, into.collectionId, into.folderId, into.name, into.position, row.definition, at, at);
  const examples = c.prepare("SELECT * FROM request_examples WHERE request_id = ?").all(row.id) as ExampleRow[];
  const insertExample = c.prepare(
    "INSERT INTO request_examples (id, request_id, name, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  // Keep each example's created_at so the copy lists them in the same order.
  for (const ex of examples) insertExample.run(newId("ex"), id, ex.name, ex.status, ex.response, ex.created_at);
  return id;
}

/** Copies a saved request (with its examples) as "<name> Copy", placed right after the original. */
export function duplicateRequest(id: string): SavedRequest | undefined {
  const c = conn();
  const row = c.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | undefined;
  if (!row) return undefined;
  const copyId = transaction(() => {
    const siblings = (
      c
        .prepare("SELECT id FROM requests WHERE collection_id = ? AND folder_id IS ? ORDER BY position, name")
        .all(row.collection_id, row.folder_id) as { id: string }[]
    ).map((r) => r.id);
    const newRequestId = copyRequestRow(row, {
      collectionId: row.collection_id,
      folderId: row.folder_id,
      name: copyName(row.name),
      position: 0,
    });
    siblings.splice(siblings.indexOf(id) + 1, 0, newRequestId);
    const set = c.prepare("UPDATE requests SET position = ? WHERE id = ?");
    siblings.forEach((rid, i) => set.run(i, rid));
    return newRequestId;
  });
  touch(row.collection_id);
  return getRequest(copyId);
}

/** Copies a folder (settings, requests in order, their examples) as "<name> Copy", placed right after the original. */
export function duplicateFolder(id: string): Folder | undefined {
  const c = conn();
  const row = c.prepare("SELECT * FROM collection_folders WHERE id = ?").get(id) as FolderRow | undefined;
  if (!row) return undefined;
  const copyId = transaction(() => {
    const folderId = newId("fld");
    c.prepare("INSERT INTO collection_folders (id, collection_id, name, position, settings) VALUES (?, ?, ?, ?, ?)").run(
      folderId,
      row.collection_id,
      copyName(row.name),
      0,
      row.settings,
    );
    const siblings = (
      c.prepare("SELECT id FROM collection_folders WHERE collection_id = ? AND id != ? ORDER BY position, name").all(
        row.collection_id,
        folderId,
      ) as { id: string }[]
    ).map((r) => r.id);
    siblings.splice(siblings.indexOf(id) + 1, 0, folderId);
    const set = c.prepare("UPDATE collection_folders SET position = ? WHERE id = ?");
    siblings.forEach((fid, i) => set.run(i, fid));

    const requests = c.prepare("SELECT * FROM requests WHERE folder_id = ? ORDER BY position, name").all(id) as RequestRow[];
    requests.forEach((r, i) => copyRequestRow(r, { collectionId: row.collection_id, folderId, name: r.name, position: i }));
    return folderId;
  });
  touch(row.collection_id);
  return getFolder(copyId);
}

/** Copies a collection with its settings, folders, requests and examples as "<name> Copy". */
export function duplicateCollection(id: string): Collection | undefined {
  const c = conn();
  const row = c.prepare("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRow | undefined;
  if (!row) return undefined;
  const copyId = transaction(() => {
    const collectionId = newId("col");
    const at = now();
    c.prepare(
      "INSERT INTO collections (id, name, description, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(collectionId, copyName(row.name), row.description, at, at, row.settings);
    const folderIds = new Map<string, string>();
    const insertFolder = c.prepare(
      "INSERT INTO collection_folders (id, collection_id, name, position, settings) VALUES (?, ?, ?, ?, ?)",
    );
    const folders = c.prepare("SELECT * FROM collection_folders WHERE collection_id = ? ORDER BY position, name").all(id) as FolderRow[];
    folders.forEach((f, i) => {
      const folderId = newId("fld");
      folderIds.set(f.id, folderId);
      insertFolder.run(folderId, collectionId, f.name, i, f.settings);
    });
    const requests = c.prepare("SELECT * FROM requests WHERE collection_id = ? ORDER BY position, name").all(id) as RequestRow[];
    requests.forEach((r, i) =>
      copyRequestRow(r, {
        collectionId,
        folderId: r.folder_id === null ? null : (folderIds.get(r.folder_id) ?? null),
        name: r.name,
        position: i,
      }),
    );
    return collectionId;
  });
  return getCollection(copyId);
}
