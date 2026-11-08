import { describe, expect, it } from "vitest";
import { scriptVariables } from "./script-vars";

describe("scriptVariables", () => {
  it("finds rq / pm variable and environment names set by scripts", () => {
    expect(
      scriptVariables(
        `rq.variables.set("sig", "x"); pm.collectionVariables.set('token', t);`,
        undefined,
        "pm.environment.set(`login_id`, id); rq.variables.set(\"sig\", 2); rq.variables.get(\"read_only\");",
      ),
    ).toEqual({ vars: ["sig", "token"], env: ["login_id"] });
  });
});
