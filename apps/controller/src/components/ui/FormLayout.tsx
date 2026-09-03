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
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

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
          <>
            <Text type="label" size="xsm" weight="semibold" color="secondary">
              {title}
            </Text>
            <Divider />
          </>
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
