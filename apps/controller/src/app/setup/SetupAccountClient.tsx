"use client";

/**
 * The first two decisions of setup: what this instance is, and how anyone signs in to it.
 *
 * The role question comes first and is not persisted anywhere - an agent has no database of its
 * own to record it in, and answering "agent" ends the flow with a pointer to its own instructions
 * rather than continuing. Only a controller has anything further to configure here.
 *
 * `migratedFrom` is set when a migration has just run and chose not to bring the old accounts. The
 * page is otherwise identical to a fresh install's, which would leave the operator reading "nothing
 * can sign in to this instance yet" and concluding their migration had failed.
 */
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
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
import { passwordPolicyHint } from "@/src/lib/password-policy-message";
import { FormCard, SaveButton, StatusAlert } from "@/src/components/ui/FormLayout";
import { SetupSteps } from "@/src/components/ui/SetupSteps";
import { AUTOFILL_NEW_PASSWORD, AUTOFILL_USERNAME } from "@/src/components/ui/native-input-attrs";
import { configureFirstOAuthProvider, createFirstAdmin } from "./actions";
import { GeneratedPasswordField } from "@/src/components/ui/GeneratedPasswordField";

const AGENT_DOCS = "https://github.com/SilentSpud/caddy-proxy-manager/wiki/Agent-setup";

type Role = "controller" | "agent";
type Method = "local" | "oauth";

export default function SetupAccountClient({
  migratedFrom,
  hasMigrateStep,
}: {
  migratedFrom?: string | null;
  hasMigrateStep: boolean;
}) {
  const t = useTranslations();
  const ta = useTranslations("setup.account");
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
        <SetupSteps stage="account" hasMigrateStep={hasMigrateStep} />
        <VStack gap={2}>
          <Heading level={1}>{ta("heading")}</Heading>
          <Text color="secondary">{ta("subtitle")}</Text>
        </VStack>

        {migratedFrom && (
          <Banner
            status="info"
            title={ta("migratedTitle")}
            description={ta("migratedDescription", { source: migratedFrom })}
          />
        )}

        <FormCard title={ta("roleCardTitle")}>
          <VStack gap={3}>
            <SegmentedControl
              label={ta("roleLabel")}
              value={role}
              onChange={(value) => setRole(value as Role)}
              layout="fill"
            >
              <SegmentedControlItem value="controller" label={ta("roleController")} />
              <SegmentedControlItem value="agent" label={ta("roleAgent")} />
            </SegmentedControl>
            <Text size="sm" color="secondary">
              {ta("roleHelp")}
            </Text>
          </VStack>
        </FormCard>

        {role === "agent" ? (
          <Card padding={4}>
            <VStack gap={3}>
              <Banner status="info" title={ta("agentTitle")} description={ta("agentDescription")} />
              <Link href={AGENT_DOCS}>{ta("agentDocsLink")}</Link>
              <Button
                size="sm"
                variant="secondary"
                label={ta("backToController")}
                onClick={() => setRole("controller")}
              />
            </VStack>
          </Card>
        ) : (
          <>
            <FormCard title={ta("methodCardTitle")}>
              <SegmentedControl
                label={ta("methodLabel")}
                value={method}
                onChange={(value) => setMethod(value as Method)}
                layout="fill"
              >
                <SegmentedControlItem value="local" label={ta("methodLocal")} />
                <SegmentedControlItem value="oauth" label={ta("methodOauth")} />
              </SegmentedControl>
            </FormCard>

            {method === "local" ? (
              <form action={submitAdmin}>
                <FormCard title={ta("localCardTitle")}>
                  <VStack gap={3}>
                    {adminState.error && <StatusAlert message={adminState.error} success={false} />}
                    <TextInput
                      {...AUTOFILL_USERNAME}
                      label={ta("username")}
                      htmlName="username"
                      value={username}
                      onChange={setUsername}
                      isRequired
                      width="100%"
                    />
                    <GeneratedPasswordField
                      label={ta("password")}
                      htmlName="password"
                      description={passwordPolicyHint(t)}
                      value={password}
                      onChange={setPassword}
                      // Fill the confirmation too: a generated value nobody typed cannot be
                      // retyped from memory, and leaving it blank only blocks the form.
                      onGenerate={(generated) => {
                        setPassword(generated);
                        setPasswordConfirmation(generated);
                      }}
                      isRequired
                    />
                    <TextInput
                      {...AUTOFILL_NEW_PASSWORD}
                      label={ta("confirmPassword")}
                      htmlName="passwordConfirmation"
                      type="password"
                      value={passwordConfirmation}
                      onChange={setPasswordConfirmation}
                      isRequired
                      width="100%"
                    />
                    <SaveButton label={ta("createAccount")} />
                  </VStack>
                </FormCard>
              </form>
            ) : (
              <form action={submitOAuth}>
                <FormCard title={ta("oauthCardTitle")}>
                  <VStack gap={3}>
                    {oauthState.error && <StatusAlert message={oauthState.error} success={false} />}
                    <Banner
                      status="info"
                      title={ta("redirectUriTitle")}
                      description={ta("redirectUriDescription")}
                    />
                    <TextInput
                      label={ta("displayName")}
                      htmlName="providerName"
                      description={ta("displayNameHelp")}
                      value={providerName}
                      onChange={setProviderName}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      label={ta("issuer")}
                      htmlName="issuer"
                      description={ta("issuerHelp")}
                      value={issuer}
                      onChange={setIssuer}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      label={ta("clientId")}
                      htmlName="clientId"
                      value={clientId}
                      onChange={setClientId}
                      isRequired
                      width="100%"
                    />
                    <TextInput
                      label={ta("secretLabel")}
                      htmlName="clientSecret"
                      type="password"
                      value={clientSecret}
                      onChange={setClientSecret}
                      isRequired
                      width="100%"
                    />
                    <SaveButton label={ta("saveProvider")} />
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
