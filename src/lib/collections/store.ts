import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { addWorkspaceColumn, db } from "@/lib/workflows/store";
import { folderChain, subtreeIds } from "./folders";
import type { ImportedCollection, ImportedFolder } from "./openapi";
import {
  type ExportedFolder,
  emptyDefinition,
  emptyScopeSettings,
  requestDefinitionSchema,
  scopeSettingsSchema,
  type ScopeSettings,
  type Collection,
  type CollectionExport,
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
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
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
    // Sub-folders arrived later too: NULL = a top-level folder.
    const folderCols = database.prepare("PRAGMA table_info(collection_folders)").all() as { name: string }[];
    if (!folderCols.some((c) => c.name === "parent_id")) {
      database.exec("ALTER TABLE collection_folders ADD COLUMN parent_id TEXT REFERENCES collection_folders(id) ON DELETE CASCADE");
    }
    // Workspaces arrived later: collections from before them belong to the "Default" workspace.
    addWorkspaceColumn(database, "collections");
    database.exec("CREATE INDEX IF NOT EXISTS collections_by_workspace ON collections (workspace_id)");
    ready = true;
  }
  return database;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const now = () => new Date().toISOString();

type CollectionRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  settings: string | null;
};
type FolderRow = { id: string; collection_id: string; parent_id: string | null; name: string; position: number; settings: string | null };

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
  parentId: r.parent_id ?? null,
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
  if (rows.length === 0) return [];
  const c = conn();
  const ids = rows.map((r) => r.id);
  const among = `collection_id IN (${ids.map(() => "?").join(", ")})`;
  const folders = c.prepare(`SELECT * FROM collection_folders WHERE ${among} ORDER BY position, name`).all(...ids) as FolderRow[];
  const requests = c.prepare(`SELECT * FROM requests WHERE ${among} ORDER BY position, name`).all(...ids) as RequestRow[];
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

export function listCollections(workspaceId: string): Collection[] {
  return assemble(
    conn().prepare("SELECT * FROM collections WHERE workspace_id = ? ORDER BY name COLLATE NOCASE").all(workspaceId) as CollectionRow[],
  );
}

const workspaceBy = (sql: string, id: string) =>
  (conn().prepare(sql).get(id) as { workspace_id: string } | undefined)?.workspace_id;

/** The workspace a collection belongs to (undefined when it doesn't exist). */
export const collectionWorkspace = (id: string) => workspaceBy("SELECT workspace_id FROM collections WHERE id = ?", id);

/** The workspace of a folder's collection. */
export const folderWorkspace = (id: string) =>
  workspaceBy("SELECT c.workspace_id FROM collection_folders f JOIN collections c ON c.id = f.collection_id WHERE f.id = ?", id);

/** The workspace of a saved request's collection. */
export const requestWorkspace = (id: string) =>
  workspaceBy("SELECT c.workspace_id FROM requests r JOIN collections c ON c.id = r.collection_id WHERE r.id = ?", id);

/** The workspace of an example's request. */
export const exampleWorkspace = (id: string) =>
  workspaceBy(
    `SELECT c.workspace_id FROM request_examples e JOIN requests r ON r.id = e.request_id
     JOIN collections c ON c.id = r.collection_id WHERE e.id = ?`,
    id,
  );

export function getCollection(id: string): Collection | undefined {
  const row = conn().prepare("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRow | undefined;
  return row && assemble([row])[0];
}

export function createCollection(workspaceId: string, input: { name: string; description?: string }): Collection {
  const id = newId("col");
  const at = now();
  conn()
    .prepare("INSERT INTO collections (id, workspace_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, input.name, input.description ?? null, at, at);
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

/** Creates a folder at the top level, or inside `parentId` (which must be in the same collection). */
export function createFolder(collectionId: string, name: string, parentId: string | null = null): Folder | undefined {
  if (!getCollection(collectionId) || !folderOk(collectionId, parentId)) return undefined;
  const id = newId("fld");
  conn()
    .prepare("INSERT INTO collection_folders (id, collection_id, parent_id, name, position) VALUES (?, ?, ?, ?, ?)")
    .run(id, collectionId, parentId, name, nextPosition("collection_folders", collectionId));
  touch(collectionId);
  return getFolder(id);
}

const collectionFolders = (collectionId: string) =>
  (conn().prepare("SELECT * FROM collection_folders WHERE collection_id = ? ORDER BY position, name").all(collectionId) as FolderRow[]).map(toFolder);

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

export type FolderMoveResult =
  | { ok: true; folder: Folder }
  | { ok: false; reason: "folder_not_found" | "parent_mismatch" | "into_itself" };

/**
 * Moves a folder to `index` among its parent's sub-folders, and into another parent when `parentId` is given
 * (null = top level; same collection only, never into itself or one of its own sub-folders). Siblings are renumbered.
 */
export function moveFolder(id: string, index: number, parentId?: string | null): FolderMoveResult {
  const folder = getFolder(id);
  if (!folder) return { ok: false, reason: "folder_not_found" };
  const parent = parentId === undefined ? folder.parentId : parentId;
  if (!folderOk(folder.collectionId, parent)) return { ok: false, reason: "parent_mismatch" };
  if (parent !== null && subtreeIds(collectionFolders(folder.collectionId), id).has(parent)) return { ok: false, reason: "into_itself" };
  transaction(() => {
    const c = conn();
    const ids = (
      c.prepare("SELECT id FROM collection_folders WHERE collection_id = ? AND parent_id IS ? AND id != ? ORDER BY position, name").all(
        folder.collectionId,
        parent,
        id,
      ) as { id: string }[]
    ).map((r) => r.id);
    ids.splice(Math.min(index, ids.length), 0, id);
    c.prepare("UPDATE collection_folders SET parent_id = ? WHERE id = ?").run(parent, id);
    const set = c.prepare("UPDATE collection_folders SET position = ? WHERE id = ?");
    ids.forEach((fid, i) => set.run(i, fid));
  });
  touch(folder.collectionId);
  return { ok: true, folder: getFolder(id)! };
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

/** The collection and the folders a request inherits from (its folder and every folder above it, outermost first). */
export function requestScopes(collectionId: string | undefined, folderId: string | null | undefined) {
  const collection = collectionId ? getCollection(collectionId) : undefined;
  return {
    collection: collection && { name: collection.name, settings: collection.settings },
    folders: collection ? folderChain(collection.folders, folderId).map((f) => ({ name: f.name, settings: f.settings })) : [],
  };
}

/** Deletes the folder, its sub-folders and every request inside them. */
export function deleteFolder(id: string): boolean {
  const folder = getFolder(id);
  if (!folder) return false;
  const ids = [...subtreeIds(collectionFolders(folder.collectionId), id)];
  transaction(() => {
    const c = conn();
    const deleteRequests = c.prepare("DELETE FROM requests WHERE folder_id = ?");
    for (const fid of ids) deleteRequests.run(fid);
    const deleteRow = c.prepare("DELETE FROM collection_folders WHERE id = ?");
    for (const fid of ids.reverse()) deleteRow.run(fid);
  });
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
export function insertImported(workspaceId: string, imported: ImportedCollection): Collection {
  const c = conn();
  const at = now();
  const collectionId = newId("col");
  const insertRequestRow = c.prepare(
    `INSERT INTO requests (id, collection_id, folder_id, name, position, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertExample = c.prepare(
    "INSERT INTO request_examples (id, request_id, name, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  let position = 0;
  let exampleOrder = 0;
  const insertRequest = (r: ImportedCollection["requests"][number], folderId: string | null) => {
    const requestId = newId("req");
    insertRequestRow.run(requestId, collectionId, folderId, r.name, position++, JSON.stringify(r.definition), at, at);
    for (const ex of r.examples ?? []) {
      // Distinct created_at values keep the examples in their exported order.
      const createdAt = new Date(Date.parse(at) + exampleOrder++).toISOString();
      insertExample.run(newId("ex"), requestId, ex.name, ex.response.status, JSON.stringify(ex.response), createdAt);
    }
  };
  c.exec("BEGIN");
  try {
    c.prepare(
      "INSERT INTO collections (id, workspace_id, name, description, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      collectionId,
      workspaceId,
      imported.name,
      imported.description ?? null,
      at,
      at,
      imported.settings ? JSON.stringify(imported.settings) : null,
    );
    const insertFolder = c.prepare(
      "INSERT INTO collection_folders (id, collection_id, parent_id, name, position, settings) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertFolders = (folders: ImportedFolder[], parentId: string | null) =>
      folders.forEach((folder, index) => {
        const folderId = newId("fld");
        insertFolder.run(folderId, collectionId, parentId, folder.name, index, folder.settings ? JSON.stringify(folder.settings) : null);
        for (const r of folder.requests) insertRequest(r, folderId);
        insertFolders(folder.folders ?? [], folderId);
      });
    insertFolders(imported.folders, null);
    for (const r of imported.requests) insertRequest(r, null);
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

/**
 * Copies a folder (settings, sub-folders, requests in order, their examples) as "<name> Copy", placed right after
 * the original under the same parent.
 */
export function duplicateFolder(id: string): Folder | undefined {
  const c = conn();
  const row = c.prepare("SELECT * FROM collection_folders WHERE id = ?").get(id) as FolderRow | undefined;
  if (!row) return undefined;
  const copyId = transaction(() => {
    const rows = c.prepare("SELECT * FROM collection_folders WHERE collection_id = ? ORDER BY position, name").all(row.collection_id) as FolderRow[];
    const insertFolder = c.prepare(
      "INSERT INTO collection_folders (id, collection_id, parent_id, name, position, settings) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const requestsIn = c.prepare("SELECT * FROM requests WHERE folder_id = ? ORDER BY position, name");
    const copyTree = (source: FolderRow, parentId: string | null, name: string, position: number): string => {
      const folderId = newId("fld");
      insertFolder.run(folderId, row.collection_id, parentId, name, position, source.settings);
      (requestsIn.all(source.id) as RequestRow[]).forEach((r, i) =>
        copyRequestRow(r, { collectionId: row.collection_id, folderId, name: r.name, position: i }),
      );
      rows.filter((r) => r.parent_id === source.id).forEach((child, i) => copyTree(child, folderId, child.name, i));
      return folderId;
    };
    const folderId = copyTree(row, row.parent_id, copyName(row.name), 0);

    const siblings = (
      c.prepare("SELECT id FROM collection_folders WHERE collection_id = ? AND parent_id IS ? AND id != ? ORDER BY position, name").all(
        row.collection_id,
        row.parent_id,
        folderId,
      ) as { id: string }[]
    ).map((r) => r.id);
    siblings.splice(siblings.indexOf(id) + 1, 0, folderId);
    const set = c.prepare("UPDATE collection_folders SET position = ? WHERE id = ?");
    siblings.forEach((fid, i) => set.run(i, fid));
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
      "INSERT INTO collections (id, workspace_id, name, description, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(collectionId, row.workspace_id, copyName(row.name), row.description, at, at, row.settings);
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
    // Link sub-folders once every copy exists.
    const setParent = c.prepare("UPDATE collection_folders SET parent_id = ? WHERE id = ?");
    for (const f of folders) if (f.parent_id) setParent.run(folderIds.get(f.parent_id) ?? null, folderIds.get(f.id)!);
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

/** The whole collection as an export file (see `collectionExportSchema`), or undefined if it doesn't exist. */
export function exportCollection(id: string): CollectionExport | undefined {
  const collection = getCollection(id);
  if (!collection) return undefined;
  const c = conn();
  const rows = c.prepare("SELECT * FROM requests WHERE collection_id = ? ORDER BY position, name").all(id) as RequestRow[];
  const exampleRows = c.prepare("SELECT * FROM request_examples WHERE request_id = ? ORDER BY created_at");
  const exported = (r: RequestRow) => ({
    name: r.name,
    definition: parseDefinition(r.definition),
    examples: (exampleRows.all(r.id) as ExampleRow[]).map((ex) => ({ name: ex.name, response: JSON.parse(ex.response) as ExampleResponse })),
  });
  const folderExports = (parentId: string | null): ExportedFolder[] =>
    collection.folders
      .filter((f) => f.parentId === parentId)
      .map((f) => {
        const sub = folderExports(f.id);
        return { name: f.name, settings: f.settings, requests: rows.filter((r) => r.folder_id === f.id).map(exported), ...(sub.length ? { folders: sub } : {}) };
      });
  return {
    reqora: "collection",
    version: 1,
    exportedAt: new Date().toISOString(),
    collection: {
      name: collection.name,
      ...(collection.description ? { description: collection.description } : {}),
      settings: collection.settings,
      folders: folderExports(null),
      requests: rows.filter((r) => r.folder_id === null).map(exported),
    },
  };
}
