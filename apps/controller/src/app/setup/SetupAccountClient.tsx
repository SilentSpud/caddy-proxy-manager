"use client";

/**
 * The first two decisions of setup: what this instance is, and how anyone signs in to it.
 *
 * The role question comes first and is not persisted anywhere — an agent has no database of its
 * own to record it in, and answering "agent" ends the flow with a pointer to its own instructions
 * rather than continuing. Only a controller has anything further to configure here.
 */
import { useActionState, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { PASSWORD_POLICY_HINT } from "@/src/lib/password-policy";
import { FormCard, SaveButton, StatusAlert } from "@/src/components/ui/FormLayout";
import { AUTOFILL_NEW_PASSWORD, AUTOFILL_USERNAME } from "@/src/components/ui/native-input-attrs";
import { configureFirstOAuthProvider, createFirstAdmin } from "./actions";

const AGENT_DOCS = "https://github.com/SilentSpud/caddy-proxy-manager/wiki/Agent-setup";

type Role = "controller" | "agent";
type Method = "local" | "oauth";

export default function SetupAccountClient() {
  const [role, setRole] = useState<Role>("controller");
  const [method, setMethod] = useState<Method>("local");

  // Astryx text inputs are controlled, so the form's values live here and reach the server action
  // through each field's htmlName.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [providerName, setProviderName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const [adminState, submitAdmin] = useActionState(createFirstAdmin, { error: null });
  const [oauthState, submitOAuth] = useActionState(configureFirstOAuthProvider, { error: null });

  return (
    <Center>
      <VStack gap={5} padding={5}>
        <VStack gap={2}>
          <Heading level={1}>Set up Caddy Proxy Manager</Heading>
          <Text color="secondary">
            Nothing can sign in to this instance yet. Create the first administrator, or point it at
            an identity provider.
          </Text>
        </VStack>

        <FormCard title="What is this instance?">
          <VStack gap={3}>
            <SegmentedControl
              label="Instance role"
              value={role}
              onChange={(value) => setRole(value as Role)}
              layout="fill"
            >
              <SegmentedControlItem value="controller" label="Controller" />
              <SegmentedControlItem value="agent" label="Agent" />
            </SegmentedControl>
            <Text size="sm" color="secondary">
              The controller is the dashboard and its database. An agent manages Caddy on one host
              and is configured from the controller once this is finished.
            </Text>
          </VStack>
        </FormCard>

        {role === "agent" ? (
          <Card padding={4}>
            <VStack gap={3}>
              <Banner
                status="info"
                title="Agents are set up separately"
                description="An agent no longer shares this application's setup. Finish the controller first, then pair the agent to it from Settings."
              />
              <Link href={AGENT_DOCS}>Agent setup instructions</Link>
              <Button
                size="sm"
                variant="secondary"
                label="Back to controller setup"
                onClick={() => setRole("controller")}
              />
            </VStack>
          </Card>
        ) : (
          <>
            <FormCard title="How will you sign in?">
              <SegmentedControl
                label="Sign-in method"
                value={method}
                onChange={(value) => setMethod(value as Method)}
                layout="fill"
              >
                <SegmentedControlItem value="local" label="Administrator account" />
                <SegmentedControlItem value="oauth" label="OAuth provider" />
              </SegmentedControl>
            </FormCard>

            {method === "local" ? (
              <form action={submitAdmin}>
                <FormCard title="Administrator account">
                  <VStack gap={3}>
                    {adminState.error && <StatusAlert message={adminState.error} success={false} />}
                    <TextInput
                      {...AUTOFILL_USERNAME}
                      label="Username"
                      htmlName="username"
                      value={username}
                      onChange={setUsername}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      {...AUTOFILL_NEW_PASSWORD}
                      label="Password"
                      htmlName="password"
                      type="password"
                      description={PASSWORD_POLICY_HINT}
                      value={password}
                      onChange={setPassword}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      {...AUTOFILL_NEW_PASSWORD}
                      label="Confirm password"
                      htmlName="passwordConfirmation"
                      type="password"
                      value={passwordConfirmation}
                      onChange={setPasswordConfirmation}
                      isRequired
                      width="100%"
                    />
                    <SaveButton label="Create account and sign in" />
                  </VStack>
                </FormCard>
              </form>
            ) : (
              <form action={submitOAuth}>
                <FormCard title="OAuth provider">
                  <VStack gap={3}>
                    {oauthState.error && <StatusAlert message={oauthState.error} success={false} />}
                    <Banner
                      status="info"
                      title="Register the redirect URI first"
                      description="Your provider needs to allow this instance's /api/auth/callback/oauth2 address, or the sign-in on the next screen will fail."
                    />
                    <TextInput
                      label="Display name"
                      htmlName="providerName"
                      description="Shown on the sign-in button, e.g. Authentik or Keycloak."
                      value={providerName}
                      onChange={setProviderName}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      label="Issuer URL"
                      htmlName="issuer"
                      description="The OIDC discovery URL."
                      value={issuer}
                      onChange={setIssuer}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      label="Client ID"
                      htmlName="clientId"
                      value={clientId}
                      onChange={setClientId}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      label="Client secret"
                      htmlName="clientSecret"
                      type="password"
                      value={clientSecret}
                      onChange={setClientSecret}
                      isRequired
                      width="100%"
                    />
                    <SaveButton label="Save provider and sign in" />
                  </VStack>
                </FormCard>
              </form>
            )}
          </>
        )}
      </VStack>
    </Center>
  );
}
