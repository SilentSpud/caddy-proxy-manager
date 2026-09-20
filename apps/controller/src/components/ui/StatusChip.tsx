import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";

type StatusType = "active" | "inactive" | "error" | "warning";

/**
 * A status dot with its label. StatusDot carries the semantic colour and accessible name; the
 * visible Text keeps status from depending on colour alone.
 */
const STATUS_CONFIG: Record<
  StatusType,
  {
    variant: "success" | "warning" | "error" | "neutral";
    labelKey:
      | "statusChip.active"
      | "statusChip.inactive"
      | "statusChip.error"
      | "statusChip.warning";
  }
> = {
  active: { variant: "success", labelKey: "statusChip.active" },
  inactive: { variant: "neutral", labelKey: "statusChip.inactive" },
  error: { variant: "error", labelKey: "statusChip.error" },
  warning: { variant: "warning", labelKey: "statusChip.warning" },
};

type StatusChipProps = {
  status: StatusType;
  label?: string;
};

export function StatusChip({ status, label }: StatusChipProps) {
  const t = useTranslations("ui");
  const config = STATUS_CONFIG[status];
  const displayLabel = label ?? t(config.labelKey);

  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant={config.variant} label={displayLabel} />
      <Text type="body" size="sm" weight="semibold">
        {displayLabel}
      </Text>
    </HStack>
  );
}
