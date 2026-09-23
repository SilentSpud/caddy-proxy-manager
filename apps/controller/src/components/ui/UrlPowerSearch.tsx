"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { PowerSearch } from "@astryxdesign/core/PowerSearch";
import type {
  EnumItem,
  PowerSearchConfig,
  PowerSearchField,
  PowerSearchFilter,
} from "@astryxdesign/core/PowerSearch";

/** One filter the list understands. Its value lives in the query string under `param`. */
export type UrlSearchField = {
  param: string;
  label: string;
} & (
  | /** Free text, matched across several columns. The first one is what typing alone searches. */
  { kind: "text" }
  /** One exact value, typed. */
  | { kind: "exact" }
  | { kind: "enum"; values: ReadonlyArray<EnumItem> }
);

// Astryx ships these operator labels in every locale it has, so they need no catalog entries here.
const CONTAINS = { key: "contains", i18nKey: "@astryx.powersearch.operator.contains" } as const;
const IS = { key: "is", i18nKey: "@astryx.powersearch.operator.is" } as const;

function toConfig(name: string, fields: ReadonlyArray<UrlSearchField>): PowerSearchConfig {
  return {
    name,
    contentSearchFieldKey: fields.find((field) => field.kind === "text")?.param,
    fields: fields.map(
      (field): PowerSearchField => ({
        key: field.param,
        label: field.label,
        ...(field.kind === "text"
          ? {
              defaultOperator: CONTAINS.key,
              operators: [{ ...CONTAINS, value: { type: "string" } }],
            }
          : {
              defaultOperator: IS.key,
              operators: [
                {
                  ...IS,
                  value:
                    field.kind === "enum"
                      ? { type: "enum", values: field.values }
                      : { type: "string", isArbitraryStringAllowed: true },
                },
              ],
            }),
      }),
    ),
  };
}

function filtersFromUrl(
  fields: ReadonlyArray<UrlSearchField>,
  params: URLSearchParams,
): PowerSearchFilter[] {
  return fields.flatMap((field): PowerSearchFilter[] => {
    const value = params.get(field.param);
    if (!value) return [];
    return [
      {
        field: field.param,
        operator: field.kind === "text" ? CONTAINS.key : IS.key,
        value: field.kind === "enum" ? { type: "enum", value } : { type: "string", value },
      },
    ];
  });
}

/**
 * A list's search box as structured filters, for lists that can be narrowed on more than one column.
 *
 * The query string stays the source of truth - the server page reads it, and a filtered view can be
 * linked - so each field is one parameter, and a second token on the same field replaces the first.
 */
export function UrlPowerSearch({
  name,
  fields,
  label,
  placeholder,
  resultCount,
  width = 640,
}: {
  /** Identifies the config to Astryx; never shown. */
  name: string;
  fields: ReadonlyArray<UrlSearchField>;
  label: string;
  placeholder: string;
  resultCount?: number;
  /** Wider than a plain search box by default: tokens and the result count share the row. */
  width?: number | string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [filters, setFilters] = useState(() => filtersFromUrl(fields, new URLSearchParams(query)));

  // Back/forward and links change the URL under the component. Reset during render rather than in
  // an effect, which would need `fields` - a new array every render - as a dependency.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    setFilters(filtersFromUrl(fields, new URLSearchParams(query)));
  }

  function handleChange(next: ReadonlyArray<PowerSearchFilter>) {
    const latest = new Map<string, string>();
    for (const filter of next) {
      const value = "value" in filter.value ? filter.value.value : undefined;
      if (typeof value === "string" && value.trim()) latest.set(filter.field, value.trim());
      else latest.delete(filter.field);
    }
    const params = new URLSearchParams(query);
    for (const field of fields) {
      const value = latest.get(field.param);
      if (value) params.set(field.param, value);
      else params.delete(field.param);
    }
    params.delete("page");
    setFilters(filtersFromUrl(fields, params));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <PowerSearch
      config={toConfig(name, fields)}
      filters={filters}
      onChange={handleChange}
      label={label}
      placeholder={placeholder}
      startIcon={<Search />}
      resultCount={resultCount}
      tokenOverflowBehavior="unfocusedInline"
      // Astryx's table pulls itself up by its cell padding, which swallows the page's gap and leaves
      // the bar touching the column headers.
      style={{ width, maxWidth: "100%", marginBottom: "var(--spacing-4)" }}
    />
  );
}
