"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { SignInIdentity } from "@/src/components/auth/SignInIdentity";
import { type SignInProvider, SignInProviders } from "@/src/components/auth/SignInProviders";
import {
  AUTOFILL_CURRENT_PASSWORD,
  AUTOFILL_USERNAME,
} from "@/src/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";
import { formatAppVersion } from "@/src/lib/app-version";

interface LoginClientProps {
  enabledProviders: SignInProvider[];
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
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Identifier first: the username is asked for on its own, and the password only once there is
  // a name to attach it to. Step one never checks whether that name exists - see below.
  const [onPasswordStep, setOnPasswordStep] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // After the commit that unhides the field, not from the handler that asked for it: `focus()` on
  // an element still inside a `hidden` subtree is a no-op, and a handler - or a rAF scheduled from
  // one - can run before React has removed the attribute.
  useEffect(() => {
    if (onPasswordStep) {
      passwordRef.current?.focus();
    }
  }, [onPasswordStep]);

  const signIn = async (trimmedUsername: string) => {
    setLoginPending(true);

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
        message = error.message || t("rateLimited");
      } else if (error.message) {
        message = error.message;
      }
      setLoginError(message ?? t("invalidCredentials"));
      setLoginPending(false);
      // Keep the name on screen: the operator has to be able to tell a typo in it from a wrong
      // password, and sending them back to step one hides the evidence.
      setOnPasswordStep(true);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);

    // Read from state, not FormData: Astryx withholds an input's `name` while it is disabled, and
    // these fields disable themselves once a sign-in is pending, so a FormData read here would be
    // racing that re-render.
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setLoginError(t("usernameRequired"));
      return;
    }

    // Step one advances for any username, real or not. Resolving it - to say the account is
    // unknown, or to send it to the provider it belongs to - would answer "does this name exist?"
    // for anyone who asks, which the single-screen form never did.
    if (!onPasswordStep) {
      // A password manager fills both fields at once even though only one is on screen, so a
      // filled password means there is nothing to ask for: submit rather than showing a step whose
      // only field is already complete.
      if (!password) {
        setOnPasswordStep(true);
        return;
      }
    } else if (!password) {
      setLoginError(t("passwordRequired"));
      return;
    }

    await signIn(trimmedUsername);
  };

  const handleOAuthSignIn = async (providerId: string) => {
    setLoginError(null);
    setOauthPending(providerId);
    try {
      await authClient.signIn.social({ provider: providerId, callbackURL: "/" });
    } catch {
      setLoginError(t("oauthFailed"));
      setOauthPending(null);
    }
  };

  const disabled = loginPending || !!oauthPending;
  const hasProviders = enabledProviders.length > 0;

  const subtitle = !localLoginEnabled
    ? t("subtitleSsoOnly")
    : onPasswordStep
      ? t("subtitlePassword")
      : t("subtitleIdentify");

  const providerList = (
    <SignInProviders
      providers={enabledProviders}
      pendingId={oauthPending}
      isDisabled={disabled}
      onSelect={handleOAuthSignIn}
    />
  );

  return (
    <Center minHeight="100vh" padding={4}>
      <Card width={400}>
        <VStack gap={4}>
          <VStack gap={1} hAlign="center">
            <Heading level={1}>{appName}</Heading>
            <Text type="body" size="sm" color="secondary">
              {subtitle}
            </Text>
          </VStack>

          {loginError && <Banner status="error" title={t("errorTitle")} description={loginError} />}

          {!localLoginEnabled && !hasProviders && (
            <Banner
              status="error"
              title={t("noMethodTitle")}
              description={t("noMethodDescription")}
            />
          )}

          {/* SSO only: there is no username to enter first, so the providers are the whole form. */}
          {!localLoginEnabled && hasProviders && providerList}

          {localLoginEnabled && (
            <>
              {/*
                One form across both steps, with the password field mounted throughout and hidden
                until it is asked for. Splitting it into two forms is what costs identifier-first
                its password managers: they fill a username and a password together, and a password
                field that is not in the document yet cannot be filled.
              */}
              <form onSubmit={handleSubmit}>
                <VStack gap={3}>
                  {onPasswordStep ? (
                    <SignInIdentity
                      username={username.trim()}
                      isDisabled={disabled}
                      onChange={() => {
                        setOnPasswordStep(false);
                        setPassword("");
                        setLoginError(null);
                      }}
                    />
                  ) : (
                    <TextInput
                      {...AUTOFILL_USERNAME}
                      label={t("username")}
                      htmlName="username"
                      value={username}
                      onChange={setUsername}
                      isRequired
                      hasAutoFocus
                      isDisabled={disabled}
                      width="100%"
                    />
                  )}
                  <div hidden={!onPasswordStep}>
                    <TextInput
                      {...AUTOFILL_CURRENT_PASSWORD}
                      ref={passwordRef}
                      label={t("password")}
                      type="password"
                      htmlName="password"
                      value={password}
                      onChange={setPassword}
                      isRequired
                      isDisabled={disabled}
                      width="100%"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    label={
                      loginPending
                        ? t("submitPending")
                        : onPasswordStep
                          ? t("submit")
                          : t("continueStep")
                    }
                    isLoading={loginPending}
                    isDisabled={disabled}
                    width="100%"
                  />
                </VStack>
              </form>

              {hasProviders && (
                <>
                  {/* The credentials form now comes first, so the divider introduces the
                      providers rather than the form it used to sit above. */}
                  <Divider label={t("ssoDivider")} />
                  {providerList}
                </>
              )}
            </>
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
