import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/Stack";

type StatusType = "active" | "inactive" | "error" | "warning";

/**
 * A status dot with its label beside it.
 *
 * StatusDot carries the semantic colour and the accessible name; the visible
 * Text is what the docs require so status never depends on colour alone. This
 * replaces a hand-built pill with hardcoded green/amber/red plus a glow shadow,
 * none of which adapted to the theme.
 */
const STATUS_CONFIG: Record<
  StatusType,
  { variant: "success" | "warning" | "error" | "neutral"; label: string }
> = {
  active: { variant: "success", label: "Active" },
  inactive: { variant: "neutral", label: "Paused" },
  error: { variant: "error", label: "Error" },
  warning: { variant: "warning", label: "Warning" },
};

type StatusChipProps = {
  status: StatusType;
  label?: string;
};

export function StatusChip({ status, label }: StatusChipProps) {
  const config = STATUS_CONFIG[status];
  const displayLabel = label ?? config.label;

  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant={config.variant} label={displayLabel} />
      <Text type="body" size="xsm" weight="semibold">
        {displayLabel}
      </Text>
    </HStack>
  );
}
