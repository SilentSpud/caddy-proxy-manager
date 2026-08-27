import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * maplibre-gl v6 loads its tile worker from a separate ES module whose runtime
 * `import.meta.url` lookup does not survive bundling, so WorldMapInner imports
 * that worker with Vite's `?worker&url` and hands the emitted chunk to
 * setWorkerUrl(). These tests fail loudly if a maplibre-gl upgrade renames the
 * worker entry, or if the config that combination depends on drifts — either
 * would otherwise only surface as a blank map.
 */

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '../..');

const WORKER_SPECIFIER = 'maplibre-gl/dist/maplibre-gl-worker.mjs';

const worldMapInner = readFileSync(
  join(projectRoot, 'app', '(dashboard)', 'analytics', 'WorldMapInner.tsx'),
  'utf8',
);

describe('maplibre worker wiring', () => {
  it('resolves the worker entry maplibre-gl still ships', () => {
    expect(() => require.resolve(WORKER_SPECIFIER)).not.toThrow();
  });

  it('imports that worker through Vite so its sibling chunks get bundled in', () => {
    // The worker is not self-contained — it imports ./maplibre-gl-shared.mjs,
    // which a bare `?url` copy of the entry alone would 404 on.
    expect(readFileSync(require.resolve(WORKER_SPECIFIER), 'utf8')).toContain(
      './maplibre-gl-shared.mjs',
    );
    // Quote-agnostic on purpose: the assertion is about which module the client
    // hands maplibre, not about how the formatter happens to quote it.
    expect(worldMapInner.replace(/'/g, '"')).toContain(`"${WORKER_SPECIFIER}?worker&url"`);
  });

  it('points maplibre at the imported URL rather than a hardcoded path', () => {
    const setWorkerUrl = worldMapInner.match(/setWorkerUrl\(([^)]*)\)/);
    expect(setWorkerUrl?.[1]).toBe('maplibreWorkerUrl');
  });

  it('builds workers as ES modules, which maplibre requires', () => {
    // maplibre spawns the worker itself, as a module worker. Vite's build
    // default is iife, which that spawn would reject, so the config has to
    // override it — if maplibre ever drops `type: "module"` this test says so.
    const maplibre = readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'), 'utf8');
    expect(maplibre.replace(/`/g, '"')).toContain('new Worker(e,{type:"module"})');

    const viteConfig = readFileSync(join(projectRoot, 'vite.config.ts'), 'utf8');
    expect(viteConfig.replace(/'/g, '"')).toMatch(/worker:\s*\{\s*format:\s*"es"/);
  });

  it("CSP allows loading the worker from 'self'", () => {
    const proxy = readFileSync(join(projectRoot, 'proxy.ts'), 'utf8');
    const workerSrc = proxy.match(/"worker-src ([^"]+)"/);
    expect(workerSrc?.[1]).toContain("'self'");
  });
});
