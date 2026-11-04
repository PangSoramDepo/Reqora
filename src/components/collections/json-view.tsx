import type { ReactNode } from "react";

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
const MAX_HIGHLIGHT_LINES = 4000;

function highlightLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [text, str, colon, bool] = m;
    let cls = "text-tertiary-fixed-dim"; // numbers
    if (str !== undefined) cls = colon ? "text-primary" : "text-secondary";
    else if (bool !== undefined) cls = "text-primary-container font-semibold";
    else if (text === "null") cls = "text-outline";
    out.push(
      <span key={n++} className={cls}>
        {str !== undefined && colon ? str : text}
      </span>,
    );
    if (str !== undefined && colon) out.push(colon);
    last = m.index + text.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Line-numbered code view; JSON gets syntax colours (plain text past a size limit). */
export function CodeView({ text, json }: { text: string; json: boolean }) {
  const lines = text.split("\n");
  const highlight = json && lines.length <= MAX_HIGHLIGHT_LINES;
  return (
    <div className="flex min-w-max">
      <div aria-hidden="true" className="w-8 shrink-0 select-none text-right pr-3 text-outline/60 leading-relaxed">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 text-on-surface leading-relaxed whitespace-pre font-code-block text-code-block">
        {lines.map((line, i) => (
          <div key={i}>{line === "" ? " " : highlight ? highlightLine(line) : line}</div>
        ))}
      </pre>
    </div>
  );
}
