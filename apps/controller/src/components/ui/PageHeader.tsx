import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Fab } from "@/src/components/mobile/Fab";

export type PageHeaderProps = {
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    /** A link instead of a handler, for an action that lives on another page. */
    href?: string;
    icon?: ReactNode;
    /** Greys out the primary action, e.g. when a required Caddy module is off. */
    isDisabled?: boolean;
  };
};

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <HStack justify="between" vAlign="start" gap={4} wrap="wrap" paddingBlock={2}>
      <VStack gap={1} maxWidth={560}>
        <Heading level={1}>{title}</Heading>
        {description && (
          // Not on a phone: a sentence under the title is read once and skipped forever after, and
          // on a small screen it costs a card's worth of the first view.
          <Text type="body" size="sm" color="secondary" className="cpm-desktop-only">
            {description}
          </Text>
        )}
      </VStack>
      {action && (
        <>
          <Button
            className="cpm-desktop-only"
            label={action.label}
            icon={action.icon ?? <Plus />}
            onClick={action.onClick}
            href={action.href}
            isDisabled={action.isDisabled}
          />
          {/* The same action as a floating button on a phone, where the corner is reachable and the
              header is not. */}
          <Fab
            label={action.label}
            icon={action.icon}
            onClick={action.onClick}
            href={action.href}
            isDisabled={action.isDisabled}
          />
        </>
      )}
    </HStack>
  );
}
