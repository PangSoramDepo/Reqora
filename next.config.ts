import type { NextConfig } from "next";

/** Extra hostnames (comma-separated) allowed to load the dev server's assets, e.g. a Cloudflare tunnel. */
const devOrigins = (process.env.REQORA_DEV_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Without this, `next dev` refuses its JS to any hostname but localhost: pages render but never
  // hydrate, so the sign-in form does a plain browser submit and just reloads /login.
  allowedDevOrigins: devOrigins,
  cacheComponents: true,
  // QuickJS (the script sandbox) loads its .wasm next to its own JS at runtime; bundling would break that path.
  serverExternalPackages: ["quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],
  // Forwarding browser console output writes to .next/dev/logs, which retriggers a compile and a full
  // page reload in this setup — an endless loop. Keep browser logs in the browser's devtools.
  logging: { browserToTerminal: false },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
