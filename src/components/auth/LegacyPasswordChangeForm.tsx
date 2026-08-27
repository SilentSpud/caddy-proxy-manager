"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
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
import { PASSWORD_POLICY_HINT, passwordPolicyError } from "@/src/lib/password-policy";

export default function LegacyPasswordChangeForm() {
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
      setError("New passwords do not match");
      return;
    }
    const policyError = passwordPolicyError(newPassword, "New password");
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password");
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
        setError(data.error ?? "Failed to change password");
        return;
      }
      // The new hash is argon2id, so the dashboard gate no longer matches.
      router.replace("/");
      router.refresh();
    } catch {
      setError("Failed to change password");
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
              <Heading level={1}>Update your password</Heading>
              <Text type="body" size="sm" color="secondary" justify="center">
                Your password is stored with an older algorithm. Choose a new one to continue.
              </Text>
            </VStack>

            {error && <Banner status="error" title={error} />}

            <VStack gap={3}>
              <TextInput
                {...AUTOFILL_CURRENT_PASSWORD}
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={setCurrentPassword}
                isRequired
              />
              <TextInput
                {...AUTOFILL_NEW_PASSWORD}
                label="New Password"
                type="password"
                value={newPassword}
                onChange={setNewPassword}
                description={PASSWORD_POLICY_HINT}
                isRequired
              />
              <TextInput
                {...AUTOFILL_NEW_PASSWORD}
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                isRequired
              />
            </VStack>

            <Button
              type="submit"
              label="Update Password"
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
            />
          </VStack>
        </form>
      </Card>
    </Center>
  );
}
