import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
