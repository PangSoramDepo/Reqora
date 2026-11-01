# Reqora

Visual API flow builder — Next.js 16 (App Router, Turbopack, Cache Components) + Tailwind CSS v4.

UI is ported from the Stitch project **Visual API Flow Builder** (`projects/14292666328900997952`).
The raw Stitch HTML exports live in [`design/`](design/) for reference.

## Getting started

```bash
npm install
cp .env.example .env.local   # demo secret used by the seeded workflow
npm run dev                  # http://localhost:3000 → redirects to /flow
npm test                     # engine/template unit tests (vitest)
npm run build
```

Requires Node 22.5+ (uses the built-in `node:sqlite`). Data lives in `.data/reqora.db` (git-ignored); delete it to
re-seed the "Customer Checkout Pipeline" workflow.

## API

The contract is [`api/openapi.yaml`](api/openapi.yaml). Summary:

| Method & path                         | Purpose                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `GET/POST /api/workflows`             | List / create workflows                                          |
| `GET/PUT/DELETE /api/workflows/{id}`  | Read / replace (send `version`; stale → 409) / delete             |
| `GET/POST /api/workflows/{id}/runs`   | List runs / execute synchronously with `{ trigger: { body } }`    |
| `GET /api/runs?since=24h&status=`     | Runs across workflows (`since`: 24h / 7d / 30d)                   |
| `GET /api/runs/stats?since=24h`       | Totals, success rate, avg and p95 duration for the window          |
| `GET /api/runs/{runId}`               | Read a run with per-step request, output and errors               |
| `POST /api/runs/{runId}/replay`       | Re-run that trigger body on the workflow's current version         |
| `POST /api/hooks/{id}`                | Webhook entry: request body becomes `trigger.body`                |
| `POST /api/demo/...`                  | Local stand-ins for Stripe / ERP / Slack used by the seed          |

Node types: `webhook` (trigger), `http`, `condition` (`true`/`false` ports), `transform`, `delay`, `response`.
Templates: `{{trigger.body.x}}`, `{{<nodeId>.body.x}}`, `{{env.NAME}}` → reads `REQORA_ENV_NAME` only.
Resolved secrets are never stored in run history; `Authorization`/`Cookie` trigger headers are redacted.

```bash
curl -X POST localhost:3000/api/workflows/wf_checkout_pipeline/runs \
  -H 'content-type: application/json' \
  -d '{"trigger":{"body":{"id":"ord_1","amount":749.5,"sku":"SKU-1"}}}'
```

## Routes

| Route         | Screen                                   |
| ------------- | ---------------------------------------- |
| `/flow`       | Interactive Visual API Flow Canvas       |
| `/executions` | Flow Execution History & Trace Debugger  |
| `/secrets`    | Environment Secrets & API Credentials    |
| `/telemetry`  | Flow Telemetry & API Performance Metrics |

## Layout

- `src/app/globals.css` — design tokens (`@theme`) from the "Nexus Orchestration System" design system. Note the radius remap: `rounded` = 2px, `rounded-lg` = 4px, `rounded-xl` = 8px.
- `src/app/(workspace)/layout.tsx` — shared shell: node-library sidebar, top bar, status bar.
- `src/components/icon.tsx` — Material Symbols glyph (`<Icon name="bolt" className="text-body-md" />`).
- `src/lib/workflows/` — model (`schema.ts`), graph validation, templates, execution engine, SQLite store, seed.
- `src/components/flow/` — canvas wired to the API (load, autosave with version checks, run, inspect).
  Drag blocks from the Node Library (or double-click them), drag output → input ports to connect,
  select a node or wire and press Delete to remove it.
- `src/components/executions/` — live run history (polls every 5s), waterfall trace, replay.
- `src/components/{secrets,telemetry}/` — still mock data (`data.ts`).
