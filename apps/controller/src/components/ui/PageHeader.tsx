import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/Stack";
import { Fab } from "@/src/components/mobile/Fab";

/** A page's title and its one creating action. Titles stand alone: no sentence underneath. */
export type PageHeaderProps = {
  title: string;
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

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <HStack justify="between" vAlign="center" gap={4} wrap="wrap" paddingBlock={2}>
      <Heading level={1}>{title}</Heading>
      {action && (
        <>
          <Button
            className="cpm-desktop-only"
            // The page's one creating action, so it wears the accent like the phone's floating
            // button does rather than the secondary grey Astryx defaults to.
            variant="primary"
            // Large, so the action fills the header row beside the title rather than floating in it.
            size="lg"
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
