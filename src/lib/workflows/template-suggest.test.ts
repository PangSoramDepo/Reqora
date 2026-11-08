import { describe, expect, it } from "vitest";
import { joinKey, openPlaceholder, preview, suggest, type DataSource } from "./template-suggest";

const sources: DataSource[] = [
  { root: "trigger", label: "Webhook payload", type: "trigger", value: { body: { name: "Sora", amount: 12 }, headers: {} }, ran: true },
  {
    root: "http-1",
    label: "List accounts",
    type: "http",
    ran: true,
    value: {
      status: 200,
      body: {
        data: {
          records: [
            { grp: "Main", account_number: "001" },
            { grp: "PettyCash", account_number: "002" },
          ],
        },
        "x.y": 1,
      },
    },
  },
  { root: "http-2", label: "Later", type: "http", value: { status: 200, body: {} }, ran: false },
];
const data = { sources, env: ["API_KEY", "BASE_URL"] };
const inserts = (q: string) => suggest(q, data).map((s) => s.insert);

describe("template suggestions", () => {
  it("lists sources, env and dynamic values at the start, filtered by what's typed", () => {
    expect(inserts("")).toEqual(["trigger.", "http-1.", "http-2.", "env.", "$guid", "$timestamp", "$isoTimestamp"]);
    expect(inserts("ht")).toEqual(["http-1.", "http-2."]);
    // Matching the node's name also works.
    expect(inserts("accounts")).toEqual(["http-1."]);
    expect(suggest("", data).find((s) => s.insert === "http-2.")?.detail).toBe("Later · not run yet");
  });

  it("walks into objects and lists from the last run", () => {
    expect(inserts("http-1.")).toEqual(["http-1.status", "http-1.body."]);
    expect(inserts("http-1.body.")).toEqual(["http-1.body.data.", "http-1.body['x.y']"]);
    expect(suggest("http-1.body.data.", data)[0]).toMatchObject({ insert: "http-1.body.data.records.", detail: "list · 2 items", complete: false });
    expect(inserts("http-1.body.data.records.")).toEqual([
      "http-1.body.data.records[0].",
      "http-1.body.data.records[-1].",
      "http-1.body.data.records[*].",
      "http-1.body.data.records.length",
      "http-1.body.data.records.grp",
      "http-1.body.data.records.account_number",
    ]);
    expect(inserts("http-1.body.data.records.acc")).toEqual(["http-1.body.data.records.account_number"]);
    expect(inserts("http-1.body.data.records[")).toEqual([
      "http-1.body.data.records[0].",
      "http-1.body.data.records[-1].",
      "http-1.body.data.records[*].",
    ]);
    // A list projected through [*] offers the items' fields.
    expect(inserts("http-1.body.data.records[*].g")).toEqual(["http-1.body.data.records[*].grp"]);
    expect(suggest("http-1.body.data.records[0].", data).map((s) => [s.insert, s.complete])).toEqual([
      ["http-1.body.data.records[0].grp", true],
      ["http-1.body.data.records[0].account_number", true],
    ]);
    // Through a filter.
    expect(inserts("http-1.body.data.records[grp='PettyCash'][0].acc")).toEqual(["http-1.body.data.records[grp='PettyCash'][0].account_number"]);
    expect(inserts("trigger.body.n")).toEqual(["trigger.body.name"]);
  });

  it("completes environment variable names", () => {
    expect(inserts("env.")).toEqual(["env.API_KEY", "env.BASE_URL"]);
    expect(inserts("env.b")).toEqual(["env.BASE_URL"]);
  });

  it("finds the placeholder being typed", () => {
    expect(openPlaceholder("Bearer {{env.AP", 15)).toEqual({ start: 7, query: "env.AP" });
    expect(openPlaceholder("{{a}} and {{b", 13)).toEqual({ start: 10, query: "b" });
    expect(openPlaceholder("{{a}} done", 10)).toBeNull();
  });

  it("previews templates with the last run, and says when a node hasn't run", () => {
    expect(preview("{{http-1.body.data.records[grp='PettyCash'][0].account_number}}", sources, "value")).toEqual({ kind: "value", text: "002" });
    expect(preview("/users/{{trigger.body.name}}?key={{env.API_KEY}}", sources, "string")).toEqual({
      kind: "value",
      text: "/users/Sora?key=‹env.API_KEY›",
    });
    expect(preview('{ "n": {{trigger.body.amount}} }', sources, "json")).toEqual({ kind: "value", text: '{"n":12}' });
    expect(preview("{{http-2.body.id}}", sources, "value")?.kind).toBe("pending");
    expect(preview("no placeholders", sources, "string")).toBeNull();
    expect(preview("{{trigger.body.", sources, "value")).toBeNull();
  });

  it("quotes keys that need it", () => {
    expect(joinKey("a", "b_c-d")).toBe("a.b_c-d");
    expect(joinKey("a", "x.y")).toBe("a['x.y']");
    expect(joinKey("a", "has space")).toBe("a['has space']");
  });
});
