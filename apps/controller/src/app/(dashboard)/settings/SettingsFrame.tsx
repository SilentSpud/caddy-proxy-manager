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
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";
import type { StagedView } from "@/src/lib/settings/staged-view";
import {
  findSettingsItem,
  groupForSection,
  settingsGroupLabel,
  settingsSectionName,
} from "./sections";
import { RevisionPill, StagedControls } from "./StagedChanges";

/**
 * How wide a settings screen gets, however wide the window is.
 *
 * A form column that runs the full width of a 27" monitor is a row of very long text inputs with
 * their labels a screen away from them, so the common treatment is to cap the column and centre
 * what is left. The cap is the reading column, plus the list of blocks when the page has one,
 * and the header shares it so the title sits over the cards rather than out in the margin.
 */
const COLUMN = 768;
const ASIDE = 176;

/** The measure, centred. On a narrow window it is just the available width. */
function Measure({ aside, children }: { aside: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: aside ? `calc(${COLUMN}px + ${ASIDE}px + var(--spacing-5))` : COLUMN,
        marginInline: "auto",
      }}
    >
      {children}
    </div>
  );
}

export default function SettingsFrame({
  sectionId,
  title,
  staged,
  aside = true,
  children,
}: {
  /** The section being shown, or null on the overview. */
  sectionId: string | null;
  /** For a page that is not a section, such as the history: its name in place of the overview's. */
  title?: string;
  staged: StagedView;
  /** Whether this page draws a list of its blocks beside the column, which the measure allows for. */
  aside?: boolean;
  children: ReactNode;
}) {
  return (
    <VStack gap={0} height="fill">
      <SettingsHeader sectionId={sectionId} title={title} staged={staged} aside={aside} />
      {/*
        No scrolling of its own. The app shell's content area is what scrolls, and an
        `overflow: auto` here becomes the scrollport every `position: sticky` inside this frame is
        measured against - a box that never moves, so the header and the page's save bar both
        stopped pinning and simply sat wherever the content put them.
      */}
      <div style={{ flexGrow: 1, padding: "var(--spacing-5)" }}>
        <Measure aside={aside}>{children}</Measure>
      </div>
    </VStack>
  );
}

function SettingsHeader({
  sectionId,
  title,
  staged,
  aside,
}: {
  sectionId: string | null;
  title?: string;
  staged: StagedView;
  aside: boolean;
}) {
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
      <Measure aside={aside}>
        <HStack gap={4} vAlign="end" wrap="wrap">
          <VStack gap={1} style={{ flexGrow: 1, minWidth: 0 }}>
            <div data-testid="settings-breadcrumb">
              <Breadcrumbs>
                <BreadcrumbItem>{tNav("settings")}</BreadcrumbItem>
                {group ? (
                  <BreadcrumbItem isCurrent>{settingsGroupLabel(t, group)}</BreadcrumbItem>
                ) : (
                  <BreadcrumbItem isCurrent>{title ?? t("homeOverview")}</BreadcrumbItem>
                )}
              </Breadcrumbs>
            </div>
            {/* The title alone: a page carries several blocks now, and an environment variable
              beside the title would claim it configures all of them. Each block renders its own
              tokens, and a variable that sets one field renders next to that field. */}
            <Heading level={1}>
              {item ? settingsSectionName(t, item) : (title ?? t("homeOverview"))}
            </Heading>
          </VStack>

          <HStack gap={2} vAlign="center" style={{ flexShrink: 0 }}>
            <RevisionPill staged={staged} />
            <StagedControls view={staged} />
          </HStack>
        </HStack>
      </Measure>
    </div>
  );
}
