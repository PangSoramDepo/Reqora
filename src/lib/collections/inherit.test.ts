import { describe, expect, it } from "vitest";
import { resolveEffective } from "./inherit";
import { emptyDefinition, emptyScopeSettings, type RequestDefinition, type ScopeSettings } from "./schema";

const scope = (name: string, s: Partial<ScopeSettings>) => ({ name, settings: { ...emptyScopeSettings(), ...s } });
const request = (patch: Partial<RequestDefinition> = {}) => ({
  name: "Get order",
  definition: { ...emptyDefinition(), ...patch },
});

describe("resolveEffective", () => {
  it("inherits auth from the nearest level that sets it", () => {
    const collection = scope("API", { auth: { type: "bearer", token: "{{env.TOKEN}}" } });
    const folder = scope("Orders", { auth: { type: "inherit" } });
    expect(resolveEffective(request(), collection, folder)).toMatchObject({
      auth: { type: "bearer", token: "{{env.TOKEN}}" },
      authSource: "collection",
    });

    const folderBasic = scope("Orders", { auth: { type: "basic", username: "u", password: "p" } });
    expect(resolveEffective(request(), collection, folderBasic).authSource).toBe("folder");
    expect(resolveEffective(request({ auth: { type: "none" } }), collection, folderBasic)).toMatchObject({
      auth: { type: "none" },
      authSource: "request",
    });
  });

  it("treats an inheriting collection as no auth", () => {
    expect(resolveEffective(request(), scope("API", {}))).toMatchObject({ auth: { type: "none" }, authSource: null });
  });

  it("merges headers outermost first and orders scripts collection → folder → request", () => {
    const collection = scope("API", {
      headers: [{ key: "X-Team", value: "core", enabled: true }],
      preScript: "c-pre",
      postScript: "c-post",
    });
    const folder = scope("Orders", { headers: [{ key: "X-Team", value: "orders", enabled: true }], preScript: "f-pre" });
    const effective = resolveEffective(request({ preScript: "r-pre", postScript: "r-post" }), collection, folder);
    expect(effective.headers.map((h) => `${h.scope}:${h.value}`)).toEqual(["collection:core", "folder:orders"]);
    expect(effective.preScripts.map((s) => s.code)).toEqual(["c-pre", "f-pre", "r-pre"]);
    expect(effective.postScripts.map((s) => `${s.scope}:${s.code}`)).toEqual(["collection:c-post", "request:r-post"]);
  });
});
