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
