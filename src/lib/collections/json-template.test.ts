import { describe, expect, it } from "vitest";
import { checkJsonTemplate } from "./json-template";

describe("checkJsonTemplate", () => {
  it("accepts JSON with templates inside strings and as bare values", () => {
    expect(checkJsonTemplate("")).toBeNull();
    expect(checkJsonTemplate('{ "id": "{{$guid}}", "qty": {{trigger.body.qty}}, "token": "Bearer {{env.TOKEN}}" }')).toBeNull();
    expect(checkJsonTemplate("[{{vars.a}}, {{vars.b}}]")).toBeNull();
  });

  it("points at the problem in the original text", () => {
    const text = '{\n  "user": "{{env.USER}}",\n  "qty": 2,\n}';
    const problem = checkJsonTemplate(text)!;
    expect(problem).not.toBeNull();
    // The trailing comma: the error is reported at the closing brace on line 4.
    expect(text.slice(0, problem.from).split("\n").length).toBe(4);
    expect(problem.message).toBe("Trailing comma before }");
  });

  it("reports a missing value", () => {
    const problem = checkJsonTemplate('{ "a": }')!;
    expect(problem).toEqual({ from: 7, to: 8, message: 'Expected a value, found "}"' });
  });

  it("explains common mistakes", () => {
    expect(checkJsonTemplate("{ 'a': 1 }")!.message).toBe(`Expected a property name in double quotes, found "'"`);
    expect(checkJsonTemplate('{ "a": 1 "b": 2 }')!.message).toBe('Expected "," or "}", found """');
    expect(checkJsonTemplate('{ "a": "x }')!.message).toBe("Unterminated string");
    expect(checkJsonTemplate("[1, 2,]")!.message).toBe("Trailing comma before ]");
    expect(checkJsonTemplate('{"a": 1} x')!.message).toBe('Unexpected "x" after the JSON value');
  });

  it("agrees with JSON.parse on plain JSON", () => {
    for (const text of [String.raw`{"a":[1,2.5e3,-0,true,null,{"b":"\u00e9\n"}]}`, "[]", '"x"', "1", "01", "[1,]", "{,}", '{"a" 1}', "tru"]) {
      let parses = true;
      try {
        JSON.parse(text);
      } catch {
        parses = false;
      }
      expect(checkJsonTemplate(text) === null, text).toBe(parses);
    }
  });
});
