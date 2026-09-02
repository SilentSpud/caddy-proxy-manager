"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { AUTOFILL_CURRENT_PASSWORD } from "@/src/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";

interface LinkAccountClientProps {
  provider: string;
  email: string;
  linkingId: string;
}

export default function LinkAccountClient({ provider, email, linkingId }: LinkAccountClientProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ linkingId, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to link account");
        setLoading(false);
        return;
      }

      await authClient.signIn.social({ provider, callbackURL: "/" });
    } catch {
      setError("An error occurred while linking your account");
      setLoading(false);
    }
  };

  const handleUsePassword = () => {
    router.push("/login");
  };

  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <Center minHeight="100vh" padding={4}>
      <Card width={400}>
        <VStack gap={4}>
          <VStack gap={1} hAlign="center">
            <Heading level={1}>Link Your Account</Heading>
            <Text type="body" size="sm" color="secondary">
              An account with <strong>{email}</strong> already exists
            </Text>
          </VStack>

          <Text type="body" size="sm" color="secondary" justify="center">
            Would you like to link your <strong>{providerName}</strong> account to your existing
            account? Enter your password to confirm.
          </Text>

          {error && <Banner status="error" title="Could not link account" description={error} />}

          <form onSubmit={handleLinkAccount}>
            <VStack gap={3}>
              <TextInput
                {...AUTOFILL_CURRENT_PASSWORD}
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                isRequired
                hasAutoFocus
                isDisabled={loading}
                width="100%"
              />

              <Button
                type="submit"
                label={loading ? "Linking Account…" : "Link Account"}
                isLoading={loading}
                isDisabled={loading}
                width="100%"
              />

              <Button
                type="button"
                variant="secondary"
                label="Sign in with Password Instead"
                onClick={handleUsePassword}
                isDisabled={loading}
                width="100%"
              />
            </VStack>
          </form>
        </VStack>
      </Card>
    </Center>
  );
}
