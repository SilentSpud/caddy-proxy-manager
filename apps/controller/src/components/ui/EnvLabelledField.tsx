"use client";

/**
 * A form control whose label line also names the environment variable that sets it.
 *
 * The design system's inputs take a label as a plain string, so a badge cannot go inside one. The
 * setup flow already worked around that: hide the control's own label, draw the label beside the
 * tokens, and point it at the control. This is that, shared, so the settings screens and the setup
 * step keep saying the same thing the same way.
 *
 * The control keeps its label as its accessible name (hidden, not removed), and the visible label
 * learns the control's generated id after mount, so clicking the text still focuses it.
 *
 * A checkbox or switch sits beside its label rather than under it, which is where a reader looks
 * for the box, so those pass `layout="inline"`. The design system hides a field's description
 * along with its label, so an inline control hands its description here instead.
 */

import { type ReactElement, cloneElement, useEffect, useId, useRef, useState } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { EnvTokens } from "./EnvTokens";

type ControlProps = {
  label: string;
  isLabelHidden?: boolean;
  ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
};

export function EnvLabelledField({
  label,
  env,
  description,
  layout = "stacked",
  children,
}: {
  /** The control's label, drawn here instead of by the control. */
  label: string;
  /** The variables that set this one field. */
  env: readonly string[];
  /** Only for `inline`, where the control cannot draw its own. */
  description?: string;
  /** `stacked` puts the label above the control; `inline` puts the control first, on its left. */
  layout?: "stacked" | "inline";
  /** One design-system control. It is given `isLabelHidden` and a ref. */
  children: ReactElement<ControlProps>;
}) {
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const [controlId, setControlId] = useState<string>();
  const labelId = useId();

  // After mount, because the control generates its own id and only then has one to point at.
  useEffect(() => setControlId(controlRef.current?.id), []);

  // A real label element, so the text focuses the control the way the control's own would.
  const labelLine = (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <label id={labelId} htmlFor={controlId} style={{ cursor: "pointer" }}>
        <Text type="label">{label}</Text>
      </label>
      <EnvTokens names={env} />
    </HStack>
  );
  const control = cloneElement(children, { isLabelHidden: true, ref: controlRef });

  if (layout === "inline") {
    // A grid rather than a row of two stacks: the description starts where the label does rather
    // than under the box. The box spans both rows and centres itself across them, so it sits in
    // the middle of the field however many lines the description runs to.
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          columnGap: "var(--spacing-3)",
          alignItems: "center",
        }}
      >
        <div
          style={{
            gridColumn: 1,
            gridRow: description ? "1 / span 2" : "1",
            alignSelf: "center",
            display: "flex",
            alignItems: "center",
          }}
        >
          {control}
        </div>
        {labelLine}
        {description && (
          <Text size="xsm" color="secondary" style={{ gridColumn: 2 }}>
            {description}
          </Text>
        )}
      </div>
    );
  }

  return (
    <VStack gap={1}>
      {labelLine}
      {control}
    </VStack>
  );
}
