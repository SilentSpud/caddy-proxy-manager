"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { HStack } from "@astryxdesign/core/Stack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { generatePassword } from "@/src/lib/password-generator";
import {
  AUTOFILL_NEW_PASSWORD,
  NATIVE_REQUIRED,
  nativeAttrs,
} from "@/src/components/ui/native-input-attrs";

interface GeneratedPasswordFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * Called with the generated password instead of `onChange` when set, for a field that has a
   * confirmation partner: filling one and leaving the other empty just blocks the form.
   */
  onGenerate?: (password: string) => void;
  htmlName?: string;
  description?: string;
  placeholder?: string;
  isRequired?: boolean;
  isOptional?: boolean;
  isDisabled?: boolean;
  /** Native constraint, where the field had one. Empty values are unaffected either way. */
  minLength?: number;
  width?: string;
  "data-testid"?: string;
}

/**
 * A password input with a generate button, for values the app chooses rather than values that have
 * to match something outside it — a ClickHouse password, not a Tailscale auth key.
 *
 * Reveal and copy come with it because they are what makes generating usable: a random string in a
 * masked field that nobody can read is only useful for a secret no human ever needs again, and most
 * of these are handed to someone. Both act on what is in the field, generated or typed.
 */
export function GeneratedPasswordField({
  label,
  value,
  onChange,
  onGenerate,
  htmlName,
  description,
  placeholder,
  isRequired,
  isOptional,
  isDisabled,
  minLength,
  width = "100%",
  "data-testid": testId,
}: GeneratedPasswordFieldProps) {
  const t = useTranslations("ui.passwordField");
  const [isRevealed, setIsRevealed] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const generate = () => {
    const password = generatePassword();
    // Reveal on generate: the point of generating is that the value is unknown, so leaving it
    // masked would mean the only way to see it is to reach for the toggle every time.
    setIsRevealed(true);
    (onGenerate ?? onChange)(password);
  };

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setHasCopied(true);
      // Not a toast: this sits inside dialogs and long forms where a corner toast is easy to miss,
      // and the tick is next to the thing it is about.
      setTimeout(() => setHasCopied(false), 2_000);
    } catch {
      // Clipboard access is denied outside a secure context and in some embedded webviews. The
      // value is revealed and selectable, so there is a way through without an error to explain.
    }
  };

  return (
    <HStack gap={2} vAlign="end" width={width}>
      <TextInput
        {...AUTOFILL_NEW_PASSWORD}
        {...(isRequired ? NATIVE_REQUIRED : {})}
        {...(minLength === undefined ? {} : nativeAttrs({ minLength }))}
        data-testid={testId}
        label={label}
        type={isRevealed ? "text" : "password"}
        htmlName={htmlName}
        description={description}
        placeholder={placeholder}
        isRequired={isRequired}
        isOptional={isOptional}
        isDisabled={isDisabled}
        value={value}
        onChange={onChange}
        width="100%"
      />
      <IconButton
        variant="secondary"
        label={t("generateLabel")}
        tooltip={t("generateTooltip")}
        icon={<Sparkles />}
        isDisabled={isDisabled}
        onClick={generate}
      />
      <IconButton
        variant="secondary"
        label={isRevealed ? t("hideLabel") : t("revealLabel")}
        tooltip={isRevealed ? t("hideLabel") : t("revealLabel")}
        icon={isRevealed ? <EyeOff /> : <Eye />}
        isDisabled={isDisabled || !value}
        onClick={() => setIsRevealed((shown) => !shown)}
      />
      <IconButton
        variant="secondary"
        label={hasCopied ? t("copiedLabel") : t("copyLabel")}
        tooltip={hasCopied ? t("copiedLabel") : t("copyLabel")}
        icon={hasCopied ? <Check /> : <Copy />}
        isDisabled={isDisabled || !value}
        onClick={copy}
      />
    </HStack>
  );
}
