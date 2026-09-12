"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { AUTOFILL_CURRENT_PASSWORD } from "@/src/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";

interface LinkAccountClientProps {
  provider: string;
  email: string;
  linkingId: string;
}

/** One side of the link: a lettered mark, a name, and the address it answers to. */
function IdentityRow({
  mark,
  title,
  address,
  isRound = false,
  badge,
}: {
  mark: string;
  title: string;
  address: string;
  isRound?: boolean;
  badge?: ReactNode;
}) {
  return (
    <HStack gap={3} vAlign="center">
      <span
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          width: 30,
          height: 30,
          borderRadius: isRound ? 9999 : 8,
          background: "var(--color-background-pink)",
          color: "var(--color-text-pink)",
          fontWeight: 700,
        }}
      >
        {mark}
      </span>
      <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text type="body" weight="semibold" maxLines={1}>
          {title}
        </Text>
        <Text type="code" size="xsm" color="secondary" maxLines={1}>
          {address}
        </Text>
      </VStack>
      {badge}
    </HStack>
  );
}

export default function LinkAccountClient({ provider, email, linkingId }: LinkAccountClientProps) {
  const t = useTranslations("auth.linkAccount");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLinkAccount = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/link-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkingId, password, removePassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t("failed"));
        setLoading(false);
        return;
      }

      await authClient.signIn.social({ provider, callbackURL: "/" });
    } catch {
      setError(t("unexpectedError"));
      setLoading(false);
    }
  };

  const handleUsePassword = () => {
    router.push("/login");
  };

  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <Center minHeight="100vh" padding={4} className="cpm-auth-page">
      <VStack gap={3} width="100%" maxWidth={400}>
        <Heading level={1}>{t("heading")}</Heading>

        {/* What is about to be joined: the identity just signed in with, above the account it
            lands on, so the link reads as a sentence before anything is typed. */}
        <Card padding={4}>
          <VStack gap={2}>
            <IdentityRow
              mark={providerName.charAt(0)}
              title={providerName}
              address={email}
              badge={<Badge variant="info" label={t("newIdentity")} />}
            />
            <HStack gap={2} vAlign="center">
              <div style={{ flex: 1 }}>
                <Divider />
              </div>
              <Text type="label" size="3xs" color="accent">
                {t("linksTo")}
              </Text>
              <div style={{ flex: 1 }}>
                <Divider />
              </div>
            </HStack>
            <IdentityRow
              mark={email.charAt(0).toUpperCase()}
              title={email.split("@")[0]}
              address={email}
              isRound
            />
          </VStack>
        </Card>

        {error && <Banner status="error" title={t("errorTitle")} description={error} />}

        <form onSubmit={handleLinkAccount}>
          <Card padding={4}>
            <VStack gap={3}>
              <HStack justify="between" vAlign="center" gap={2}>
                <VStack gap={0}>
                  <Text type="body" weight="semibold">
                    {t("confirmTitle")}
                  </Text>
                  <Text type="body" size="xsm" color="secondary">
                    {t("confirmDescription")}
                  </Text>
                </VStack>
                <Icon icon={Lock} size="sm" color="secondary" />
              </HStack>

              <TextInput
                {...AUTOFILL_CURRENT_PASSWORD}
                label={t("password")}
                type="password"
                value={password}
                onChange={setPassword}
                placeholder={t("passwordPlaceholder")}
                isRequired
                hasAutoFocus
                isDisabled={loading}
                width="100%"
              />

              {/* Off by default: dropping the password is the one choice here that is hard to
                  undo, since only an admin can give it back. */}
              <CheckboxInput
                label={t("removePassword")}
                description={t("removePasswordDescription", { provider: providerName })}
                value={removePassword}
                onChange={setRemovePassword}
                isDisabled={loading}
              />

              <Button
                type="submit"
                label={loading ? t("submitPending") : t("submit")}
                isLoading={loading}
                isDisabled={loading}
                width="100%"
              />
            </VStack>
          </Card>
        </form>

        <Button
          type="button"
          variant="tonal"
          label={t("usePasswordInstead")}
          onClick={handleUsePassword}
          isDisabled={loading}
          width="100%"
        />
      </VStack>
    </Center>
  );
}
