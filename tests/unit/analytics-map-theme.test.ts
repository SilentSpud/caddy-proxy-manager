import { describe, expect, it } from 'bun:test';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import {
  fillLayerFor,
  hoverLayerFor,
  mapPalette,
  mapStyleFor,
  outlineLayerFor,
  selectedLayerFor,
  type MapPalette,
} from '../../app/(dashboard)/analytics/map-theme';

/**
 * Builds the palette the way the component does: Astryx tokens resolved for one
 * colour mode. Going through the real theme rather than a stub is the point —
 * the failure this guards against is a token being renamed or dropped upstream,
 * which a hand-written fixture would hide.
 */
function paletteFor(mode: 'light' | 'dark'): MapPalette {
  const tokens = resolveThemeTokens(neutralTheme, { mode });
  return mapPalette(mode, (name) => tokens[name] ?? '');
}

/** Every colour string the palette feeds into a MapLibre paint property. */
function paintColors(p: MapPalette): string[] {
  return [p.ocean, p.empty, ...p.ramp, p.highlight, p.outline];
}

const MODES = ['light', 'dark'] as const;

describe('analytics map palette', () => {
  it.each([...MODES])('resolves every token to a concrete colour in %s mode', (mode) => {
    for (const color of paintColors(paletteFor(mode))) {
      expect(color).not.toBe('');
      // MapLibre paints in WebGL and cannot resolve CSS custom properties or a
      // light-dark() pair — an unresolved token would reach the GPU as garbage
      // and silently paint nothing.
      expect(color).not.toContain('light-dark');
      expect(color).not.toContain('var(');
    }
  });

  it.each([...MODES])('produces colours MapLibre can parse in %s mode', (mode) => {
    for (const color of paintColors(paletteFor(mode))) {
      // Color.parse returns undefined rather than throwing on a bad value, so
      // an unparseable colour would otherwise fail silently at paint time.
      expect(Color.parse(color), `unparseable: ${color}`).toBeDefined();
    }
  });

  it('inverts the choropleth ramp between modes', () => {
    const light = paletteFor('light');
    const dark = paletteFor('dark');

    // Same three stops, opposite order: "more traffic" has to read as darker on
    // a light ocean and lighter on a dark one.
    expect([...dark.ramp]).toEqual([...light.ramp].reverse());
    expect(new Set(light.ramp).size).toBe(3);
  });

  it('keeps empty land distinct from the ocean in both modes', () => {
    for (const mode of MODES) {
      const p = paletteFor(mode);
      // A country with no traffic must not disappear into the sea.
      expect(p.empty).not.toBe(p.ocean);
    }
  });

  it('gives light and dark genuinely different chrome', () => {
    const light = paletteFor('light');
    const dark = paletteFor('dark');

    expect(light.ocean).not.toBe(dark.ocean);
    expect(light.empty).not.toBe(dark.empty);
    expect(light.highlight).not.toBe(dark.highlight);
  });

  it('builds layer specs carrying the palette through', () => {
    const p = paletteFor('dark');

    expect(mapStyleFor(p.ocean).layers[0].paint['background-color']).toBe(p.ocean);
    expect(selectedLayerFor(p).paint?.['fill-color']).toBe(p.highlight);
    expect(hoverLayerFor(p).paint?.['fill-color']).toBe(p.highlight);
    expect(outlineLayerFor(p).paint?.['line-color']).toBe(p.outline);

    // The fill is an interpolate expression; the stops must appear in ramp
    // order after the "no traffic" colour.
    const fill = fillLayerFor(p).paint?.['fill-color'] as unknown[];
    expect(fill.slice(0, 3)).toEqual(['interpolate', ['linear'], ['coalesce', ['get', 'norm'], 0]]);
    expect(fill.slice(3)).toEqual([0, p.empty, 0.001, p.ramp[0], 0.4, p.ramp[1], 1, p.ramp[2]]);
  });

  it('keeps ids stable — the map queries and filters layers by name', () => {
    const p = paletteFor('light');
    expect(fillLayerFor(p).id).toBe('countries-fill');
    expect(selectedLayerFor(p).id).toBe('countries-selected');
    expect(hoverLayerFor(p).id).toBe('countries-hover');
    expect(outlineLayerFor(p).id).toBe('countries-outline');
  });
});
