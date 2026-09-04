"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { LogIn } from "lucide-react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import {
  AUTOFILL_CURRENT_PASSWORD,
  AUTOFILL_USERNAME,
} from "@/src/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";
import { formatAppVersion } from "@/src/lib/app-version";

interface LoginClientProps {
  enabledProviders: Array<{ id: string; name: string }>;
  /** False in OIDC-only mode: there are no local accounts to sign in with. */
  localLoginEnabled?: boolean;
  /** Display name from APP_NAME, so a rebranded instance is named consistently. */
  appName?: string;
}

export default function LoginClient({
  enabledProviders = [],
  localLoginEnabled = true,
  appName = "Caddy Proxy Manager",
}: LoginClientProps) {
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setLoginPending(true);

    // Read from state, not FormData: Astryx withholds an input's `name` while
    // it is disabled, and these fields disable themselves once a sign-in is
    // pending, so a FormData read here would be racing that re-render.
    const trimmedUsername = username.trim();

    if (!trimmedUsername || !password) {
      setLoginError("Username and password are required.");
      setLoginPending(false);
      return;
    }

    // `signIn.username` is added at runtime by the usernameClient plugin. The plugin's
    // $InferServerPlugin types fail to merge into the client signature in some environments,
    // so we cast a stable shape here.
    type SignInUsername = (input: { username: string; password: string }) => Promise<{
      error: { status?: number; message?: string } | null;
    }>;
    const signInUsername = (authClient.signIn as unknown as { username: SignInUsername }).username;
    const { error } = await signInUsername({ username: trimmedUsername, password });

    if (error) {
      let message: string | null = null;
      if (error.status === 429) {
        message = error.message || "Too many login attempts. Try again in a few minutes.";
      } else if (error.message) {
        message = error.message;
      }
      setLoginError(message ?? "Invalid username or password.");
      setLoginPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  const handleOAuthSignIn = async (providerId: string) => {
    setLoginError(null);
    setOauthPending(providerId);
    try {
      await authClient.signIn.social({ provider: providerId, callbackURL: "/" });
    } catch {
      setLoginError("Failed to sign in with OAuth");
      setOauthPending(null);
    }
  };

  const disabled = loginPending || !!oauthPending;

  return (
    <Center minHeight="100vh" padding={4}>
      <Card width={400}>
        <VStack gap={4}>
          <VStack gap={1} hAlign="center">
            <Heading level={1}>{appName}</Heading>
            <Text type="body" size="sm" color="secondary">
              {!localLoginEnabled
                ? "Sign in with single sign-on"
                : enabledProviders.length > 0
                  ? "Sign in to your account"
                  : "Sign in with your credentials"}
            </Text>
          </VStack>

          {loginError && (
            <Banner status="error" title="Could not sign in" description={loginError} />
          )}

          {enabledProviders.length > 0 && (
            <>
              <VStack gap={2}>
                {enabledProviders.map((provider) => {
                  const isPending = oauthPending === provider.id;
                  return (
                    <Button
                      key={provider.id}
                      variant="secondary"
                      width="100%"
                      icon={<LogIn />}
                      label={
                        isPending
                          ? `Signing in with ${provider.name}…`
                          : `Continue with ${provider.name}`
                      }
                      isLoading={isPending}
                      isDisabled={disabled}
                      onClick={() => handleOAuthSignIn(provider.id)}
                    />
                  );
                })}
              </VStack>
              {localLoginEnabled && <Divider label="Or sign in with credentials" />}
            </>
          )}

          {!localLoginEnabled && enabledProviders.length === 0 && (
            <Banner
              status="error"
              title="No sign-in method available"
              description="Single sign-on is the only way to sign in, but no provider is configured. Configure one with the OAUTH_* environment variables."
            />
          )}

          {localLoginEnabled && (
            <form onSubmit={handleSignIn}>
              <VStack gap={3}>
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
                  label={loginPending ? "Signing in…" : "Sign in"}
                  isLoading={loginPending}
                  isDisabled={disabled}
                  width="100%"
                />
              </VStack>
            </form>
          )}

          <VStack hAlign="center">
            <Text type="body" size="xsm" color="secondary">
              {formatAppVersion()}
            </Text>
          </VStack>
        </VStack>
      </Card>
    </Center>
  );
}
