# Reqora

Visual API flow builder — Next.js 16 (App Router, Turbopack, Cache Components) + Tailwind CSS v4.

UI is ported from the Stitch project **Visual API Flow Builder** (`projects/14292666328900997952`).
The raw Stitch HTML exports live in [`design/`](design/) for reference.

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000 → redirects to /flow
npm run build
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
- `src/components/<screen>/` — per-screen components; each has a `data.ts` with mock data to swap for real APIs.
