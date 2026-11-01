import { describe, expect, it } from "vitest";
import { TemplateError, renderJson, renderString, renderValue, type TemplateContext } from "./template";

const ctx: TemplateContext = {
  trigger: { body: { id: "ord_1", amount: 749.5, tags: ["vip"], note: 'say "hi"' } },
  nodes: { "node-2": { body: { customer_id: "cus_9" } } },
  env: (name) => {
    if (name === "TOKEN") return "secret";
    throw new TemplateError(`environment variable "${name}" is not configured`);
  },
};

describe("renderString", () => {
  it("interpolates trigger, node and env references", () => {
    expect(renderString("/c/{{node-2.body.customer_id}}?o={{ trigger.body.id }}&t={{env.TOKEN}}", ctx)).toBe(
      "/c/cus_9?o=ord_1&t=secret",
    );
  });

  it("renders missing paths as empty and objects as JSON", () => {
    expect(renderString("[{{trigger.body.missing}}] {{trigger.body.tags}}", ctx)).toBe('[] ["vip"]');
  });

  it("fails on missing env variables", () => {
    expect(() => renderString("{{env.NOPE}}", ctx)).toThrow(/NOPE/);
  });
});

describe("renderValue", () => {
  it("keeps the type of a single placeholder", () => {
    expect(renderValue("{{trigger.body.amount}}", ctx)).toBe(749.5);
    expect(renderValue("{{trigger.body.tags}}", ctx)).toEqual(["vip"]);
  });

  it("stringifies mixed templates", () => {
    expect(renderValue("total: {{trigger.body.amount}}", ctx)).toBe("total: 749.5");
  });
});

describe("renderJson", () => {
  it("inserts bare placeholders as JSON values and quoted ones as strings", () => {
    const body = renderJson(
      '{ "id": "{{trigger.body.id}}", "amount": {{trigger.body.amount}}, "tags": {{trigger.body.tags}}, "none": {{trigger.body.x}} }',
      ctx,
    );
    expect(body).toEqual({ id: "ord_1", amount: 749.5, tags: ["vip"], none: null });
  });

  it("escapes values interpolated inside string literals", () => {
    expect(renderJson('{ "text": "Note: {{trigger.body.note}} ({{trigger.body.amount}})" }', ctx)).toEqual({
      text: 'Note: say "hi" (749.5)',
    });
  });

  it("reports invalid JSON", () => {
    expect(() => renderJson("{ nope }", ctx)).toThrow(TemplateError);
  });
});
