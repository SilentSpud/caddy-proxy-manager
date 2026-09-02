import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
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
          <Text type="body" size="sm" color="secondary">
            {description}
          </Text>
        )}
      </VStack>
      {action && (
        <Button
          label={action.label}
          icon={action.icon ?? <Plus />}
          onClick={action.onClick}
          isDisabled={action.isDisabled}
        />
      )}
    </HStack>
  );
}
