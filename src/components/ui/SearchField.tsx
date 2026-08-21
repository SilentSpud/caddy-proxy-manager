"use client";

import { Search } from "lucide-react";
import { TextInput } from "@astryxdesign/core/TextInput";

type SearchFieldProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Label for screen readers; the field shows only the icon and placeholder. */
  label?: string;
  width?: number | string;
  hasAutoFocus?: boolean;
};

/**
 * The app's search box. TextInput owns the icon slot and the clear affordance,
 * so this no longer positions an icon over a padded input by hand.
 */
export function SearchField({
  value,
  onChange,
  placeholder = "Search...",
  label = "Search",
  width = 280,
  hasAutoFocus,
}: SearchFieldProps) {
  return (
    <TextInput
      label={label}
      isLabelHidden
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      startIcon={<Search />}
      hasClear
      width={width}
      hasAutoFocus={hasAutoFocus}
    />
  );
}
