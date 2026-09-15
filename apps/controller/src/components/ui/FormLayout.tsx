"use client";

/**
 * The card, alert and submit primitives every settings-shaped form in the app is built from.
 *
 * These lived inside SettingsClient.tsx until the setup flow needed the same shapes. Extracted
 * rather than copied so the two stay identical - a setup page that looks subtly unlike the
 * settings page it is about to hand over to reads as a different application.
 */
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";

export function StatusAlert({ message, success }: { message: string; success: boolean }) {
  return <Banner status={success ? "success" : "error"} title={message} />;
}

export function InfoAlert({ title, children }: { title: string; children?: ReactNode }) {
  return <Banner status="info" title={title} description={children} />;
}

export function WarnAlert({ title, children }: { title: string; children?: ReactNode }) {
  return <Banner status="warning" title={title} description={children} />;
}

export function FormCard({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card padding={4}>
      <VStack gap={4}>
        {title && (
          // level 2 because every caller renders these under the page's own h1 - the Settings
          // detail pane and each setup step. Its own stack, and a tighter gap than the card's, so
          // the rule reads as part of the heading rather than as the first row of content.
          <VStack gap={2}>
            <Heading level={2}>{title}</Heading>
            <Divider />
          </VStack>
        )}
        {children}
        {footer && (
          <>
            <Divider />
            <HStack justify="end" gap={2}>
              {footer}
            </HStack>
          </>
        )}
      </VStack>
    </Card>
  );
}

/**
 * Left-aligned submit button, the footer every settings form ends with. Plain "Save" unless a form
 * does something more than save - the card title already says what is being saved.
 */
export function SaveButton({ label, isDisabled }: { label?: string; isDisabled?: boolean }) {
  const t = useTranslations("ui");
  const anchor = useRef<HTMLInputElement>(null);
  const isDirty = useFormDirty(anchor);
  return (
    <HStack justify="start">
      {/* No name, so it submits nothing: it is only how this button finds the form it belongs to. */}
      <input ref={anchor} type="hidden" />
      <Button
        type="submit"
        // The accent colour is the cue that something on this form has not been saved yet.
        variant={isDirty ? "primary" : "secondary"}
        label={label ?? t("save")}
        isDisabled={isDisabled}
      />
    </HStack>
  );
}

/** What the form would submit right now, as one comparable string. A file counts by name and size. */
function serializeForm(form: HTMLFormElement): string {
  const entries: string[] = [];
  for (const [key, value] of new FormData(form)) {
    entries.push(`${key}=${typeof value === "string" ? value : `${value.name}:${value.size}`}`);
  }
  return entries.join("\n");
}

/**
 * Whether the enclosing form differs from what it held when it was last loaded or saved.
 *
 * Compared by value rather than by "was anything touched", so typing a change and then undoing it
 * reads as clean again. The check runs a frame after each event: switches and selectors write their
 * hidden inputs from React state, which lands after the click that caused it - hence the
 * MutationObserver as well, for a value no event announces.
 */
function useFormDirty(anchor: RefObject<HTMLInputElement | null>): boolean {
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const form = anchor.current?.form;
    if (!form) return;

    let baseline: string | null = null;
    // Its own frame, which a check never cancels: a form whose fields update themselves while
    // mounting fires checks at once, and sharing one handle left the baseline unset for good.
    const baselineFrame = requestAnimationFrame(() => {
      baseline = serializeForm(form);
    });
    let frame = 0;

    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (baseline !== null) setIsDirty(serializeForm(form) !== baseline);
      });
    };
    // React resets a form once its action has run; what it holds afterwards is the saved state.
    const rebaseline = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        baseline = serializeForm(form);
        setIsDirty(false);
      });
    };

    const observer = new MutationObserver(check);
    observer.observe(form, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["value", "checked"],
    });
    const events = ["input", "change", "click", "keyup"] as const;
    for (const type of events) form.addEventListener(type, check);
    form.addEventListener("reset", rebaseline);

    return () => {
      cancelAnimationFrame(baselineFrame);
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const type of events) form.removeEventListener(type, check);
      form.removeEventListener("reset", rebaseline);
    };
  }, [anchor]);

  return isDirty;
}
