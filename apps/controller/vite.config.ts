import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

// Version shown in the sidebar, on the login card and in the OpenAPI spec.
// Release images pass APP_VERSION (the git tag without its leading v) as a
// Docker build arg; every other build falls back to package.json.
const { version: pkgVersion } = createRequire(import.meta.url)("./package.json");
const appVersion = String(process.env.APP_VERSION || pkgVersion || "unknown").replace(/^v/, "");

export default defineConfig({
  plugins: [tailwindcss(), vinext()],

  // Read through src/lib/app-version.ts. Inlining the string keeps the rest of
  // package.json — dependency names, scripts — out of the client bundle.
  define: {
    "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(appVersion),
  },

  // maplibre-gl constructs its tile worker with `{ type: "module" }`, so the
  // chunk `?worker&url` emits for it (see WorldMapInner.tsx) has to be an ES
  // module — Vite's build default is iife, which that worker would reject.
  worker: { format: "es" },
});
