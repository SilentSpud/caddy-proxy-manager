"use client";

/**
 * Form-safe wrappers around the design system's boolean controls.
 *
 * React 19 automatically resets a `<form action={serverAction}>` once the
 * action completes. A reset restores every control to its *attribute* default,
 * and a Switch/CheckboxInput that the user toggled has a DOM `checked`
 * property that has diverged from that attribute — React only sets the
 * property. The control therefore silently snaps back to the server-rendered
 * value while React state still holds the user's choice, and the next submit
 * sends the stale value.
 *
 * Concretely: enable geoblocking, save, then save again without touching
 * anything, and geoblocking is written back as disabled.
 *
 * These wrappers take the value out of the checkbox's DOM state and carry it
 * in a hidden input rendered from React state instead, so what gets submitted
 * always matches what the user sees. `input[type="hidden"]` is `display: none`
 * per the UA stylesheet, so the extra node never affects layout.
 *
 * Import these instead of the design system's own Switch/CheckboxInput
 * anywhere the control participates in a form via `htmlName`.
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
  if (!htmlName) return <BaseSwitch {...props} />;
  return (
    <>
      <BaseSwitch {...props} />
      <input type="hidden" name={htmlName} value={booleanFormValue(props.value)} />
    </>
  );
}

export function CheckboxInput({ htmlName, ...props }: CheckboxInputProps) {
  if (!htmlName) return <BaseCheckboxInput {...props} />;
  return (
    <>
      <BaseCheckboxInput {...props} />
      <input type="hidden" name={htmlName} value={booleanFormValue(props.value)} />
    </>
  );
}
