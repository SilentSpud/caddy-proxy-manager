"use client";

import { useMemo } from "react";
import { useTheme } from "@astryxdesign/core";
import type { ApexOptions } from "apexcharts";

/**
 * ApexCharts options derived from the active Astryx theme.
 *
 * ApexCharts renders SVG and writes concrete colours into `fill`/`stroke`
 * attributes, so it cannot be handed `var(--color-…)` the way ordinary CSS can.
 * Astryx's `useTheme().token()` exists for exactly this: it resolves a token's
 * `light-dark()` pair down to the one value in effect, which is what gets
 * passed through here. Re-resolved whenever the mode changes, so a theme flip
 * repaints the charts.
 */
export interface ChartTheme {
  /** Resolved mode — ApexCharts has its own light/dark defaults keyed off this. */
  mode: "light" | "dark";
  /** Shared chart chrome: background, grid, tooltip, axis label styling. */
  base: ApexOptions;
  /** Axis and legend label colour, ready to drop into a `style.colors`. */
  labelColor: string;
  /**
   * Categorical series colours.
   *
   * Astryx's categorical tokens are deliberately identical in light and dark —
   * a series keeps its identity when the mode flips, which is what makes a
   * legend memorable — so these are stable by design, not by oversight.
   */
  series: {
    blue: string;
    red: string;
    purple: string;
    cyan: string;
    orange: string;
  };
  /** Text drawn on top of a filled series colour (donut slice labels). */
  onSeries: string;
}

export function useChartTheme(): ChartTheme {
  // `tokens` rather than `token()`: the map is memoized on theme + mode, while
  // the lookup function is rebuilt every render and would defeat the useMemo.
  const { mode, tokens } = useTheme();

  return useMemo(() => {
    const token = (name: string) => tokens[name] ?? "";
    const labelColor = token("--color-text-secondary");

    return {
      mode,
      labelColor,
      base: {
        chart: {
          background: "transparent",
          toolbar: { show: false },
          animations: { enabled: false },
        },
        theme: { mode },
        grid: { borderColor: token("--color-border") },
        tooltip: { theme: mode },
      },
      series: {
        blue: token("--color-data-categorical-blue"),
        red: token("--color-data-categorical-red"),
        purple: token("--color-data-categorical-purple"),
        cyan: token("--color-data-categorical-cyan"),
        orange: token("--color-data-categorical-orange"),
      },
      // The categorical colours are saturated mid-tones, so the "on dark"
      // foreground stays legible on every one of them in both modes.
      onSeries: token("--color-on-dark"),
    };
  }, [mode, tokens]);
}
