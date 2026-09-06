"use client";

/**
 * The last setup step: everything that used to live in `.env`, rendered from the registry.
 *
 * Fields are generated rather than written out, so adding a setting to
 * src/lib/settings/registry.ts puts it on this page and on the migration screen at the same time.
 * A value that came from the environment is labelled as such — that is the operator's cue that
 * saving here is what lets them delete it from their `.env`.
 *
 * The Defaults card is the exception, and is written out by hand because it is not a registry
 * setting: primary domain and ACME contact live together in the `general` JSON object that
 * predates the registry, and moving them would change where the Settings page and the v1 API read
 * them from. They are here because the ACME contact is the address Let's Encrypt warns about
 * expiring certificates at, and an instance that finishes setup without one issues its first
 * certificate with nobody to tell.
 */
import { useActionState, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Banner } from "@astryxdesign/core/Banner";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Switch } from "@/src/components/ui/FormBooleanControls";
import { AUTOFILL_OFF, NATIVE_REQUIRED } from "@/src/components/ui/native-input-attrs";
import { FormCard, InfoAlert, SaveButton, StatusAlert } from "@/src/components/ui/FormLayout";
import { saveSetupSettings } from "./actions";

export type SettingField = {
  key: string;
  env: string;
  group: string;
  label: string;
  description: string;
  kind: "string" | "number" | "boolean" | "tristate";
  secret: boolean;
  /** Switches its whole group on and off. At most one per group; see the registry's `gate`. */
  gate: boolean;
  value: string | number | boolean | null;
  source: "stored" | "environment" | "default";
};

export type GeneralFields = { primaryDomain: string; acmeEmail: string };

export type OAuthPrefill = {
  providerName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  autoLink: boolean;
  roleMappingEnabled: boolean;
  groupsClaim: string;
  groupPrefix: string;
  adminGroup: string;
  userGroup: string;
  viewerGroup: string;
  defaultRole: string;
  syncGroups: boolean;
};

export type OAuthCard = {
  /** Providers already configured. Non-empty means this card has nothing to add. */
  existing: string[];
  /** Whether the prefill came from OAUTH_* rather than being blank defaults. */
  fromEnvironment: boolean;
  prefill: OAuthPrefill;
};

export default function SetupSettingsClient({
  fields,
  groups,
  general,
  oauth,
}: {
  fields: SettingField[];
  groups: Array<{ id: string; title: string }>;
  general: GeneralFields;
  oauth: OAuthCard;
}) {
  const [state, submit] = useActionState(saveSetupSettings, { error: null });

  const [primaryDomain, setPrimaryDomain] = useState(general.primaryDomain);
  const [acmeEmail, setAcmeEmail] = useState(general.acmeEmail);
  const [idp, setIdp] = useState<OAuthPrefill>(oauth.prefill);

  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        field.kind === "boolean" || field.gate ? field.value === true : String(field.value ?? ""),
      ]),
    ),
  );

  /** Whether a field is on screen: everything, minus the groups whose gate is switched off. */
  const isVisible = (field: SettingField) => {
    if (field.gate) return true;
    const gate = fields.find((other) => other.group === field.group && other.gate);
    return !gate || values[gate.key] === true;
  };

  // Only what is actually on screen. A hidden field is not migrated either, so counting it would
  // tell the operator a value had been copied into the database and invite them to delete it from
  // their .env — where it is still the only copy.
  const migratedCount = fields.filter(
    (field) => field.source === "environment" && isVisible(field),
  ).length;

  return (
    <Center>
      <VStack gap={5} padding={5}>
        <VStack gap={2}>
          <Heading level={1}>Finish setting up</Heading>
          <Text color="secondary">
            These are stored in the database once you save, so they can be changed later without
            editing a file or restarting.
          </Text>
        </VStack>

        {migratedCount > 0 && (
          <InfoAlert title={`${migratedCount} value(s) came from your .env file`}>
            They are filled in below and marked. Saving copies them into the database, after which
            you can remove those entries from your .env.
          </InfoAlert>
        )}

        <form action={submit}>
          <VStack gap={4}>
            {state.error && <StatusAlert message={state.error} success={false} />}

            <FormCard title="Defaults">
              <VStack gap={3}>
                <TextInput
                  // NATIVE_REQUIRED as well as isRequired, matching the Settings page: isRequired
                  // marks the field, the attribute is what stops an empty one being posted. The
                  // save refuses it either way; the browser refusing first is a better answer.
                  {...NATIVE_REQUIRED}
                  label="Primary domain"
                  description="Offered first when you create a proxy host, so the one you use most belongs here."
                  htmlName="primaryDomain"
                  value={primaryDomain}
                  onChange={setPrimaryDomain}
                  isRequired
                  width="100%"
                />
                <TextInput
                  label="ACME contact email"
                  description="Where Let's Encrypt sends expiry warnings and account notices. Optional, and worth setting: without it nobody is told when a certificate is about to lapse."
                  type="email"
                  htmlName="acmeEmail"
                  value={acmeEmail}
                  onChange={setAcmeEmail}
                  width="100%"
                />
              </VStack>
            </FormCard>

            {groups.map((group) => {
              const groupFields = fields.filter((field) => field.group === group.id);
              if (groupFields.length === 0) return null;

              const gate = groupFields.find((field) => field.gate);
              const rest = groupFields.filter((field) => !field.gate);
              const change = (key: string) => (next: string | boolean) =>
                setValues((previous) => ({ ...previous, [key]: next }));

              return (
                <FormCard key={group.id} title={group.title}>
                  <VStack gap={4}>
                    {gate && (
                      <GateSwitch
                        field={gate}
                        value={values[gate.key] === true}
                        onChange={change(gate.key)}
                      />
                    )}
                    {/* Hidden rather than disabled when the gate is off: an unrendered field posts
                        nothing, and the save skips what it was not sent — so turning analytics off
                        leaves the ClickHouse password stored rather than clearing it. */}
                    {rest.filter(isVisible).map((field) => (
                      <SettingRow
                        key={field.key}
                        field={field}
                        value={values[field.key]}
                        onChange={change(field.key)}
                      />
                    ))}
                  </VStack>
                </FormCard>
              );
            })}

            <IdentityProviderCard card={oauth} value={idp} onChange={setIdp} />

            <SaveButton label="Save and finish setup" />
          </VStack>
        </form>
      </VStack>
    </Center>
  );
}

/**
 * The switch that decides whether a group's feature runs at all.
 *
 * Its own component rather than a `kind` on SettingRow: this one is stored tri-state but must post
 * a definite yes or no. Setup is where the operator makes the choice explicit, so "leave it to be
 * inferred" is not an answer worth offering here — the switch arrives showing whatever is inferred
 * today, and saving pins it.
 */
function GateSwitch({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <VStack gap={2}>
      <Switch
        label={field.label}
        description={field.description}
        htmlName={field.key}
        value={value}
        onChange={onChange}
      />
      {field.source === "environment" && <Badge label={`from ${field.env}`} />}
      {value && <Divider />}
    </VStack>
  );
}

function SettingRow({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: string | boolean | undefined;
  onChange: (next: string | boolean) => void;
}) {
  const label = (
    <HStack gap={2} align="center">
      <Text size="sm" weight="medium">
        {field.label}
      </Text>
      {field.source === "environment" && <Badge label={`from ${field.env}`} />}
    </HStack>
  );

  // Tri-state: unset means "no opinion, let the Security toggle decide", which a text box cannot
  // express and a switch cannot represent as a third value.
  if (field.kind === "tristate") {
    return (
      <VStack gap={1}>
        {label}
        <Selector
          label={field.label}
          isLabelHidden
          description={field.description}
          htmlName={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={(next: string) => onChange(next)}
          options={[
            { value: "", label: "Let the Settings toggle decide" },
            { value: "true", label: "Required" },
            { value: "false", label: "Not required" },
          ]}
        />
      </VStack>
    );
  }

  if (field.kind === "boolean") {
    return (
      <VStack gap={1}>
        {label}
        <Switch
          label={field.description}
          htmlName={field.key}
          value={value === true}
          onChange={(next: boolean) => onChange(next)}
        />
      </VStack>
    );
  }

  return (
    <VStack gap={1}>
      {label}
      <TextInput
        label={field.label}
        isLabelHidden
        htmlName={field.key}
        type={field.secret ? "password" : "text"}
        description={
          field.secret && field.source !== "default"
            ? `${field.description} Leave blank to keep the current value.`
            : field.description
        }
        value={typeof value === "string" ? value : ""}
        onChange={(next: string) => onChange(next)}
        width="100%"
      />
    </VStack>
  );
}

/**
 * Configure an identity provider, or say why there is nothing to do.
 *
 * Every field is optional and the whole card is skipped when the core three are blank, because a
 * deployment signing in with a local administrator has no provider to describe. Leaving it out
 * entirely was the old behaviour, and it meant the OAUTH_* half of a `.env` had no home on this
 * page at all — the account step asks about OAuth only on the branch where it is the *only* way
 * in, so an operator who made a local administrator was never asked, and never told they could
 * stop setting those variables.
 *
 * Everything past the core four is behind a disclosure. Sixteen inputs open on a setup screen
 * reads as sixteen decisions to make; four reads as the four that are actually required.
 */
function IdentityProviderCard({
  card,
  value,
  onChange,
}: {
  card: OAuthCard;
  value: OAuthPrefill;
  onChange: (next: OAuthPrefill) => void;
}) {
  const set =
    <K extends keyof OAuthPrefill>(key: K) =>
    (next: OAuthPrefill[K]) =>
      onChange({ ...value, [key]: next });

  if (card.existing.length > 0) {
    return (
      <FormCard title="Identity provider">
        <Banner
          status="info"
          title={`Already configured: ${card.existing.join(", ")}`}
          description="Add or change providers from Settings once setup is finished."
        />
      </FormCard>
    );
  }

  return (
    <FormCard title="Identity provider (optional)">
      <VStack gap={3}>
        <Text size="sm" color="secondary">
          Sign in through an OIDC provider, as well as or instead of local accounts. Leave these
          blank to skip — one can be added from Settings at any time.
        </Text>

        {card.fromEnvironment && (
          <Banner
            status="info"
            title="Filled in from your OAUTH_ environment variables"
            description="Saving stores the provider in the database, after which those variables can be removed."
          />
        )}

        <TextInput
          label="Display name"
          description="Shown on the sign-in button."
          htmlName="idpName"
          value={value.providerName}
          onChange={set("providerName")}
          width="100%"
        />
        <TextInput
          label="Issuer URL"
          description="The provider's OIDC issuer. Its endpoints are discovered from here."
          htmlName="idpIssuer"
          value={value.issuer}
          onChange={set("issuer")}
          width="100%"
        />
        <TextInput
          {...AUTOFILL_OFF}
          label="Client ID"
          htmlName="idpClientId"
          value={value.clientId}
          onChange={set("clientId")}
          width="100%"
        />
        <TextInput
          {...AUTOFILL_OFF}
          label="Client secret"
          type="password"
          htmlName="idpClientSecret"
          value={value.clientSecret}
          onChange={set("clientSecret")}
          width="100%"
        />

        <Collapsible defaultIsOpen={false} trigger={<Text size="sm">More options</Text>}>
          <VStack gap={3} padding={2}>
            <Text size="xsm" color="secondary">
              The three endpoints are only needed for a provider that does not publish OIDC
              discovery; leave them blank otherwise.
            </Text>
            <TextInput
              label="Authorization URL"
              htmlName="idpAuthorizationUrl"
              value={value.authorizationUrl}
              onChange={set("authorizationUrl")}
              width="100%"
            />
            <TextInput
              label="Token URL"
              htmlName="idpTokenUrl"
              value={value.tokenUrl}
              onChange={set("tokenUrl")}
              width="100%"
            />
            <TextInput
              label="Userinfo URL"
              htmlName="idpUserinfoUrl"
              value={value.userinfoUrl}
              onChange={set("userinfoUrl")}
              width="100%"
            />
            <TextInput
              label="Scopes"
              description="Space separated. Group claims usually need one more than the default."
              htmlName="idpScopes"
              value={value.scopes}
              onChange={set("scopes")}
              width="100%"
            />
            <Switch
              label="Link to an existing account with the same email"
              description="Off means a returning user with a matching local account is refused rather than merged."
              htmlName="idpAutoLink"
              value={value.autoLink}
              onChange={set("autoLink")}
            />

            <Divider />

            <Switch
              label="Map roles from the provider's groups"
              description="Off means everyone arrives with the default role below, whatever groups they are in."
              htmlName="idpRoleMapping"
              value={value.roleMappingEnabled}
              onChange={set("roleMappingEnabled")}
            />
            {value.roleMappingEnabled && (
              <>
                <TextInput
                  label="Groups claim"
                  description="Dot-separated for a nested claim, e.g. resource_access.cpm.roles."
                  htmlName="idpGroupsClaim"
                  value={value.groupsClaim}
                  onChange={set("groupsClaim")}
                  width="100%"
                />
                <TextInput
                  label="Group prefix"
                  description="With CPM_, membership of CPM_Admin grants admin. The three fields below override it."
                  htmlName="idpGroupPrefix"
                  value={value.groupPrefix}
                  onChange={set("groupPrefix")}
                  width="100%"
                />
                <TextInput
                  label="Admin group"
                  htmlName="idpAdminGroup"
                  value={value.adminGroup}
                  onChange={set("adminGroup")}
                  width="100%"
                />
                <TextInput
                  label="User group"
                  htmlName="idpUserGroup"
                  value={value.userGroup}
                  onChange={set("userGroup")}
                  width="100%"
                />
                <TextInput
                  label="Viewer group"
                  htmlName="idpViewerGroup"
                  value={value.viewerGroup}
                  onChange={set("viewerGroup")}
                  width="100%"
                />
                <Switch
                  label="Mirror the remaining prefixed groups into this app's groups"
                  htmlName="idpSyncGroups"
                  value={value.syncGroups}
                  onChange={set("syncGroups")}
                />
              </>
            )}
            <Selector
              label="Role when no group matched"
              htmlName="idpDefaultRole"
              value={value.defaultRole}
              onChange={(next: string) => set("defaultRole")(next)}
              options={[
                { value: "viewer", label: "Viewer" },
                { value: "user", label: "User" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </VStack>
        </Collapsible>
      </VStack>
    </FormCard>
  );
}
