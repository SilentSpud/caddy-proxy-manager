/**
 * Copy maplibre-gl's tile worker (and everything it imports) into
 * `public/maplibre/` so the browser can load it from a stable, self-hosted URL.
 *
 * Why this exists
 * ---------------
 * maplibre-gl v6 stopped inlining its worker as a blob and now resolves a
 * separate `maplibre-gl-worker.mjs` at runtime from `import.meta.url`. That
 * lookup does not survive Turbopack bundling:
 *
 *   - `next dev`   → resolves to the page URL, so the HTML page is loaded as a
 *                    worker and the map renders as an empty ocean.
 *   - `next build` → resolves to the wrong dist file (the main bundle).
 *
 * Pointing maplibre at a bundler-emitted asset does not work either: the worker
 * is an ES module that imports `./maplibre-gl-shared.mjs`, and Turbopack emits
 * each dist file under a different content-hashed name without rewriting those
 * relative imports, so the sibling import 404s.
 *
 * Copying the worker's whole module graph verbatim keeps the relative imports
 * resolvable. `WorldMapInner.tsx` then calls `setWorkerUrl()` with this path.
 *
 * Runs from next.config.mjs so it covers `next dev`, `next build` and the Docker
 * build alike, under both Node and Bun, with no extra lifecycle script wiring.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

export const PUBLIC_DIR = "maplibre";
export const WORKER_ENTRY = "maplibre-gl-worker.mjs";
/** URL the browser loads the worker from — keep in sync with WorldMapInner.tsx. */
export const WORKER_PUBLIC_PATH = `/${PUBLIC_DIR}/${WORKER_ENTRY}`;

/**
 * Relative specifiers of `from './x'`, `import './x'` and `import('./x')`, so we
 * follow the worker's chunk graph. maplibre's dist is minified, so whitespace is
 * routinely absent — the worker entry opens with `}from"./maplibre-gl-shared.mjs"`.
 */
function relativeImports(source) {
  const specifiers = new Set();
  const re = /\b(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g;
  let match;
  // The assignment is what advances the regex over the source on each pass.
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec() loop
  while ((match = re.exec(source)) !== null) specifiers.add(match[1]);
  return specifiers;
}

/**
 * @param {string} projectRoot absolute path to the repo root
 * @returns {string[]} names of the files that were copied
 */
export function copyMaplibreWorker(projectRoot) {
  const distDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"));
  const outDir = resolve(projectRoot, "public", PUBLIC_DIR);
  mkdirSync(outDir, { recursive: true });

  const copied = [];
  const queue = [WORKER_ENTRY];
  const seen = new Set(queue);

  while (queue.length > 0) {
    const name = queue.shift();
    const from = join(distDir, name);
    const to = join(outDir, name);

    if (!existsSync(from)) {
      throw new Error(
        `maplibre-gl worker chunk "${name}" is missing from ${distDir}; ` +
          "scripts/copy-maplibre-worker.mjs needs updating for this maplibre-gl version.",
      );
    }

    // maplibre's dist files are immutable per version; size is enough to detect
    // a version bump without re-reading ~500 KB on every config load.
    let upToDate;
    try {
      upToDate = statSync(to).size === statSync(from).size;
    } catch {
      upToDate = false; // not staged yet
    }
    if (!upToDate) {
      copyFileSync(from, to);
      copied.push(name);
    }

    for (const specifier of relativeImports(readFileSync(from, "utf8"))) {
      const dep = specifier.replace(/^\.\//, "");
      if (dep.includes("/")) {
        throw new Error(
          `maplibre-gl worker imports "${specifier}" from a subdirectory; ` +
            "scripts/copy-maplibre-worker.mjs needs updating.",
        );
      }
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }

  return copied;
}
