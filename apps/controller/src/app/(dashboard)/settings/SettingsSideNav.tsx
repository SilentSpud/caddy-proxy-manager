"use client";

/**
 * The sidebar while a settings route is open.
 *
 * Settings takes the rail over rather than nesting a second one inside the page: the old layout
 * put a settings panel beside the dashboard's own nav, so two sidebars competed for the same
 * glance and the content pane started 500px in. Here there is one rail, and its first row is the
 * way back out - with nothing above it, that row is the only exit.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { ArrowLeft, DatabaseBackup, History, LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SETTINGS_GROUPS, settingsGroupLabel, settingsSectionName } from "./sections";
import { PaletteSearchButton } from "@/src/components/command-palette/GlobalCommandPalette";
import { storageKeysForSection } from "@/src/lib/settings/section-keys";

export default function SettingsSideNav({
  footer,
  stagedKeys,
}: {
  /** The signed-in user block, reused from the dashboard rail so the two do not drift. */
  footer: ReactNode;
  /** Storage keys with pending edits, so a section carrying one is marked in the rail. */
  stagedKeys: readonly string[];
}) {
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const staged = new Set(stagedKeys);

  return (
    <SideNav footer={footer} data-testid="settings-rail">
      <VStack gap={2} padding={2}>
        <SideNavItem as={Link} href="/" label={t("backToDashboard")} icon={<ArrowLeft />} />
        {/* The global palette - pages and settings alike, the same one the shortcut opens. */}
        <PaletteSearchButton />
      </VStack>

      <SideNavSection title={tNav("settings")} isHeaderHidden>
        <SideNavItem
          as={Link}
          href="/settings"
          label={t("homeOverview")}
          icon={<LayoutGrid />}
          isSelected={pathname === "/settings"}
        />
        <SideNavItem
          as={Link}
          href="/settings/history"
          label={t("history.navLabel")}
          icon={<History />}
          isSelected={pathname === "/settings/history"}
        />
        <SideNavItem
          as={Link}
          href="/settings/backup"
          label={t("backup.navLabel")}
          icon={<DatabaseBackup />}
          isSelected={pathname === "/settings/backup"}
        />
      </SideNavSection>

      {SETTINGS_GROUPS.map((group) => (
        <SideNavSection key={group.id} title={settingsGroupLabel(t, group)}>
          {group.items.map((item) => {
            // Any block of the page: the keys are still recorded per block, which is also what
            // the review sheet lists them by.
            const isStaged = item.blocks.some((block) =>
              storageKeysForSection(block.id).some((key) => staged.has(key)),
            );
            return (
              <SideNavItem
                key={item.id}
                as={Link}
                href={`/settings/${item.id}`}
                label={settingsSectionName(t, item)}
                icon={<item.icon />}
                isSelected={pathname === `/settings/${item.id}`}
                // The state rides as a description, not as part of the name. A link's name is its
                // identity - "General" - and one that turned into "General staged" whenever an edit
                // was pending would stop matching everything that finds it by name, assistive
                // technology included. The description is still announced after the name.
                aria-description={isStaged ? t("homeStagedBadge") : undefined}
                endContent={isStaged ? <StagedDot /> : undefined}
              />
            );
          })}
        </SideNavSection>
      ))}
    </SideNav>
  );
}

/**
 * A section holding part of the pending change set.
 *
 * Deliberately a dot and not a count: the rail says where to look, the review sheet says what
 * changed, and a number here would only be a worse version of the one on the apply button.
 */
function StagedDot() {
  return (
    // Visual only: the item carries "staged" as its accessible description, so announcing the dot
    // too would say it twice.
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: "var(--color-warning)",
        display: "block",
      }}
    />
  );
}
