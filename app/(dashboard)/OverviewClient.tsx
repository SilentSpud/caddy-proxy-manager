"use client";

import { Activity, ArrowLeftRight, BarChart2, KeyRound, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";

/** Icons the overview can show, keyed by name so the server can name one. */
const STAT_ICONS = {
  proxyHosts: ArrowLeftRight,
  certificates: ShieldCheck,
  accessLists: KeyRound,
} as const;

export type StatCard = {
  label: string;
  icon: keyof typeof STAT_ICONS;
  count: number;
  href: string;
};

type RecentEvent = {
  // The audit row's primary key, so the list keys on real identity rather than
  // on its position in the page's snapshot.
  id: number;
  summary: string;
  createdAt: string;
};

type TrafficSummary = {
  totalRequests: number;
  blockedPercent: number;
} | null;

/**
 * Per-position card tints, so the stat cards stay visually distinguishable.
 * These are decorative only — nothing about a card's meaning is carried by its
 * colour, which is why the previous hand-rolled violet/emerald/amber classes
 * could be swapped for the theme's own non-semantic variants.
 */
const CARD_VARIANTS = ["purple", "green", "orange"] as const;

/**
 * The activity dot's colour used to be the only signal of what kind of change
 * an event was. StatusDot carries a label too, so the distinction is now
 * available to screen readers rather than being colour-only.
 */
function getEventStatus(summary: string): {
  variant: "success" | "error" | "accent";
  label: string;
} {
  const lower = summary.toLowerCase();
  if (lower.startsWith("delete") || lower.startsWith("remove")) {
    return { variant: "error", label: "Removal" };
  }
  if (lower.startsWith("create") || lower.startsWith("add")) {
    return { variant: "success", label: "Creation" };
  }
  return { variant: "accent", label: "Change" };
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function StatTile({
  icon,
  value,
  label,
  children,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <VStack gap={3}>
      <HStack justify="between" vAlign="start" gap={2}>
        {icon}
        <Text type="display-3" hasTabularNumbers>
          {value}
        </Text>
      </HStack>
      <Text type="body" size="sm" weight="medium" color="secondary">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

export default function OverviewClient({
  userName,
  stats,
  trafficSummary,
  recentEvents,
  isAdmin = true,
}: {
  userName: string;
  stats: StatCard[];
  trafficSummary: TrafficSummary;
  recentEvents: RecentEvent[];
  isAdmin?: boolean;
}) {
  return (
    <VStack gap={8}>
      <VStack gap={1}>
        <Heading level={1}>Welcome back, {userName}</Heading>
        <Text type="body" size="sm" color="secondary">
          Everything you need to orchestrate Caddy proxies, certificates, and secure edge services.
        </Text>
      </VStack>

      <Grid columns={{ minWidth: 220, max: 4 }} gap={4}>
        {stats.map((stat, i) => (
          <ClickableCard
            key={stat.label}
            label={`${stat.label}: ${stat.count}`}
            href={stat.href}
            variant={CARD_VARIANTS[i % CARD_VARIANTS.length]}
            padding={5}
          >
            <StatTile
              icon={<Icon icon={STAT_ICONS[stat.icon]} />}
              value={String(stat.count)}
              label={stat.label}
            />
          </ClickableCard>
        ))}

        {isAdmin && (
          <ClickableCard
            label="Traffic in the last 24 hours"
            href="/analytics"
            variant="cyan"
            padding={5}
          >
            <StatTile
              icon={<Icon icon={BarChart2} />}
              value={trafficSummary ? trafficSummary.totalRequests.toLocaleString() : "—"}
              label="Traffic (24h)"
            >
              {trafficSummary && trafficSummary.totalRequests > 0 && (
                <ProgressBar
                  label="Blocked"
                  value={Math.min(trafficSummary.blockedPercent, 100)}
                  variant={trafficSummary.blockedPercent > 0 ? "error" : "neutral"}
                  hasValueLabel
                />
              )}
            </StatTile>
          </ClickableCard>
        )}
      </Grid>

      {isAdmin && (
        <VStack gap={3}>
          <HStack gap={2} vAlign="center">
            <Icon icon={Activity} size="sm" color="accent" />
            <Heading level={2} accessibilityLevel={2}>
              Recent Activity
            </Heading>
          </HStack>

          <Card padding={0}>
            {recentEvents.length === 0 ? (
              <Text type="body" size="sm" color="secondary">
                No activity recorded yet.
              </Text>
            ) : (
              <List hasDividers>
                {recentEvents.map((event) => {
                  const status = getEventStatus(event.summary);
                  return (
                    <ListItem
                      key={event.id}
                      startContent={<StatusDot variant={status.variant} label={status.label} />}
                      label={event.summary}
                      endContent={
                        <Text type="body" size="xsm" color="secondary" hasTabularNumbers>
                          {formatRelativeTime(event.createdAt)}
                        </Text>
                      }
                    />
                  );
                })}
              </List>
            )}
          </Card>
        </VStack>
      )}
    </VStack>
  );
}
