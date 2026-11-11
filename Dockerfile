# Reqora: Next.js app with an embedded SQLite database (node:sqlite) and a QuickJS (WebAssembly) script sandbox.
# Build:  docker build -t reqora .
# Usually run through docker-compose.yml (see README → Docker).

ARG NODE_VERSION=24

# --- Dependencies (all, for the build) ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- Build ---------------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Production dependencies only --------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- Runtime -------------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    REQORA_DB_PATH=/app/.data/reqora.db

# Not the standalone output: scripts load crypto-js / lodash / moment and the QuickJS .wasm from node_modules at
# runtime, so the full production node_modules ships with the app.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json next.config.ts ./
COPY --chown=node:node scripts ./scripts

# The SQLite database lives here: mount a volume so it survives new containers.
RUN mkdir -p /app/.data && chown node:node /app/.data
VOLUME ["/app/.data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start"]
