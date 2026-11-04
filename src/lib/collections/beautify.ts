const PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}/g;
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;

/**
 * Pretty-prints a JSON body template. Bare placeholders (e.g. `"n": {{$timestamp}}`) aren't valid JSON, so they
 * are swapped for sentinel strings while formatting and restored afterwards.
 */
export function beautifyJson(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const originals: string[] = [];
  const swap = (segment: string) =>
    segment.replace(PLACEHOLDER, (match) => {
      originals.push(match);
      return `"__reqora_tpl_${originals.length - 1}__"`;
    });

  let masked = "";
  let last = 0;
  for (const m of text.matchAll(STRING_LITERAL)) {
    masked += swap(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  masked += swap(text.slice(last));

  let parsed: unknown;
  try {
    parsed = JSON.parse(masked);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const pretty = JSON.stringify(parsed, null, 2).replace(/"__reqora_tpl_(\d+)__"/g, (_, i: string) => originals[Number(i)]);
  return { ok: true, text: pretty };
}
