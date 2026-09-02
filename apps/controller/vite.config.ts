import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), vinext()],

  // maplibre-gl constructs its tile worker with `{ type: "module" }`, so the
  // chunk `?worker&url` emits for it (see WorldMapInner.tsx) has to be an ES
  // module — Vite's build default is iife, which that worker would reject.
  worker: { format: "es" },
});
