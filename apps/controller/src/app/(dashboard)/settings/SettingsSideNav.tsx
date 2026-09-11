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
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Kbd } from "@astryxdesign/core/Kbd";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { ArrowLeft, LayoutGrid, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { createStaticSource } from "@astryxdesign/core/Typeahead/utils";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useState } from "react";
import { SETTINGS_GROUPS, SETTINGS_ITEMS, groupForSection } from "./sections";
import { storageKeysForSection } from "@/src/lib/settings/section-keys";

type PaletteItem = {
  id: string;
  label: string;
  auxiliaryData: { desc: string; group: string; env: string[] };
};

const PALETTE_ITEMS: PaletteItem[] = SETTINGS_ITEMS.map((item) => ({
  id: item.id,
  label: item.name,
  auxiliaryData: {
    desc: item.desc,
    group: groupForSection(item.id)?.label ?? "",
    env: [...(item.env ?? []), ...(item.envSearch ?? [])],
  },
}));

// Keywords let a search match a setting's description or its group - and its environment
// variables, so an operator who knows a setting only as the line in their `.env` can search for
// that name and land on the page that owns it.
const PALETTE_SOURCE = createStaticSource(PALETTE_ITEMS, {
  keywords: (item) => [
    item.auxiliaryData.desc,
    item.auxiliaryData.group,
    ...item.auxiliaryData.env,
  ],
});

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
  const router = useRouter();
  const staged = new Set(stagedKeys);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The shortcut binds here rather than in the page, because the palette moved into the rail with
  // the rest of navigation - and the rail is mounted on every settings route.
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <SideNav footer={footer}>
      <VStack gap={2} padding={2}>
        <SideNavItem as={Link} href="/" label={t("backToDashboard")} icon={<ArrowLeft />} />
        <Button
          variant="secondary"
          size="sm"
          width="100%"
          icon={<Search />}
          label={t("settingsSearchButtonLabel")}
          endContent={<Kbd keys="mod+K" />}
          onClick={() => setPaletteOpen(true)}
        />
      </VStack>

      <SideNavSection title={tNav("settings")} isHeaderHidden>
        <SideNavItem
          as={Link}
          href="/settings"
          label={t("homeOverview")}
          icon={<LayoutGrid />}
          isSelected={pathname === "/settings"}
        />
      </SideNavSection>

      {SETTINGS_GROUPS.map((group) => (
        <SideNavSection key={group.id} title={group.label}>
          {group.items.map((item) => (
            <SideNavItem
              key={item.id}
              as={Link}
              href={`/settings/${item.id}`}
              label={item.name}
              icon={<item.icon />}
              isSelected={pathname === `/settings/${item.id}`}
              endContent={
                storageKeysForSection(item.id).some((key) => staged.has(key)) ? (
                  <StagedDot />
                ) : undefined
              }
            />
          ))}
        </SideNavSection>
      ))}

      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        label={t("settingsSearchLabel")}
        searchSource={PALETTE_SOURCE}
        emptySearchText="No settings match your search."
        onValueChange={(id) => {
          router.push(`/settings/${id}`);
          setPaletteOpen(false);
        }}
        renderItem={(item) => (
          <VStack gap={0}>
            <Text type="body" size="sm" weight="medium">
              {item.label}
            </Text>
            <Text type="body" size="xsm" color="secondary" maxLines={1}>
              {item.auxiliaryData.desc}
            </Text>
          </VStack>
        )}
      />
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
  const t = useTranslations("settings");
  return (
    <span
      role="img"
      aria-label={t("homeStagedBadge")}
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
