/**
 * How tightly tables are set - a per-user choice, made on Profile.
 *
 * Astryx's own three densities: they change a row's padding, never its text, so every density
 * keeps the 14px values astryx-variants.css sets. Balanced is Astryx's default and what a user who
 * never chose gets. Kept free of server imports: the Profile control and the provider read the list
 * too.
 */
export const TABLE_DENSITIES = ["compact", "balanced", "spacious"] as const;

export type TableDensity = (typeof TABLE_DENSITIES)[number];

export const DEFAULT_TABLE_DENSITY: TableDensity = "balanced";

export function isTableDensity(value: unknown): value is TableDensity {
  return typeof value === "string" && (TABLE_DENSITIES as readonly string[]).includes(value);
}
