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

describe("list paths", () => {
  const record = (account_number: string, grp: string, balance: number) => ({ account_number, grp, balance, owner: { name: `o${account_number}` } });
  const lists: TemplateContext = {
    ...ctx,
    nodes: {
      "http-1": {
        body: {
          data: {
            total_record: 3,
            records: [record("100", "Saving", 5), record("200", "PettyCash", 0), record("300", "PettyCash", 12)],
          },
          "a.b": "dotted",
        },
      },
    },
  };
  const value = (path: string) => renderValue(`{{http-1.body.${path}}}`, lists);

  it("filters a list by a field and picks an item", () => {
    expect(value("data.records[grp = 'PettyCash'][0].account_number")).toBe("200");
    expect(value('data.records[grp="PettyCash"][-1].account_number')).toBe("300");
    expect(value("data.records[grp=PettyCash].account_number")).toEqual(["200", "300"]);
    expect(value("data.records[grp!='PettyCash'].account_number")).toEqual(["100"]);
    expect(value("data.records[balance > 0].account_number")).toEqual(["100", "300"]);
    expect(value("data.records[balance=0][0].account_number")).toBe("200");
    expect(value("data.records[owner.name='o300'][0].grp")).toBe("PettyCash");
    expect(value("data.records[grp='None'][0].account_number")).toBeUndefined();
    expect(value("data.records[grp='PettyCash'].length")).toBe(2);
  });

  it("takes a field from every item, and keeps positions, length and [*]", () => {
    expect(value("data.records.account_number")).toEqual(["100", "200", "300"]);
    expect(value("data.records[*].grp")).toEqual(["Saving", "PettyCash", "PettyCash"]);
    expect(value("data.records.0.account_number")).toBe("100");
    expect(value("data.records[1].account_number")).toBe("200");
    expect(value("data.records.length")).toBe(3);
    expect(renderValue("{{http-1.body['a.b']}}", lists)).toBe("dotted");
  });

  it("works in strings and JSON bodies, including double quotes inside a placeholder", () => {
    expect(renderString("acct={{http-1.body.data.records[grp='PettyCash'][0].account_number}}", lists)).toBe("acct=200");
    expect(
      renderJson('{ "acct": "{{http-1.body.data.records[grp="PettyCash"][0].account_number}}", "all": {{http-1.body.data.records[grp="PettyCash"].account_number}} }', lists),
    ).toEqual({ acct: "200", all: ["200", "300"] });
  });

  it("rejects malformed brackets", () => {
    expect(() => value("data.records[grp")).toThrow(/missing \]/);
    expect(() => value("data.records[grp]")).toThrow(/isn't a position/);
  });
});

describe("dynamic values", () => {
  it("generates fresh guids and timestamps", () => {
    const a = renderString("{{$guid}}", ctx);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(renderString("{{$guid}}", ctx)).not.toBe(a);
    expect(Number(renderValue("{{$timestamp}}", ctx))).toBeGreaterThan(1_700_000_000);
    expect(() => renderString("{{$nope}}", ctx)).toThrow(/unknown dynamic value/);
  });
});
