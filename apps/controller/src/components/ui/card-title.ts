/**
 * The small title a stat card opens with, on every page that has one.
 *
 * Between the primary and secondary text colours: brighter than the captions, but not competing
 * with the numbers. Astryx has no token for that step, so it is mixed from the two that do exist,
 * which keeps it right in both themes. Pair it with body text, not supporting or xsm label type.
 */
export const CARD_TITLE_STYLE = {
  color: "color-mix(in srgb, var(--color-text-primary) 60%, var(--color-text-secondary))",
  textTransform: "capitalize",
} as const;
