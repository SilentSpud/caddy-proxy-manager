"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
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

/** The app's search box. TextInput owns the icon slot and the clear affordance. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  width = 280,
  hasAutoFocus,
}: SearchFieldProps) {
  const t = useTranslations("ui");
  return (
    <TextInput
      label={label ?? t("searchLabel")}
      isLabelHidden
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder ?? t("searchPlaceholder")}
      startIcon={<Search />}
      hasClear
      width={width}
      hasAutoFocus={hasAutoFocus}
    />
  );
}
