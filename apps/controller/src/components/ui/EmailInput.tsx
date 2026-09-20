"use client";

import { type ComponentProps, type FocusEvent, useState } from "react";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useTranslations } from "next-intl";
import { type EmailDomain, isEmailAddress } from "@/src/lib/email-address";
import { NO_SPELLCHECK } from "./native-input-attrs";

type EmailInputProps = Omit<ComponentProps<typeof TextInput>, "type" | "status" | "value"> & {
  value: string;
  /** `public` for an address a third party must accept, such as the ACME contact. */
  domain?: EmailDomain;
};

/**
 * A text input that says when what was typed cannot be an email address.
 *
 * Checked from the first time focus leaves the field, so a half-typed address is not flagged while
 * it is still being written; after that the error clears as soon as the value is fixed. The save
 * applies the same rule, so this is a convenience rather than the gate.
 */
export function EmailInput({ domain = "any", value, ...props }: EmailInputProps) {
  const t = useTranslations("errors");
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const invalid = touched && trimmed !== "" && !isEmailAddress(trimmed, domain);

  // TextInput does not type onBlur but forwards it to the <input>, as with native-input-attrs. A
  // handler the consumer passed the same way is chained rather than replaced.
  const consumerOnBlur = (props as Record<string, unknown>).onBlur;
  const onBlur = {
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      setTouched(true);
      if (typeof consumerOnBlur === "function") consumerOnBlur(event);
    },
  } as Record<string, unknown>;

  return (
    <TextInput
      {...NO_SPELLCHECK}
      {...props}
      {...onBlur}
      type="email"
      value={value}
      status={invalid ? { type: "error", message: t("emailInvalid") } : undefined}
    />
  );
}
