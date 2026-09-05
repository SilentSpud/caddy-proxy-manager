"use client";

/**
 * The card, alert and submit primitives every settings-shaped form in the app is built from.
 *
 * These lived inside SettingsClient.tsx until the setup flow needed the same shapes. Extracted
 * rather than copied so the two stay identical — a setup page that looks subtly unlike the
 * settings page it is about to hand over to reads as a different application.
 */
import type { ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";

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
          // level 2 because every caller renders these under the page's own h1 — the Settings
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

/** Right-aligned submit button, the footer every settings form ends with. */
export function SaveButton({ label, isDisabled }: { label: string; isDisabled?: boolean }) {
  return (
    <HStack justify="end">
      <Button type="submit" size="sm" label={label} isDisabled={isDisabled} />
    </HStack>
  );
}
