"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { HStack } from "@astryxdesign/core/Stack";

type Props = {
  expired: number;
  expiringSoon: number;
  healthy: number;
  filter: string | null;
  onFilter: (f: string | null) => void;
};

/** The filter chips above the certificate tabs. ToggleButton owns the pressed state. */
const FILTERS: ReadonlyArray<{ key: string; label: string; icon: ReactNode }> = [
  { key: "expired", label: "Expired", icon: <AlertCircle /> },
  { key: "expiring_soon", label: "Expiring soon", icon: <Clock /> },
  { key: "ok", label: "Healthy", icon: <CheckCircle2 /> },
];

export function StatusSummaryBar({ expired, expiringSoon, healthy, filter, onFilter }: Props) {
  const counts: Record<string, number> = {
    expired,
    expiring_soon: expiringSoon,
    ok: healthy,
  };

  return (
    <HStack gap={2} wrap="wrap">
      {FILTERS.map((f) => (
        <ToggleButton
          key={f.key}
          label={f.label}
          icon={f.icon}
          isPressed={filter === f.key}
          onPressedChange={(pressed) => onFilter(pressed ? f.key : null)}
        >
          <HStack gap={2} vAlign="center">
            <span>{f.label}</span>
            <Badge label={counts[f.key]} />
          </HStack>
        </ToggleButton>
      ))}
    </HStack>
  );
}
