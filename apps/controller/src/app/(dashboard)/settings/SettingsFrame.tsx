"use client";

/**
 * The frame every settings screen renders inside: a sticky header, then the section's own content.
 *
 * The header exists because nothing above it names the page any more. It carries what used to be
 * spread across the old chrome and a floating bar at the foot of the page - where the operator is,
 * which revision is live, and the one control that sends pending work to Caddy. Fixing it here
 * also fixes the apply button's address: it no longer moves with the scroll position.
 */

import type { ReactNode } from "react";
import { Breadcrumbs, BreadcrumbItem } from "@astryxdesign/core/Breadcrumbs";
import { Code } from "@astryxdesign/core/Code";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useTranslations } from "next-intl";
import type { StagedView } from "@/src/lib/settings/staged-view";
import { findSettingsItem, groupForSection } from "./sections";
import { RevisionPill, StagedControls } from "./StagedChanges";

export default function SettingsFrame({
  sectionId,
  staged,
  children,
}: {
  /** The section being shown, or null on the overview. */
  sectionId: string | null;
  staged: StagedView;
  children: ReactNode;
}) {
  return (
    <VStack gap={0} height="fill">
      <SettingsHeader sectionId={sectionId} staged={staged} />
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--spacing-5)",
        }}
      >
        {children}
      </div>
    </VStack>
  );
}

function SettingsHeader({ sectionId, staged }: { sectionId: string | null; staged: StagedView }) {
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");
  const item = sectionId ? findSettingsItem(sectionId) : undefined;
  const group = sectionId ? groupForSection(sectionId) : undefined;

  return (
    <div
      style={{
        flexShrink: 0,
        // Sticky rather than fixed: it scrolls with a narrow viewport that cannot spare the room,
        // and pins on every viewport that can.
        position: "sticky",
        top: 0,
        zIndex: 4,
        background: "var(--color-background-body)",
        borderBottom: "1px solid var(--color-border)",
        padding: "var(--spacing-4) var(--spacing-5)",
      }}
      data-testid="settings-header"
    >
      <HStack gap={4} vAlign="end" wrap="wrap">
        <VStack gap={1} style={{ flexGrow: 1, minWidth: 0 }}>
          <div data-testid="settings-breadcrumb">
            <Breadcrumbs>
              <BreadcrumbItem>{tNav("settings")}</BreadcrumbItem>
              {group ? (
                <BreadcrumbItem isCurrent>{group.label}</BreadcrumbItem>
              ) : (
                <BreadcrumbItem isCurrent>{t("homeOverview")}</BreadcrumbItem>
              )}
            </Breadcrumbs>
          </div>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={1}>{item ? item.name : t("homeOverview")}</Heading>
            <EnvTokens names={item?.env} />
          </HStack>
          <Text type="body" size="sm" color="secondary">
            {item ? item.desc : t("homeSubtitle")}
          </Text>
        </VStack>

        <HStack gap={2} vAlign="center" style={{ flexShrink: 0 }}>
          <RevisionPill staged={staged} />
          <StagedControls view={staged} />
        </HStack>
      </HStack>
    </div>
  );
}

/**
 * The environment variables a section is configured by, as tokens beside its name.
 *
 * Named rather than explained: an operator holding a `.env` line recognises `CLICKHOUSE_URL`
 * faster than any sentence about it, and the same string is what the search matches on.
 */
function EnvTokens({ names }: { names?: readonly string[] }) {
  const t = useTranslations("settings");
  if (!names || names.length === 0) return null;
  return (
    // A bare div with an aria-label is not exposed; the role is what gives the tokens a name
    // instead of reading them out as loose words after the heading.
    <HStack
      gap={1}
      vAlign="center"
      wrap="wrap"
      role="group"
      aria-label={t("environmentVariablesLabel")}
    >
      {names.map((name) => (
        <Code key={name} size="inherit" color="secondary">
          {name}
        </Code>
      ))}
    </HStack>
  );
}
