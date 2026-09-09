"use client";

/**
 * The dash a table cell shows where there is no value.
 *
 * One key, read through one hook, rather than the literal repeated at every cell that can be
 * empty. It is a string a person reads, so `AGENTS.md` puts it in the catalog like any other - and
 * a single key is what lets a language that would rather write something else change all of them
 * at once. It also stops the character drifting: these were em dashes until the repository was
 * swept, and the sweep had to find every one of them by hand.
 *
 * A hook rather than a component because most of the call sites need a `string`: a `label` prop, a
 * `??` fallback beside a value, or the return of a formatting helper.
 */
import { useTranslations } from "next-intl";

export function useEmptyValue(): string {
  return useTranslations("ui")("emptyValue");
}
