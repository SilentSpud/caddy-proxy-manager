"use client";

import { LogIn } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";

export interface SignInProvider {
  id: string;
  name: string;
  /** The one this instance is set up for. At most one, enforced by the settings key behind it. */
  isPrimary?: boolean;
}

/**
 * The enabled OAuth providers, primary first.
 *
 * The primary is marked by the button itself - `tonal`, the accent at a lower weight - rather than
 * by a badge beside it. A badge has to be read; the fill is seen. The solid accent stays with the
 * form's own submit, so the two never compete.
 */
export function SignInProviders({
  providers,
  pendingId,
  isDisabled,
  onSelect,
}: {
  providers: SignInProvider[];
  pendingId: string | null;
  isDisabled: boolean;
  onSelect: (providerId: string) => void;
}) {
  const t = useTranslations("auth.login");

  return (
    <VStack gap={2}>
      {providers.map((provider) => {
        const isPending = pendingId === provider.id;
        return (
          <Button
            key={provider.id}
            variant={provider.isPrimary ? "tonal" : "secondary"}
            width="100%"
            icon={<LogIn />}
            // From the catalog rather than built by concatenation: not every language puts the
            // provider last.
            label={
              isPending
                ? t("signingInWith", { provider: provider.name })
                : t("continueWith", { provider: provider.name })
            }
            isLoading={isPending}
            isDisabled={isDisabled}
            onClick={() => onSelect(provider.id)}
          />
        );
      })}
    </VStack>
  );
}
