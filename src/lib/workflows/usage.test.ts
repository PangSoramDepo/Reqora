import { describe, expect, it } from "vitest";
import { SEED_WORKFLOWS } from "./seed";
import { variableUsage } from "./usage";

describe("variableUsage", () => {
  it("finds env references in nested node config", () => {
    const usage = variableUsage([{ id: "wf", name: "Checkout", nodes: SEED_WORKFLOWS[0].input.nodes }]);
    expect([...usage.keys()]).toEqual(["STRIPE_SECRET"]);
    expect(usage.get("STRIPE_SECRET")).toEqual([
      { workflowId: "wf", workflowName: "Checkout", nodeId: "node-2", nodeName: "Auth & Customer Verify" },
    ]);
  });
});
