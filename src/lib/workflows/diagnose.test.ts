import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnose";

describe("diagnose", () => {
  it("offers to add a missing variable in the run's environment", () => {
    const d = diagnose('Call: environment variable "STRIPE_KEY" is not configured', { nodeType: "http", environment: "Sandbox" });
    expect(d).toMatchObject({ title: "STRIPE_KEY isn't set in Sandbox", fixes: [{ label: "Add STRIPE_KEY to Sandbox", fix: { kind: "add-variable", name: "STRIPE_KEY" } }] });
  });

  it("explains HTTP errors with the API's own message and the right place to look", () => {
    const unauthorized = diagnose("upstream responded 401", { nodeType: "http", output: { status: 401, body: { error: { message: "Invalid API key" } } } });
    expect(unauthorized?.hint).toContain("“Invalid API key”");
    expect(unauthorized?.fixes).toEqual([{ label: "Check headers", fix: { kind: "tab", tab: "Headers" } }]);
    expect(diagnose("upstream responded 401", { nodeType: "http", linked: true })?.fixes[0].fix).toEqual({ kind: "edit-linked" });
    expect(diagnose("upstream responded 404", { nodeType: "http" })?.fixes[0].fix).toEqual({ kind: "focus", field: "request-target" });
    expect(diagnose("upstream responded 422", { nodeType: "http", output: { body: "amount must be positive" } })?.hint).toContain("“amount must be positive”");
    expect(diagnose("upstream responded 503", { nodeType: "http" })?.title).toBe("The API had an error (503)");
  });

  it("recognises network failures, timeouts and blocked addresses", () => {
    expect(diagnose("request failed: timed out after 10000ms", { nodeType: "http" })).toMatchObject({
      title: "No answer within 10s",
      fixes: [{ fix: { kind: "tab", tab: "Settings" } }],
    });
    expect(diagnose("request failed: getaddrinfo ENOTFOUND api.nope.test", { nodeType: "http" })?.title).toBe("That host name doesn't exist");
    expect(diagnose("request failed: connect ECONNREFUSED 127.0.0.1:9", { nodeType: "http" })?.title).toBe("Couldn't connect to the server");
    expect(diagnose("request failed: blocked: 10.0.0.5 is a private network address. To allow it, add X", { nodeType: "http" })?.hint).toMatch(/^10\.0\.0\.5 is a private/);
  });

  it("links a failed called flow to its run and the flow", () => {
    const d = diagnose("flow “Greeter” failed: Respond: boom", { nodeType: "call", output: { runId: "run_1", workflowId: "wf_1" } });
    expect(d?.fixes.map((f) => f.fix)).toEqual([
      { kind: "open-run", runId: "run_1" },
      { kind: "open-flow", workflowId: "wf_1" },
    ]);
    expect(diagnose("pick the flow to call", { nodeType: "call" })?.fixes[0].fix).toEqual({ kind: "focus", field: "call-flow" });
  });

  it("handles linked requests, tests, scripts and conditions", () => {
    expect(diagnose("the linked Collections request was deleted — unlink the node to keep its last copy", { nodeType: "http", linked: true })?.fixes[0].fix).toEqual({ kind: "unlink" });
    expect(diagnose("2 tests failed: is admin, has id", { nodeType: "http", linked: true })?.title).toBe("2 tests failed");
    expect(diagnose("pre-request script (folder “Orders”) failed: x is not defined", { nodeType: "http", linked: true })?.title).toBe(
      "The pre-request script of folder “Orders” threw an error",
    );
    expect(diagnose('cannot compare non-numeric values with ">": undefined vs 5', { nodeType: "condition" })?.fixes[0].fix).toEqual({ kind: "focus", field: "cond-left" });
    expect(diagnose("something else entirely", { nodeType: "http" })).toBeNull();
  });
});
