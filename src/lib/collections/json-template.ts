/** `{{env.X}}`, `{{vars.X}}`, `{{$guid}}`, `{{node.body.x}}` … */
export const TEMPLATE_PATTERN = /\{\{[^{}]*\}\}/g;

type Problem = { from: number; to: number; message: string };

class JsonError extends Error {
  constructor(
    readonly at: number,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal JSON validator that reports where the first problem is (JSON.parse doesn't always say). */
function validate(text: string) {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const describe = (at: number) => (at >= text.length ? "end of input" : `"${text[at]}"`);
  const fail = (message: string): never => {
    throw new JsonError(i, message);
  };
  const expectChar = (ch: string, what: string) => {
    ws();
    if (text[i] !== ch) fail(`Expected ${what}, found ${describe(i)}`);
    i++;
  };
  const string = () => {
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\n") fail("Unterminated string (strings can't span lines)");
      if (text[i] === "\\") {
        i++;
        if (!'"\\/bfnrtu'.includes(text[i] ?? "")) fail(`Invalid escape "\\${text[i] ?? ""}"`);
        if (text[i] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail("Invalid \\u escape (needs 4 hex digits)");
          i += 4;
        }
      }
      i++;
    }
    if (i >= text.length) fail("Unterminated string");
    i++;
  };
  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      ws();
      if (text[i] === "}") return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail(text[i] === "}" ? "Trailing comma before }" : `Expected a property name in double quotes, found ${describe(i)}`);
        string();
        expectChar(":", '":" after the property name');
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") return void i++;
        fail(`Expected "," or "}", found ${describe(i)}`);
      }
    }
    if (ch === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      for (;;) {
        ws();
        if (text[i] === "]") fail("Trailing comma before ]");
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") return void i++;
        fail(`Expected "," or "]", found ${describe(i)}`);
      }
    }
    if (ch === '"') return string();
    const literal = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(i));
    if (literal) return void (i += literal[0].length);
    if (ch === "'") fail("Strings must use double quotes");
    fail(i >= text.length ? "Expected a value, found end of input" : `Expected a value, found ${describe(i)}`);
  };
  value();
  ws();
  if (i < text.length) fail(`Unexpected ${describe(i)} after the JSON value`);
}

/**
 * Checks a JSON body that may contain {{templates}}, inside strings ("{{env.ID}}") or as bare values
 * ({{trigger.body.qty}}). Each template is replaced by `0` padded to the same length, so positions still point
 * into the original text. Returns null when it's valid (or empty).
 */
export function checkJsonTemplate(text: string): Problem | null {
  if (!text.trim()) return null;
  const probe = text.replace(TEMPLATE_PATTERN, (m) => `0${" ".repeat(m.length - 1)}`);
  try {
    validate(probe);
    return null;
  } catch (error) {
    if (!(error instanceof JsonError)) throw error;
    const from = Math.min(error.at, text.length);
    return { from, to: Math.min(text.length, from + 1), message: error.message };
  }
}
