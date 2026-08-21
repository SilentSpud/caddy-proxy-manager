"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import type { CertExpiryStatus } from "../page";

function formatRelative(validTo: string): string {
  const diff = new Date(validTo).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor(absDiff / 3600000);

  if (diff < 0) {
    if (days >= 1) return `Expired ${days}d ago`;
    return `Expired ${hours}h ago`;
  }
  if (days >= 1) return `${days}d`;
  return `${hours}h`;
}

function formatFull(validTo: string): string {
  return new Date(validTo).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Icon and variant carry the same meaning, so expiry never reads by colour
 * alone — "12d" and "3d" are otherwise identical but for the green/amber.
 */
const STATUS_CONFIG: Record<
  CertExpiryStatus,
  { variant: "error" | "warning" | "success"; icon: ReactNode }
> = {
  expired: { variant: "error", icon: <AlertCircle /> },
  expiring_soon: { variant: "warning", icon: <Clock /> },
  ok: { variant: "success", icon: <CheckCircle2 /> },
};

export function RelativeTime({
  validTo,
  status,
}: {
  validTo: string | null;
  status: CertExpiryStatus | null;
}) {
  if (validTo === null || status === null) {
    return (
      <Text type="body" size="sm" color="secondary">
        —
      </Text>
    );
  }

  const config = STATUS_CONFIG[status];

  return (
    <Tooltip content={formatFull(validTo)}>
      <Badge variant={config.variant} icon={config.icon} label={formatRelative(validTo)} />
    </Tooltip>
  );
}
