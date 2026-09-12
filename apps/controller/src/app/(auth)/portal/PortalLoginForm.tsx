"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
import { SignInIdentity } from "@/src/components/auth/SignInIdentity";
import { type SignInProvider, SignInProviders } from "@/src/components/auth/SignInProviders";
import { AUTOFILL_CURRENT_PASSWORD, AUTOFILL_USERNAME } from "@/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";
import { useTranslations } from "next-intl";

interface PortalLoginFormProps {
  rid: string;
  hasRedirect: boolean;
  targetDomain: string;
  enabledProviders?: SignInProvider[];
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
  const t = useTranslations("auth");
  const tl = useTranslations("auth.login");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // The same two steps as /login, for the same reason: the password is only asked for once there
  // is a name to attach it to.
  const [onPasswordStep, setOnPasswordStep] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // See LoginClient: focusing from the handler races React's commit, so the field is focused from
  // the effect that follows the step change.
  useEffect(() => {
    if (onPasswordStep) {
      passwordRef.current?.focus();
    }
  }, [onPasswordStep]);

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
            setError(data.error ?? t("authorizeFailed"));
            setPending(false);
          }
        })
        .catch(() => {
          setError(t("unexpectedError"));
          setPending(false);
        });
    }
    // `t` is stable for a given locale, so it does not re-run this on every render.
  }, [existingSession, rid, t]);

  const submitCredentials = async (trimmedUsername: string) => {
    setPending(true);
    try {
      const response = await fetch("/api/forward-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUsername, password, rid }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? t("login.failed"));
        setPending(false);
        // Stay on the password step so the name that failed is still readable.
        setOnPasswordStep(true);
        return;
      }

      window.location.href = data.redirectTo;
    } catch {
      setError(t("unexpectedErrorTryAgain"));
      setPending(false);
      setOnPasswordStep(true);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Read from state, not FormData: Astryx withholds an input's `name` while it is disabled, and
    // these fields disable themselves once a sign-in is pending.
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError(tl("usernameRequired"));
      return;
    }

    // Step one advances whether or not the account exists - see LoginClient for why.
    if (!onPasswordStep) {
      if (!password) {
        setOnPasswordStep(true);
        return;
      }
    } else if (!password) {
      setError(tl("passwordRequired"));
      return;
    }

    await submitCredentials(trimmedUsername);
  };

  const handleOAuthSignIn = (providerId: string) => {
    setError(null);
    setOauthPending(providerId);
    // Redirect back to this portal page after OAuth, with the rid param preserved.
    // The rid is an opaque server-side ID - the actual redirect URI is never in the URL.
    const callbackUrl = `/portal?rid=${encodeURIComponent(rid)}`;
    authClient.signIn.social({ provider: providerId, callbackURL: callbackUrl });
  };

  const disabled = pending || !!oauthPending;
  const hasProviders = enabledProviders.length > 0;

  if (!hasRedirect) {
    return (
      <PortalCard
        title={t("authenticationRequired")}
        description={t("missingDestinationDescription")}
        hasShield={false}
      />
    );
  }

  // If we have a session and are auto-redirecting, show a loading state
  if (existingSession && pending && !error) {
    return (
      <PortalCard
        title={t("authorizing")}
        description={t("signingInAs", {
          account: existingSession.name ?? existingSession.email ?? "",
        })}
      />
    );
  }

  const providerList = (
    <SignInProviders
      providers={enabledProviders}
      pendingId={oauthPending}
      isDisabled={disabled}
      onSelect={handleOAuthSignIn}
    />
  );

  return (
    <PortalCard
      title={t("authenticationRequired")}
      description={
        targetDomain
          ? t.rich("signInToAccess", {
              host: targetDomain,
              host_: (chunks) => <strong>{chunks}</strong>,
            })
          : t("signInToContinue")
      }
    >
      {error && <Banner status="error" title={t("couldNotSignIn")} description={error} />}

      {!localLoginEnabled && !hasProviders && (
        <Banner
          status="error"
          title={t("signInUnavailableTitle")}
          description={t("missingProviderDescription")}
        />
      )}

      {!localLoginEnabled && hasProviders && providerList}

      {localLoginEnabled && (
        <>
          {/* One form across both steps - see LoginClient for why the password field stays
              mounted while it is hidden. */}
          <form onSubmit={handleSubmit}>
            <VStack gap={3}>
              {onPasswordStep ? (
                <SignInIdentity
                  username={username.trim()}
                  isDisabled={disabled}
                  onChange={() => {
                    setOnPasswordStep(false);
                    setPassword("");
                    setError(null);
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
                  pending
                    ? t("login.submitPending")
                    : onPasswordStep
                      ? t("login.submit")
                      : tl("continueStep")
                }
                isLoading={pending}
                isDisabled={disabled}
                width="100%"
              />
            </VStack>
          </form>

          {hasProviders && (
            <>
              <Divider label={tl("ssoDivider")} />
              {providerList}
            </>
          )}
        </>
      )}
    </PortalCard>
  );
}
