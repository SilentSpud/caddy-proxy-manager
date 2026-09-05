"use client";

/**
 * Form-safe wrappers around the design system's boolean controls. React 19 resets a
 * `<form action={serverAction}>` after the action, restoring each control to its *attribute*
 * default — so a toggled Switch snaps back and the next submit sends the stale value. These carry
 * the value in a hidden input from React state. Use wherever a control submits via `htmlName`.
 */

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { CheckboxInput as BaseCheckboxInput } from "@astryxdesign/core/CheckboxInput";
import type { CheckboxInputProps } from "@astryxdesign/core/CheckboxInput";
import { Switch as BaseSwitch } from "@astryxdesign/core/Switch";
import type { SwitchProps } from "@astryxdesign/core/Switch";

/** Checkbox semantics: "on" when set, absent-equivalent ("") when not. */
function booleanFormValue(value: boolean | "indeterminate"): string {
  return value === true ? "on" : "";
}

/**
 * The hidden input, plus a remount of the control whenever the form is reset.
 *
 * The hidden input alone fixes what gets *submitted*. It does not fix what is *shown*: the reset
 * restores the real checkbox to its attribute default while React state still says otherwise, and
 * because React's own value has not changed it never writes the DOM back. The control then reads as
 * off while the app believes it is on, and the next click reports the state it is already in — so
 * it appears to do nothing, and a second click is needed to take effect.
 *
 * Remounting on the reset event rebuilds the control from state, which is the one thing a reset
 * cannot desync. Keyed on a counter rather than repaired in place because the wrapper has no handle
 * on the input the design system renders inside.
 */
function ResetSafe({
  htmlName,
  value,
  children,
}: {
  htmlName: string;
  value: boolean | "indeterminate";
  children: ReactNode;
}) {
  const anchor = useRef<HTMLInputElement>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const form = anchor.current?.form;
    if (!form) return;
    // Fires before the reset itself is applied, so the remount is queued and lands after it.
    const onReset = () => setGeneration((current) => current + 1);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  return (
    <>
      <Fragment key={generation}>{children}</Fragment>
      <input ref={anchor} type="hidden" name={htmlName} value={booleanFormValue(value)} />
    </>
  );
}

export function Switch({ htmlName, ...props }: SwitchProps) {
  // A disabled control must not submit — the base components enforce that with
  // `name={isDisabled ? undefined : htmlName}`, so the hidden input has to honour it too.
  if (!htmlName || props.isDisabled) return <BaseSwitch {...props} />;
  return (
    <ResetSafe htmlName={htmlName} value={props.value}>
      <BaseSwitch {...props} />
    </ResetSafe>
  );
}

export function CheckboxInput({ htmlName, ...props }: CheckboxInputProps) {
  // See above: disabled controls are excluded from submission.
  if (!htmlName || props.isDisabled) return <BaseCheckboxInput {...props} />;
  return (
    <ResetSafe htmlName={htmlName} value={props.value}>
      <BaseCheckboxInput {...props} />
    </ResetSafe>
  );
}
