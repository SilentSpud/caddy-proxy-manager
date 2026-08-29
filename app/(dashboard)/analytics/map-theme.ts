import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from "maplibre-gl";

/**
 * The map's palette, resolved from Astryx tokens for the mode in effect — MapLibre paints into
 * WebGL and takes concrete colour strings, as the charts do (see chart-theme.ts). The choropleth
 * ramp must *invert* between modes ("more traffic" is darker on a light ocean), so the direction
 * is chosen here while the stops come from the ramp.
 */
export interface MapPalette {
  ocean: string;
  /** Land with no traffic — must stay distinct from the ocean in both modes. */
  empty: string;
  /** Ramp stops for "any traffic" → "most traffic". */
  ramp: [string, string, string];
  /** Hover and selection wash, picked to survive on top of every ramp stop. */
  highlight: string;
  outline: string;
}

export function mapPalette(mode: "light" | "dark", token: (name: string) => string): MapPalette {
  const ramp: [string, string, string] =
    mode === "dark"
      ? [token("--color-data-blue-4"), token("--color-data-blue-3"), token("--color-data-blue-2")]
      : [token("--color-data-blue-2"), token("--color-data-blue-3"), token("--color-data-blue-4")];

  return {
    ocean: token("--color-background-body"),
    empty: token("--color-border-emphasized"),
    ramp,
    // The end of the ramp the data never reaches, so a highlighted country stands out however much
    // traffic it has.
    highlight: mode === "dark" ? token("--color-data-blue-1") : token("--color-data-blue-5"),
    outline: token("--color-border"),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: maplibre's StyleSpecification is far stricter than a blank base style needs
export const mapStyleFor = (ocean: string): any => ({
  version: 8,
  name: "blank",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": ocean } }],
});

export const fillLayerFor = (p: MapPalette): Omit<FillLayerSpecification, "source"> => ({
  id: "countries-fill",
  type: "fill",
  paint: {
    "fill-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "norm"], 0],
      0,
      p.empty,
      0.001,
      p.ramp[0],
      0.4,
      p.ramp[1],
      1,
      p.ramp[2],
    ] as ExpressionSpecification,
    "fill-opacity": 1,
  },
});

export const selectedLayerFor = (p: MapPalette): Omit<FillLayerSpecification, "source"> => ({
  id: "countries-selected",
  type: "fill",
  paint: {
    "fill-color": p.highlight,
    "fill-opacity": 0.45,
  },
});

export const hoverLayerFor = (p: MapPalette): Omit<FillLayerSpecification, "source"> => ({
  id: "countries-hover",
  type: "fill",
  paint: {
    "fill-color": p.highlight,
    "fill-opacity": 0.3,
  },
});

export const outlineLayerFor = (p: MapPalette): Omit<LineLayerSpecification, "source"> => ({
  id: "countries-outline",
  type: "line",
  paint: {
    "line-color": p.outline,
    "line-width": 0.6,
  },
});
