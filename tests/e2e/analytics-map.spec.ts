import { test, expect, type Page } from '@playwright/test';

/**
 * Regression tests for the "Traffic by Country" world map.
 *
 * maplibre-gl v6 moved its tile worker into a separate ES module resolved at
 * runtime from `import.meta.url`, which Turbopack cannot resolve correctly. The
 * worker silently failed to start and the map rendered as an empty ocean — no
 * countries, no hover popups, and no visible error in the UI.
 *
 * The fix imports the worker as `?worker&url` (WorldMapInner.tsx), which has the
 * bundler emit its whole module graph as one self-contained, content-hashed
 * chunk and hand back the path, and points maplibre at it via setWorkerUrl().
 * These tests cover both the plumbing (worker chunk served, CSP allows the
 * worker) and the observable outcome (country geometry is actually rendered and
 * hit-testable).
 */

const MAP_CANVAS = 'canvas.maplibregl-canvas';

async function gotoAnalyticsMap(page: Page) {
  await page.goto('/analytics');
  await expect(page.getByText('Traffic by Country')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(MAP_CANVAS)).toBeVisible({ timeout: 15_000 });
}

test.describe('Analytics world map', () => {
  test('maplibre worker is served as one self-contained chunk', async ({ page }) => {
    const mapRequests: { url: string; status: number }[] = [];
    page.on('response', (res) => {
      const url = new URL(res.url()).pathname;
      if (url.includes('maplibre')) mapRequests.push({ url, status: res.status() });
    });

    await gotoAnalyticsMap(page);
    // The worker is spawned lazily once the map starts loading its source. Its
    // filename is content-hashed and its directory is the bundler's to choose,
    // so match the stem rather than pinning a path the build is free to move.
    await expect
      .poll(() => mapRequests.map((r) => r.url), { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining('maplibre-gl-worker-')]));

    // The worker imports a sibling ./maplibre-gl-shared.mjs, and `?worker&url`
    // bundles that into the same chunk. Seeing it arrive as a request of its own
    // means the build went back to emitting the entry file alone — the shape
    // whose relative import 404s, leaving the map an empty ocean.
    expect(
      mapRequests.filter((r) => r.url.includes('maplibre-gl-shared')),
      'maplibre-gl-shared should be bundled into the worker chunk, not fetched separately',
    ).toEqual([]);

    const failed = mapRequests.filter((r) => r.status >= 400);
    expect(failed, `maplibre assets failed to load: ${JSON.stringify(failed)}`).toEqual([]);
  });

  test('map loads without CSP violations or worker errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoAnalyticsMap(page);
    await page.waitForTimeout(3_000); // let the worker spin up and the source parse

    const mapErrors = errors.filter((e) => /worker|content security policy|maplibre/i.test(e));
    expect(mapErrors, `map errors in console: ${JSON.stringify(mapErrors)}`).toEqual([]);
  });

  test('map renders country geometry that responds to hover', async ({ page }) => {
    await gotoAnalyticsMap(page);

    // MapLibre's own container carries `overflow: hidden`, so if it collapses to
    // zero height the canvas is clipped away entirely: nothing paints and nothing
    // hit-tests, while the map instance still reports rendered features. Assert
    // the container has real height first, so that regression reports itself
    // instead of masquerading as "the map has no geometry".
    const mapContainer = page.locator('.maplibregl-map');
    await expect
      .poll(async () => Math.round((await mapContainer.boundingBox())?.height ?? 0), {
        timeout: 10_000,
        message: 'the MapLibre container collapsed to zero height — the canvas is clipped away',
      })
      .toBeGreaterThan(100);

    const canvas = page.locator(MAP_CANVAS);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Give the worker time to parse the source and the fill layer to paint —
    // the canvas is visible well before any geometry exists.
    await page.waitForTimeout(3_000);

    // Hovering a country only produces a popup when the fill layer is actually
    // rendered; with a broken worker the map is all ocean and every hover is a
    // miss. Sweep a grid rather than a handful of hand-picked offsets: the
    // exact projection depends on how maplibre fits the configured bounds to
    // the current canvas size, so fixed fractions are not a safe bet for
    // "this point is over land". A map with no geometry still misses all of
    // them, which is the condition this test exists to catch.
    const targets: [number, number][] = [];
    for (const fy of [0.3, 0.4, 0.5, 0.62, 0.72]) {
      for (const fx of [0.2, 0.3, 0.5, 0.55, 0.72, 0.85]) {
        targets.push([fx, fy]);
      }
    }

    const popup = page.locator('.wm-popup');
    let popupText: string | null = null;
    for (const [fx, fy] of targets) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      // Two moves: maplibre only re-evaluates the hover on a mousemove event,
      // so a repeat of the current position would produce no event at all.
      await page.mouse.move(x - 2, y - 2);
      await page.mouse.move(x, y);
      try {
        await expect(popup).toBeVisible({ timeout: 1_000 });
        popupText = await popup.innerText();
        break;
      } catch {
        // Miss (ocean) — try the next point.
      }
    }

    expect(
      popupText,
      `no country popup appeared over any of ${targets.length} points — the map rendered no country geometry`,
    ).not.toBeNull();
    expect(popupText).toContain('Requests');
  });
});
