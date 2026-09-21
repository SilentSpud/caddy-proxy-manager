"use client";

/**
 * A block of registry settings, drawn from their definitions.
 *
 * These are the settings that used to be readable here and changeable only in `.env`. They are
 * saved like any other: a stored value wins over the variable, so once a field here is saved the
 * line in `.env` stops deciding anything and can go. A field still answered by the environment
 * says so, since that is the one case where what is on screen did not come from this form.
 *
 * Generic on purpose. The definition knows whether it is text, a number or a switch, and what it
 * will accept, so this renders what it is told rather than repeating those decisions.
 */

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useTranslations } from "next-intl";
import { AUTOFILL_OFF } from "@/components/ui/native-input-attrs";
import { EnvLabelledField } from "@/src/components/ui/EnvLabelledField";
import { FormCard, StatusAlert } from "@/src/components/ui/FormLayout";

/** One setting as the server resolved it, with what a control needs to render it. */
export type RegistryField = {
  /** The setting key, which is also the name the field posts under. */
  key: string;
  env: string;
  label: string;
  description: string;
  source?: "stored" | "environment" | "default";
} & (
  | { kind: "text"; value: string; maxLength?: number; placeholder?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number; min: number; max: number }
);

export function RegistrySettingsBlock({
  block,
  fields,
  state,
  formAction,
}: {
  /** Which block this is, so the action knows which settings the submission may write. */
  block: string;
  fields: readonly RegistryField[];
  state: { success: boolean; message?: string } | null;
  formAction: (payload: FormData) => void;
}) {
  const t = useTranslations("settings");
  const router = useRouter();

  // Pull the page's server data again once a save lands, so the fields show what was stored
  // rather than what the form held. Saving revalidates on the server, but the page already open
  // keeps the payload it rendered from until something asks for a new one.
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

  if (fields.length === 0) return null;

  return (
    <FormCard>
      <form action={formAction}>
        <input type="hidden" name="registryBlock" value={block} />
        <VStack gap={3}>
          {state?.message && <StatusAlert message={state.message} success={state.success} />}
          {fields.map((field) => (
            <FieldControl key={field.key} field={field} fromEnvironment={t("envOverride")} />
          ))}
        </VStack>
      </form>
    </FormCard>
  );
}

/**
 * A field's value, kept in step with the server's.
 *
 * React resets a form once its action has run, which leaves a control showing what it held before
 * the save even though the save succeeded - a checkbox that flicks back off reads as a refusal.
 * The server has just re-rendered with what it stored, so that is what the control goes back to.
 */
function useFieldValue<T>(serverValue: T): [T, (next: T) => void] {
  const [value, setValue] = useState(serverValue);
  const [seen, setSeen] = useState(serverValue);
  if (seen !== serverValue) {
    setSeen(serverValue);
    setValue(serverValue);
  }
  return [value, setValue];
}

/**
 * One field, holding its own value.
 *
 * Each kind draws its own `EnvLabelledField` rather than sharing one, because that wrapper hides
 * the control's label and points its own at it - which it can only do to a design-system control
 * passed as its direct child, not to a component wrapping one.
 *
 * Controlled, like every other field on these screens: the page's save bar decides a form is
 * dirty by what its controls hold, and an uncontrolled input never tells React that changed.
 */
function FieldControl({
  field,
  fromEnvironment,
}: {
  field: RegistryField;
  fromEnvironment: string;
}) {
  // Where the value still comes from. Said only when it is the variable, since that is the one
  // case where what is on screen did not come from this form.
  const badge =
    field.source === "environment" ? <Badge variant="blue" label={fromEnvironment} /> : null;

  if (field.kind === "boolean") return <BooleanField field={field} badge={badge} />;
  if (field.kind === "number") return <NumberField field={field} badge={badge} />;
  return <TextField field={field} badge={badge} />;
}

type Badged = { badge: ReactNode };

function BooleanField({ field, badge }: { field: RegistryField & { kind: "boolean" } } & Badged) {
  const [value, setValue] = useFieldValue(field.value);
  return (
    <EnvLabelledField
      label={field.label}
      env={[field.env]}
      description={field.description}
      layout="inline"
      badge={badge}
    >
      <CheckboxInput label={field.label} htmlName={field.key} value={value} onChange={setValue} />
    </EnvLabelledField>
  );
}

function NumberField({ field, badge }: { field: RegistryField & { kind: "number" } } & Badged) {
  const [value, setValue] = useFieldValue(field.value);
  return (
    <EnvLabelledField
      label={field.label}
      env={[field.env]}
      description={field.description}
      badge={badge}
    >
      <NumberInput
        label={field.label}
        htmlName={field.key}
        value={value}
        onChange={setValue}
        isIntegerOnly
        min={field.min}
        max={field.max}
      />
    </EnvLabelledField>
  );
}

function TextField({ field, badge }: { field: RegistryField & { kind: "text" } } & Badged) {
  const [value, setValue] = useFieldValue(field.value);
  return (
    <EnvLabelledField
      label={field.label}
      env={[field.env]}
      description={field.description}
      badge={badge}
    >
      <TextInput
        {...AUTOFILL_OFF}
        label={field.label}
        placeholder={field.placeholder}
        htmlName={field.key}
        value={value}
        onChange={setValue}
      />
    </EnvLabelledField>
  );
}
