"use client";

import { ChevronDown } from "lucide-react";

/**
 * A phone filter: a pill that names the current value and opens a sheet to change it.
 *
 * Stands in for a segmented control or a select on a narrow screen, where six segments do not fit
 * and a native select hides the other choices until it is tapped anyway. `isActive` fills it with
 * the accent, for a filter that narrows the page away from its default.
 */
export function FilterChip({
  label,
  isActive = false,
  onClick,
  "aria-label": ariaLabel,
}: {
  label: string;
  isActive?: boolean;
  onClick: () => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      className="cpm-chip"
      data-active={isActive || undefined}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </button>
  );
}
