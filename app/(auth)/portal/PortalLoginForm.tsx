"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { AUTOFILL_CURRENT_PASSWORD, AUTOFILL_USERNAME } from "@/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";

interface PortalLoginFormProps {
  rid: string;
  hasRedirect: boolean;
  targetDomain: string;
  enabledProviders?: Array<{ id: string; name: string }>;
  /** False in OIDC-only mode: there are no local accounts to sign in with. */
  localLoginEnabled?: boolean;
  existingSession?: { userId: string; name: string | null; email: string | null } | null;
}

/** The portal is always one centred card; only its contents vary. */
function PortalCard({
  title,
  description,
  hasShield = true,
  children,
}: {
  title: string;
  description: ReactNode;
  hasShield?: boolean;
  children?: ReactNode;
}) {
  return (
    <Center minHeight="100vh" padding={4}>
      <Card width={400}>
        <VStack gap={4}>
          <VStack gap={1} hAlign="center">
            {hasShield && <Icon icon={Shield} size="lg" color="secondary" />}
            <Heading level={1}>{title}</Heading>
            <Text type="body" size="sm" color="secondary" justify="center">
              {description}
            </Text>
          </VStack>
          {children}
        </VStack>
      </Card>
    </Center>
  );
}

export default function PortalLoginForm({
  rid,
  hasRedirect,
  targetDomain,
  enabledProviders = [],
  localLoginEnabled = true,
  existingSession,
}: PortalLoginFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // If user already has a NextAuth session (e.g. from OAuth), auto-create forward auth session
  useEffect(() => {
    if (existingSession && rid) {
      setPending(true);
      fetch("/api/forward-auth/session-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rid }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.redirectTo) {
            window.location.href = data.redirectTo;
          } else {
            setError(data.error ?? "Failed to authorize access.");
            setPending(false);
          }
        })
        .catch(() => {
          setError("An unexpected error occurred.");
          setPending(false);
        });
    }
  }, [existingSession, rid]);

  const handleCredentialSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    // Read from state, not FormData: Astryx withholds an input's `name` while it is disabled, and
    // these fields disable themselves once a sign-in is pending.
    const trimmedUsername = username.trim();

    if (!trimmedUsername || !password) {
      setError("Username and password are required.");
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/forward-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUsername, password, rid }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Login failed.");
        setPending(false);
        return;
      }

      window.location.href = data.redirectTo;
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setPending(false);
    }
  };

  const handleOAuthSignIn = (providerId: string) => {
    setError(null);
    setOauthPending(providerId);
    // Redirect back to this portal page after OAuth, with the rid param preserved.
    // The rid is an opaque server-side ID — the actual redirect URI is never in the URL.
    const callbackUrl = `/portal?rid=${encodeURIComponent(rid)}`;
    authClient.signIn.social({ provider: providerId, callbackURL: callbackUrl });
  };

  const disabled = pending || !!oauthPending;

  if (!hasRedirect) {
    return (
      <PortalCard
        title="Authentication Required"
        description="No redirect destination specified."
        hasShield={false}
      />
    );
  }

  // If we have a session and are auto-redirecting, show a loading state
  if (existingSession && pending && !error) {
    return (
      <PortalCard
        title="Authorizing..."
        description={`Signing in as ${existingSession.name ?? existingSession.email}`}
      />
    );
  }

  return (
    <PortalCard
      title="Authentication Required"
      description={
        targetDomain ? (
          <>
            Sign in to access <strong>{targetDomain}</strong>
          </>
        ) : (
          "Sign in to continue"
        )
      }
    >
      {error && <Banner status="error" title="Could not sign in" description={error} />}

      {enabledProviders.length > 0 && (
        <>
          <VStack gap={2}>
            {enabledProviders.map((provider) => (
              <Button
                key={provider.id}
                variant="secondary"
                width="100%"
                label={`Sign in with ${provider.name}`}
                isLoading={oauthPending === provider.id}
                isDisabled={disabled}
                onClick={() => handleOAuthSignIn(provider.id)}
              />
            ))}
          </VStack>
          {localLoginEnabled && <Divider label="or" />}
        </>
      )}

      {!localLoginEnabled && enabledProviders.length === 0 && (
        <Banner
          status="error"
          title="No sign-in method available"
          description="Single sign-on is the only way to sign in, but no provider is configured."
        />
      )}

      {localLoginEnabled && (
        <form onSubmit={handleCredentialSubmit}>
          <VStack gap={4}>
            <TextInput
              {...AUTOFILL_USERNAME}
              label="Username"
              htmlName="username"
              value={username}
              onChange={setUsername}
              isRequired
              hasAutoFocus={enabledProviders.length === 0}
              isDisabled={disabled}
              width="100%"
            />
            <TextInput
              {...AUTOFILL_CURRENT_PASSWORD}
              label="Password"
              type="password"
              htmlName="password"
              value={password}
              onChange={setPassword}
              isRequired
              isDisabled={disabled}
              width="100%"
            />
            <Button
              type="submit"
              label={pending ? "Signing in..." : "Sign in"}
              isLoading={pending}
              isDisabled={disabled}
              width="100%"
            />
          </VStack>
        </form>
      )}
    </PortalCard>
  );
}
