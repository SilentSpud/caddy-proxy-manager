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
import { useCaptchaStep } from "@/src/components/auth/useCaptchaStep";
import { type TwoFactorSubmission, TwoFactorStep } from "@/src/components/auth/TwoFactorStep";
import {
  AUTOFILL_CURRENT_PASSWORD,
  AUTOFILL_USERNAME,
  NO_SPELLCHECK,
} from "@/src/components/ui/native-input-attrs";
import { authClient } from "@/src/lib/auth-client";
import { formatAppVersion } from "@/src/lib/app-version";
import type { CaptchaWidgetConfig } from "@/src/lib/captcha/providers";
import { signInErrorMessage } from "@/src/lib/sign-in-error";
import { twoFactorError } from "@/src/lib/two-factor-error";

interface LoginClientProps {
  enabledProviders: SignInProvider[];
  /** False in OIDC-only mode: there are no local accounts to sign in with. */
  localLoginEnabled?: boolean;
  /** Display name from APP_NAME, so a rebranded instance is named consistently. */
  appName?: string;
  /** A refused single sign-on attempt, already put into words by the page. */
  initialError?: string | null;
  /** Solved on the username step before the password is asked for. Null when none is configured. */
  captcha?: CaptchaWidgetConfig | null;
  /** The page's CSP nonce, which Cap needs for the scripts it injects. */
  cspNonce?: string;
}

export default function LoginClient({
  enabledProviders = [],
  localLoginEnabled = true,
  appName = "Caddy Proxy Manager",
  initialError = null,
  captcha = null,
  cspNonce,
}: LoginClientProps) {
  const t = useTranslations("auth.login");
  const tErrors = useTranslations("auth.errors");
  const tApi = useTranslations("auth.apiErrors");
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(initialError);
  const [loginPending, setLoginPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Identifier first: the username is asked for on its own, and the password only once there is
  // a name to attach it to. Step one never checks whether that name exists - see below.
  const [onPasswordStep, setOnPasswordStep] = useState(false);
  // The password was right and the account wants a code. The challenge lives in Better Auth's
  // own short-lived cookie, so all this has to remember is that it was asked for.
  const [onCodeStep, setOnCodeStep] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const captchaStep = useCaptchaStep({ config: captcha, nonce: cspNonce, onError: setLoginError });

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
      data: { twoFactorRedirect?: boolean } | null;
      error: { status?: number; code?: string; message?: string } | null;
    }>;
    const signInUsername = (authClient.signIn as unknown as { username: SignInUsername }).username;
    const { data, error } = await signInUsername({ username: trimmedUsername, password });

    if (error?.code === "CAPTCHA_REQUIRED") {
      // The pass lapsed while the password was being typed. The widget comes back on this step,
      // with the password kept, so solving it and pressing Sign in again is all it takes.
      captchaStep.spent("expired");
      setLoginPending(false);
      return;
    }

    if (error) {
      // The attempt spent the pass, right password or not; the next one needs a new solve.
      captchaStep.spent();
      // By code, not Better Auth's `message`: that is English whatever the reader's language.
      setLoginError(signInErrorMessage(error, (key) => tErrors(key)));
      setLoginPending(false);
      // Keep the name on screen: the operator has to be able to tell a typo in it from a wrong
      // password, and sending them back to step one hides the evidence.
      setOnPasswordStep(true);
      return;
    }

    if (data?.twoFactorRedirect) {
      setPassword("");
      setOnCodeStep(true);
      setLoginPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  const startOver = () => {
    setOnCodeStep(false);
    setOnPasswordStep(false);
    setPassword("");
    captchaStep.spent();
  };

  const verifyCode = async ({ method, code, trustDevice }: TwoFactorSubmission) => {
    setLoginError(null);
    setLoginPending(true);
    const verify =
      method === "totp" ? authClient.twoFactor.verifyTotp : authClient.twoFactor.verifyBackupCode;
    const { error } = await verify({ code, trustDevice });
    if (error) {
      const refused = twoFactorError(error);
      setLoginError(tApi(refused.key));
      setLoginPending(false);
      if (refused.restart) startOver();
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
      if (!(await captchaStep.pass(trimmedUsername))) return;
      // A password manager fills both fields at once even though only one is on screen, so a
      // filled password means there is nothing to ask for: submit rather than showing a step whose
      // only field is already complete.
      if (!password) {
        setOnPasswordStep(true);
        return;
      }
    } else {
      if (!password) {
        setLoginError(t("passwordRequired"));
        return;
      }
      // After a failed attempt: the widget is back on this step, and this redeems it.
      if (!(await captchaStep.pass(trimmedUsername))) return;
    }

    await signIn(trimmedUsername);
  };

  const handleOAuthSignIn = async (providerId: string) => {
    setLoginError(null);
    setOauthPending(providerId);
    try {
      // Without errorCallbackURL a refused sign-in lands on Better Auth's bare error page; back
      // here, the page can say what happened and what to do instead.
      await authClient.signIn.social({
        provider: providerId,
        callbackURL: "/",
        errorCallbackURL: "/login",
      });
    } catch {
      setLoginError(t("oauthFailed"));
      setOauthPending(null);
    }
  };

  const disabled = loginPending || captchaStep.pending || !!oauthPending;
  const hasProviders = enabledProviders.length > 0;

  const subtitle = !localLoginEnabled
    ? t("subtitleSsoOnly")
    : onCodeStep
      ? t("subtitleCode")
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

          {localLoginEnabled && onCodeStep && (
            <TwoFactorStep pending={loginPending} onSubmit={verifyCode} onCancel={startOver} />
          )}

          {localLoginEnabled && !onCodeStep && (
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
                        captchaStep.spent();
                      }}
                    />
                  ) : (
                    <>
                      <TextInput
                        {...AUTOFILL_USERNAME}
                        {...NO_SPELLCHECK}
                        label={t("username")}
                        htmlName="username"
                        value={username}
                        onChange={setUsername}
                        isRequired
                        hasAutoFocus
                        isDisabled={disabled}
                        width="100%"
                      />
                      {/* A pass is for one name only, so going back for another means a new solve. */}
                      {captchaStep.widget}
                    </>
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
                  {/* Back after a failed attempt, which spent the last solve. */}
                  {onPasswordStep && captchaStep.widget}
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
                    isLoading={loginPending || captchaStep.pending}
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
