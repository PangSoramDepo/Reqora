import { describe, expect, it } from "vitest";
import { beautifyJson } from "./beautify";

describe("beautifyJson", () => {
  it("formats plain JSON", () => {
    expect(beautifyJson('{"a":1,"b":[true]}')).toEqual({ ok: true, text: '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}' });
  });

  it("keeps bare and quoted placeholders intact", () => {
    const result = beautifyJson('{"id":"{{$guid}}","n":{{$timestamp}},"o":{{ env.OBJ }}}');
    expect(result).toEqual({ ok: true, text: '{\n  "id": "{{$guid}}",\n  "n": {{$timestamp}},\n  "o": {{ env.OBJ }}\n}' });
  });

  it("reports invalid JSON", () => {
    expect(beautifyJson("{a:1}").ok).toBe(false);
  });
});
