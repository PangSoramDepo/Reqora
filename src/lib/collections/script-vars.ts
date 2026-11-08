/** Names a script sets with rq./pm. `variables.set("name", …)` (→ `{{vars.name}}`) and `environment.set` (→ `{{env.name}}`). */
export function scriptVariables(...scripts: (string | undefined)[]): { vars: string[]; env: string[] } {
  const vars = new Set<string>();
  const env = new Set<string>();
  const SET = /\b(?:rq|pm)\.(variables|collectionVariables|globals|environment)\.set\(\s*(['"`])([^'"`\n]+)\2/g;
  for (const code of scripts) {
    if (!code) continue;
    for (const m of code.matchAll(SET)) (m[1] === "environment" ? env : vars).add(m[3]);
  }
  return { vars: [...vars].sort(), env: [...env].sort() };
}
