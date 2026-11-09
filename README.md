# Reqora

Visual API flow builder — Next.js 16 (App Router, Turbopack, Cache Components) + Tailwind CSS v4.

UI is ported from the Stitch project **Visual API Flow Builder** (`projects/14292666328900997952`).
The raw Stitch HTML exports live in [`design/`](design/) for reference.

> **Accounts.** The first visit offers to create the owner account; after that sign-up is closed. Workspace owners
> add people from **Members & Settings** (creating an account with a first password if needed), or an admin runs
> `npm run user -- create <email> "<name>"` (`reset-password <email>`, `list`). Every page and API
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

- **Workspaces.** Flows, runs, collections, secrets and history belong to a workspace, picked in the top bar.
  Members are Owners (also manage members, rename/delete), Editors (change anything inside) or Viewers (read
  only). Each workspace has its own production / staging / sandbox variables. Data from before workspaces is in
  "Default"; API clients can pick a workspace with the `X-Reqora-Workspace` header.
- **Test users.** On the Secrets page (Test Users), each environment has users with roles (e.g. `maker`,
  `authorizer`) and values (`login_id`, `password`, tokens; secret columns are encrypted). Steps read the acting user
  with `{{user.login_id}}`; scripts save to them with `rq.user.set("access_token", …)`. Set a **login request** and
  users are logged in automatically before they act (again after the session length or a 401). Flows name their
  roles and each step has **Run as**; pick users per role under Run as on the canvas, in load tests (each virtual
  user keeps one user, or users take turns), on webhooks (`?as.maker=maker01`) and in Collections (Send as).
  `/api/demo/bank/*` is a small maker-checker demo API to try it with.
- **Call Flow.** A Call Flow node runs another flow of the same workspace and waits for it: the called flow's
  deployed version (or its draft if never deployed) gets the node's body as `{{trigger.body}}`, and its Response
  becomes `{{call-1.body.*}}`. Called runs show in Execution History, linked to their caller.
- **Draft vs deployed.** Canvas edits autosave to the draft (`version`). Test runs (Run Workflow / Emit Webhook
  Test) execute the draft. The webhook endpoint `POST /api/hooks/{id}` only runs the **deployed** snapshot —
  press **Deploy** to promote the draft. The canvas shows `Draft vN · live vM`.
- **Environments.** `production`, `staging`, `sandbox`, picked in the top bar (Sandbox until a browser picks one;
  runs, sends, load tests and replays in Production ask for confirmation first). Each has its own variables
  (Secrets page). `{{env.NAME}}` resolves from the run's environment, then falls back to the server variable
  `REQORA_ENV_NAME`. Secret values are AES-256-GCM encrypted at rest and write-only through the API. Run history and the
  Collections send history show real values (signed-in users only); a deployed webhook's response to its caller
  has resolved values scrubbed, even if an upstream echoes them.

- **Outbound network policy.** Everything the server sends for a user (Collections sends, workflow HTTP nodes, load
  tests) is checked when each connection opens, including redirects: loopback and private networks are refused
  unless listed in `REQORA_ALLOW_NETWORKS` (CIDRs, host names, or `private`), and link-local / cloud metadata
  addresses are always refused. Reqora's own origin stays reachable. See `.env.example`.
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
| `GET/POST /api/workspaces`                       | Your workspaces + the active one / create one                  |
| `PATCH/DELETE /api/workspaces/{id}`              | Rename / delete a workspace (owners)                           |
| `POST /api/workspaces/{id}/select`               | Make it the active workspace                                   |
| `GET/POST /api/workspaces/{id}/members`          | Members / add one by email (owners)                            |
| `PATCH/DELETE /api/workspaces/{id}/members/{userId}` | Change role / remove (owners) or leave                     |
| `POST /api/demo/...`                             | Local stand-ins for Stripe / ERP / Slack used by the seed      |

Node types: `webhook` (trigger), `http`, `condition` (`true`/`false` ports), `transform`, `delay`, `script`, `call`
(Call Flow), `response`.
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
| `/telemetry`      | Telemetry & metrics                                        |
| `/workspace`      | Members & settings of the active workspace                 |

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
