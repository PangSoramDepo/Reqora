# Reqora

Visual API flow builder — Next.js 16 (App Router, Turbopack, Cache Components) + Tailwind CSS v4.

UI is ported from the Stitch project **Visual API Flow Builder** (`projects/14292666328900997952`).
The raw Stitch HTML exports live in [`design/`](design/) for reference.

> **Accounts.** The first visit offers to create the owner account; after that sign-up is closed and an admin
> adds people with `npm run user -- create <email> "<name>"` (`reset-password <email>`, `list`). Every page and API
> needs a session except `/login`, `/api/auth/*`, `/api/demo/*` and the webhook endpoint `/api/hooks/{id}` —
> anyone who knows a workflow's webhook URL can trigger its deployed version.

## Getting started

```bash
npm install
cp .env.example .env.local   # fallback demo secret for the seeded workflow
npm run dev                  # http://localhost:3000 → opens your latest workflow
npm test                     # unit tests (vitest)
npm run build
```

Requires Node 22.5+ (uses the built-in `node:sqlite`). Data lives in `.data/` (git-ignored): `reqora.db`, and in
development `secret.key`, the generated key that encrypts stored secrets. Delete `.data/` to start over.
In production set `REQORA_SECRET_KEY` (32 bytes, hex or base64) — the server refuses to store secrets without it.

## Concepts

- **Draft vs deployed.** Canvas edits autosave to the draft (`version`). Test runs (Run Workflow / Emit Webhook
  Test) execute the draft. The webhook endpoint `POST /api/hooks/{id}` only runs the **deployed** snapshot —
  press **Deploy** to promote the draft. The canvas shows `Draft vN · live vM`.
- **Environments.** `production`, `staging`, `sandbox`, picked in the top bar. Each has its own variables
  (Secrets page). `{{env.NAME}}` resolves from the run's environment, then falls back to the server variable
  `REQORA_ENV_NAME`. Secret values are AES-256-GCM encrypted at rest, write-only through the API, and scrubbed
  from stored run history even if an upstream echoes them.

- **Collections inherit like Postman.** Collections and folders carry auth, headers and pre-request /
  post-response scripts; requests use "Inherit auth from parent" by default. Scripts are JavaScript run in a QuickJS
  WebAssembly sandbox (no network, files or timers; 1 s / 32 MB each) with an `rq` API — see the API description.
  Drag requests to reorder them, or drag a saved request from the sidebar onto the canvas to make an HTTP node.

## API

The contract is [`api/openapi.yaml`](api/openapi.yaml). Summary:

| Method & path                                    | Purpose                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `GET/POST /api/workflows`                        | List / create workflows                                       |
| `GET/PUT/DELETE /api/workflows/{id}`             | Read / replace draft (send `version`; stale → 409) / delete    |
| `POST /api/workflows/{id}/deploy`                | Promote draft `version` to live                               |
| `GET/POST /api/workflows/{id}/runs`              | List runs / run the draft: `{ environment, trigger: { body } }` |
| `GET /api/runs?since=24h&status=`                | Runs across workflows (`since`: 24h / 7d / 30d)                |
| `GET /api/runs/stats?since=24h`                  | Totals, success rate, avg and p95 duration                     |
| `GET /api/runs/{runId}`                          | A run with per-step request, output and errors                |
| `POST /api/runs/{runId}/replay`                  | Re-run that trigger body on the current draft                 |
| `GET /api/environments/{env}/variables`          | Variables + where they're used + referenced-but-missing names  |
| `PUT/DELETE /api/environments/{env}/variables/{NAME}` | Set (`{kind: secret\|plain, value}`) / delete a variable  |
| `POST /api/hooks/{id}?environment=`              | Live webhook: runs the deployed version                        |
| `POST /api/demo/...`                             | Local stand-ins for Stripe / ERP / Slack used by the seed      |

Node types: `webhook` (trigger), `http`, `condition` (`true`/`false` ports), `transform`, `delay`, `response`.
Templates: `{{trigger.body.x}}`, `{{<nodeId>.body.x}}`, `{{env.NAME}}`.

```bash
curl -X POST localhost:3000/api/hooks/wf_checkout_pipeline \
  -H 'content-type: application/json' \
  -d '{"id":"ord_1","amount":749.5,"sku":"SKU-1"}'
```

## Routes

| Route             | Screen                                                     |
| ----------------- | ---------------------------------------------------------- |
| `/flow`           | Redirects to the most recently edited workflow             |
| `/login`          | Sign in (or create the first account)                      |
| `/flow/{id}`      | Flow canvas (switch / create / rename / delete in the strip) |
| `/collections`    | API collections & request builder                          |
| `/executions`     | Execution history & trace debugger                         |
| `/secrets`        | Environment variables & secrets                            |
| `/telemetry`      | Telemetry & metrics (still mock data)                      |

## Layout

- `src/app/globals.css` — design tokens (`@theme`) from the "Nexus Orchestration System" design system. Note the radius remap: `rounded` = 2px, `rounded-lg` = 4px, `rounded-xl` = 8px.
- `src/app/(workspace)/layout.tsx` — shared shell: node-library sidebar, top bar, status bar.
- `src/lib/workflows/` — model (`schema.ts`), graph validation, templates, engine, SQLite store, seed.
- `src/lib/secrets/` — encryption and variable storage.
- `src/lib/auth/`, `src/proxy.ts` — scrypt passwords, hashed session tokens, login throttling; the proxy denies by default.
- `src/lib/collections/`, `src/components/collections/` — saved requests, server-side send, assertions, cURL/OpenAPI import.
- `src/lib/canvas-events.ts`, `src/lib/environment.ts` — top bar ↔ canvas commands; shared environment choice.
- `src/components/flow/` — canvas: load, autosave with version checks, edit, run, deploy.
- `src/components/executions/` — live run history (polls every 5s), waterfall trace, replay.
- `src/components/secrets/` — variables per environment, usage matrix.
- `src/components/telemetry/` — still mock data (`data.ts`).
