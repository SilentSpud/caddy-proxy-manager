import { copyMaplibreWorker } from "./scripts/copy-maplibre-worker.mjs";

// When building under Node.js (not Bun), redirect bun:sqlite to a better-sqlite3 shim
// so `next build` works locally without Bun installed.
const isBun = typeof globalThis.Bun !== "undefined";

// maplibre-gl v6 loads its tile worker from a separate file that Turbopack cannot
// resolve correctly; stage it under public/ so it is served from a stable URL.
// See scripts/copy-maplibre-worker.mjs for the full explanation.
copyMaplibreWorker(import.meta.dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: isBun ? ["bun:sqlite"] : ["better-sqlite3"],
  ...(!isBun && {
    turbopack: {
      resolveAlias: {
        "bun:sqlite": "./tests/helpers/bun-sqlite-compat.ts",
        "drizzle-orm/bun-sqlite/migrator": "drizzle-orm/better-sqlite3/migrator",
        "drizzle-orm/bun-sqlite": "drizzle-orm/better-sqlite3",
      },
    },
  }),
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  output: "standalone",
  poweredByHeader: false,
  // Security headers (CSP, etc.) are set per-request in proxy.ts middleware
  // with a unique nonce, so they are NOT defined here as static headers.
};

export default nextConfig;
