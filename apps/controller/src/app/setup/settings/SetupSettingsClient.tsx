"use client";

/**
 * The last setup step: everything that used to live in `.env`, rendered from the registry.
 *
 * Fields are generated rather than written out, so adding a setting to
 * src/lib/settings/registry.ts puts it on this page and on the migration screen at the same time.
 * A value that came from the environment is labelled as such — that is the operator's cue that
 * saving here is what lets them delete it from their `.env`.
 */
import { useActionState, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Switch } from "@/src/components/ui/FormBooleanControls";
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

export default function SetupSettingsClient({
  fields,
  groups,
}: {
  fields: SettingField[];
  groups: Array<{ id: string; title: string }>;
}) {
  const [state, submit] = useActionState(saveSetupSettings, { error: null });

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
