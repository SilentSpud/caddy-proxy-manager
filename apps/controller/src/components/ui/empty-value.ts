"use client";

/**
 * The dash a table cell shows where there is no value: one key, so a language that would rather
 * write something else changes every cell at once. A hook rather than a component because the call
 * sites need a `string` - a `label` prop, a `??` fallback, or a formatting helper's return.
 */
import { useTranslations } from "next-intl";

export function useEmptyValue(): string {
  return useTranslations("ui")("emptyValue");
}
