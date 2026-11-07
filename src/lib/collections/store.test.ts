import { beforeAll, describe, expect, it } from "vitest";
import type { ExampleResponse } from "./schema";

// The store opens its database lazily, so pointing it at memory before the first call is enough.
process.env.REQORA_DB_PATH = ":memory:";

type Store = typeof import("./store");
let store: Store;

beforeAll(async () => {
  store = await import("./store");
});

const example: ExampleResponse = { status: 200, statusText: "OK", headers: {}, body: "{}", durationMs: 1, size: 2 };

function seed() {
  const col = store.createCollection({ name: "API", description: "desc" });
  store.updateCollection(col.id, {
    settings: { ...col.settings, headers: [{ key: "X-Col", value: "1", enabled: true }] },
  });
  const folder = store.createFolder(col.id, "Users")!;
  store.updateFolder(folder.id, { settings: { ...folder.settings, headers: [{ key: "X-Fld", value: "2", enabled: true }] } });
  const other = store.createFolder(col.id, "Other")!;
  const req = (name: string, folderId: string | null) => {
    const r = store.createRequest(col.id, { name, folderId });
    if (!r.ok) throw new Error(r.reason);
    return r.request;
  };
  const a = req("A", folder.id);
  const b = req("B", folder.id);
  const c = req("C", folder.id);
  const root = req("Root", null);
  store.createExample(b.id, "ok", example);
  return { col, folder, other, a, b, c, root };
}

const folderRequests = (collectionId: string, folderId: string | null) =>
  store.getCollection(collectionId)!.requests.filter((r) => r.folderId === folderId);

describe("duplicateRequest", () => {
  it("places a copy right after the original, with examples and dense positions", () => {
    const { col, folder, a, b, c } = seed();
    const copy = store.duplicateRequest(b.id)!;
    expect(copy.id).not.toBe(b.id);
    expect(copy.name).toBe("B Copy");
    expect(copy.folderId).toBe(folder.id);
    expect(copy.definition).toEqual(b.definition);
    expect(folderRequests(col.id, folder.id).map((r) => r.id)).toEqual([a.id, b.id, copy.id, c.id]);
    expect([a, b, copy, c].map((r) => store.getRequest(r.id)!.position)).toEqual([0, 1, 2, 3]);
    const examples = store.listExamples(copy.id);
    expect(examples).toHaveLength(1);
    expect(examples[0].name).toBe("ok");
    expect(examples[0].id).not.toBe(store.listExamples(b.id)[0].id);
  });

  it("returns undefined for an unknown request", () => {
    expect(store.duplicateRequest("req_missing")).toBeUndefined();
  });
});

describe("duplicateFolder", () => {
  it("copies settings and requests in order, right after the original", () => {
    const { col, folder, other, b } = seed();
    const copy = store.duplicateFolder(folder.id)!;
    expect(copy.name).toBe("Users Copy");
    expect(copy.settings).toEqual(store.getFolder(folder.id)!.settings);
    expect(store.getCollection(col.id)!.folders.map((f) => f.id)).toEqual([folder.id, copy.id, other.id]);
    const copied = folderRequests(col.id, copy.id);
    expect(copied.map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(copied.every((r) => !folderRequests(col.id, folder.id).some((o) => o.id === r.id))).toBe(true);
    expect(store.listExamples(copied[1].id)).toHaveLength(1);
    expect(store.listExamples(b.id)).toHaveLength(1);
  });
});

describe("duplicateCollection", () => {
  it("copies settings, folders, requests and examples under new ids", () => {
    const { col } = seed();
    const original = store.getCollection(col.id)!;
    const copy = store.duplicateCollection(col.id)!;
    expect(copy.id).not.toBe(col.id);
    expect(copy.name).toBe("API Copy");
    expect(copy.description).toBe("desc");
    expect(copy.settings).toEqual(original.settings);
    expect(copy.folders.map((f) => [f.name, f.settings])).toEqual(original.folders.map((f) => [f.name, f.settings]));
    expect(copy.folders.some((f) => original.folders.some((o) => o.id === f.id))).toBe(false);
    const nameOfFolder = (c: typeof copy, id: string | null) => c.folders.find((f) => f.id === id)?.name ?? null;
    expect(copy.requests.map((r) => [r.name, nameOfFolder(copy, r.folderId)])).toEqual(
      original.requests.map((r) => [r.name, nameOfFolder(original, r.folderId)]),
    );
    const copiedB = copy.requests.find((r) => r.name === "B")!;
    expect(store.listExamples(copiedB.id)).toHaveLength(1);

    // The copy is independent: deleting the original leaves it intact.
    store.deleteCollection(col.id);
    expect(store.getCollection(copy.id)!.requests).toHaveLength(4);
    expect(store.listExamples(copiedB.id)).toHaveLength(1);
  });
});

describe("sub-folders", () => {
  function nested() {
    const { col, folder, other, a } = seed();
    const sub = store.createFolder(col.id, "Admin", folder.id)!;
    store.updateFolder(sub.id, { settings: { ...sub.settings, preScript: "// admin" } });
    const deep = store.createFolder(col.id, "Deep", sub.id)!;
    const r = store.createRequest(col.id, { name: "Deep req", folderId: deep.id });
    if (!r.ok) throw new Error(r.reason);
    return { col, folder, other, a, sub, deep, deepReq: r.request };
  }
  const names = (collectionId: string, parentId: string | null) =>
    store.getCollection(collectionId)!.folders.filter((f) => f.parentId === parentId).map((f) => f.name);

  it("creates folders inside folders, in the same collection only", () => {
    const { col, folder, sub, deep } = nested();
    expect([sub.parentId, deep.parentId]).toEqual([folder.id, sub.id]);
    expect(names(col.id, folder.id)).toEqual(["Admin"]);
    const elsewhere = store.createCollection({ name: "Elsewhere" });
    expect(store.createFolder(elsewhere.id, "X", folder.id)).toBeUndefined();
  });

  it("inherits from every folder above a request, outermost first", () => {
    const { col, deep } = nested();
    expect(store.requestScopes(col.id, deep.id).folders.map((f) => f.name)).toEqual(["Users", "Admin", "Deep"]);
    expect(store.requestScopes(col.id, null).folders).toEqual([]);
  });

  it("moves folders between parents, never into themselves", () => {
    const { col, folder, other, sub, deep } = nested();
    expect(store.moveFolder(sub.id, 0, other.id)).toMatchObject({ ok: true, folder: { parentId: other.id } });
    expect(store.moveFolder(sub.id, 0, deep.id)).toEqual({ ok: false, reason: "into_itself" });
    expect(store.moveFolder(sub.id, 0, sub.id)).toEqual({ ok: false, reason: "into_itself" });
    expect(store.moveFolder(sub.id, 1, null)).toMatchObject({ ok: true, folder: { parentId: null } });
    expect(names(col.id, null)).toEqual(["Users", "Admin", "Other"]);
    // Reorder without changing the parent.
    expect(store.moveFolder(folder.id, 5)).toMatchObject({ ok: true, folder: { parentId: null } });
    expect(names(col.id, null)).toEqual(["Admin", "Other", "Users"]);
  });

  it("deletes a folder with its sub-folders and their requests", () => {
    const { col, folder, other, deepReq } = nested();
    store.deleteFolder(folder.id);
    const after = store.getCollection(col.id)!;
    expect(after.folders.map((f) => f.id)).toEqual([other.id]);
    expect(store.getRequest(deepReq.id)).toBeUndefined();
    expect(after.requests.map((r) => r.name)).toEqual(["Root"]);
  });

  it("duplicates a folder with its sub-folders", () => {
    const { col, folder } = nested();
    const copy = store.duplicateFolder(folder.id)!;
    const sub = store.getCollection(col.id)!.folders.find((f) => f.parentId === copy.id)!;
    expect([sub.name, sub.settings.preScript]).toEqual(["Admin", "// admin"]);
    const deep = store.getCollection(col.id)!.folders.find((f) => f.parentId === sub.id)!;
    expect(folderRequests(col.id, deep.id).map((r) => r.name)).toEqual(["Deep req"]);
  });

  it("keeps the tree through duplicate collection and export / import", async () => {
    const { collectionExportSchema } = await import("./schema");
    const { col } = nested();
    const tree = (id: string) => {
      const c = store.getCollection(id)!;
      const path = (fid: string | null): string => {
        const f = c.folders.find((x) => x.id === fid);
        return f ? `${path(f.parentId)}/${f.name}` : "";
      };
      return c.requests.map((r) => `${path(r.folderId)}/${r.name}`).sort();
    };
    expect(tree(col.id)).toContain("/Users/Admin/Deep/Deep req");
    expect(tree(store.duplicateCollection(col.id)!.id)).toEqual(tree(col.id));
    const file = collectionExportSchema.parse(JSON.parse(JSON.stringify(store.exportCollection(col.id))));
    expect(file.collection.folders[0].folders?.[0].name).toBe("Admin");
    expect(tree(store.insertImported(file.collection).id)).toEqual(tree(col.id));
  });
});

describe("exportCollection / import", () => {
  it("round-trips settings, folders, request order, definitions, scripts and examples", async () => {
    const { collectionExportSchema } = await import("./schema");
    const { col, a, b } = seed();
    const def = { ...store.getRequest(a.id)!.definition, method: "POST" as const, url: "{{env.BASE}}/a", postScript: 'rq.test("ok", () => {});' };
    store.replaceRequest(a.id, { name: "A", folderId: a.folderId, definition: def });
    store.createExample(b.id, "second", { ...example, status: 201 });

    const exported = store.exportCollection(col.id)!;
    expect(exported).toMatchObject({ reqora: "collection", version: 1 });
    // What a file round-trip would see: JSON text, then validation.
    const file = collectionExportSchema.parse(JSON.parse(JSON.stringify(exported)));
    const imported = store.insertImported(file.collection);

    const original = store.getCollection(col.id)!;
    expect(imported.id).not.toBe(col.id);
    expect(imported.name).toBe("API");
    expect(imported.description).toBe("desc");
    expect(imported.settings).toEqual(original.settings);
    expect(imported.folders.map((f) => [f.name, f.settings])).toEqual(original.folders.map((f) => [f.name, f.settings]));
    const folderName = (c: typeof original, id: string | null) => c.folders.find((f) => f.id === id)?.name ?? null;
    expect(imported.requests.map((r) => [r.name, folderName(imported, r.folderId)])).toEqual(
      original.requests.map((r) => [r.name, folderName(original, r.folderId)]),
    );
    const importedA = imported.requests.find((r) => r.name === "A")!;
    expect(store.getRequest(importedA.id)!.definition).toEqual(def);
    const importedB = imported.requests.find((r) => r.name === "B")!;
    expect(store.listExamples(importedB.id).map((e) => [e.name, e.status])).toEqual(
      store.listExamples(b.id).map((e) => [e.name, e.status]),
    );
    // Exporting the import gives the same content.
    expect(store.exportCollection(imported.id)!.collection).toEqual(exported.collection);
  });

  it("returns undefined for an unknown collection", () => {
    expect(store.exportCollection("col_missing")).toBeUndefined();
  });
});
