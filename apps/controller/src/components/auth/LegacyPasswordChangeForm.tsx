"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import {
  AUTOFILL_CURRENT_PASSWORD,
  AUTOFILL_NEW_PASSWORD,
} from "@/components/ui/native-input-attrs";
import { passwordPolicyHint, passwordPolicyMessage } from "@/src/lib/password-policy-message";

export default function LegacyPasswordChangeForm() {
  const t = useTranslations();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordChange.mismatch"));
      return;
    }
    const policyError = passwordPolicyMessage(
      t,
      newPassword,
      t("passwordPolicy.subject.newPassword"),
    );
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword === currentPassword) {
      setError(t("auth.passwordChange.mustDiffer"));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? t("auth.passwordChange.failed"));
        return;
      }
      // The new hash is argon2id, so the dashboard gate no longer matches.
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("auth.passwordChange.failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Center minHeight="100vh" padding={4}>
      <Card width={400}>
        <form onSubmit={handleSubmit}>
          <VStack gap={4}>
            <VStack gap={1} hAlign="center">
              <Icon icon={ShieldAlert} size="lg" color="secondary" />
              <Heading level={1}>{t("auth.passwordChange.heading")}</Heading>
              <Text type="body" size="sm" color="secondary" justify="center">
                {t("auth.passwordChange.subtitle")}
              </Text>
            </VStack>

            {error && <Banner status="error" title={error} />}

            <VStack gap={3}>
              <TextInput
                {...AUTOFILL_CURRENT_PASSWORD}
                label={t("auth.passwordChange.currentPassword")}
                type="password"
                value={currentPassword}
                onChange={setCurrentPassword}
                isRequired
              />
              <TextInput
                {...AUTOFILL_NEW_PASSWORD}
                label={t("auth.passwordChange.newPassword")}
                type="password"
                value={newPassword}
                onChange={setNewPassword}
                description={passwordPolicyHint(t)}
                isRequired
              />
              <TextInput
                {...AUTOFILL_NEW_PASSWORD}
                label={t("auth.passwordChange.confirmPassword")}
                type="password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                isRequired
              />
            </VStack>

            <Button
              type="submit"
              label={t("auth.passwordChange.submit")}
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
            />
          </VStack>
        </form>
      </Card>
    </Center>
  );
}
