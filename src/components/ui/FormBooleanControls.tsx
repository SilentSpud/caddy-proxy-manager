"use client";

/**
 * Form-safe wrappers around the design system's boolean controls. React 19 resets a
 * `<form action={serverAction}>` after the action, restoring each control to its *attribute*
 * default — so a toggled Switch snaps back while React state keeps the user's choice, and the next
 * submit sends the stale value. These carry the value in a hidden input rendered from React state.
 * Use them wherever a control participates in a form via `htmlName`.
 */

import { CheckboxInput as BaseCheckboxInput } from "@astryxdesign/core/CheckboxInput";
import type { CheckboxInputProps } from "@astryxdesign/core/CheckboxInput";
import { Switch as BaseSwitch } from "@astryxdesign/core/Switch";
import type { SwitchProps } from "@astryxdesign/core/Switch";

/** Checkbox semantics: "on" when set, absent-equivalent ("") when not. */
function booleanFormValue(value: boolean | "indeterminate"): string {
  return value === true ? "on" : "";
}

export function Switch({ htmlName, ...props }: SwitchProps) {
  // A disabled control must not submit — the base components enforce that with
  // `name={isDisabled ? undefined : htmlName}`, so the hidden input has to honour it too.
  if (!htmlName || props.isDisabled) return <BaseSwitch {...props} />;
  return (
    <>
      <BaseSwitch {...props} />
      <input type="hidden" name={htmlName} value={booleanFormValue(props.value)} />
    </>
  );
}

export function CheckboxInput({ htmlName, ...props }: CheckboxInputProps) {
  // See above: disabled controls are excluded from submission.
  if (!htmlName || props.isDisabled) return <BaseCheckboxInput {...props} />;
  return (
    <>
      <BaseCheckboxInput {...props} />
      <input type="hidden" name={htmlName} value={booleanFormValue(props.value)} />
    </>
  );
}
