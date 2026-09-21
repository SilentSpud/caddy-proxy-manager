"use client";

/**
 * The command palette, on every dashboard page.
 *
 * It used to belong to the Settings rail and could only jump between settings sections. It now
 * lives with the dashboard layout, so ⌘K / Ctrl+K opens it anywhere, and it holds everything the
 * reader can navigate to: every page their role can open, then - for an admin - every settings
 * section, still findable by its description, its group and the environment variables it owns.
 *
 * The provider owns the open state so a button anywhere below it (either rail) can open the same
 * palette the shortcut does.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type LucideIcon, Search } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { Kbd } from "@astryxdesign/core/Kbd";
import { createStaticSource } from "@astryxdesign/core/Typeahead/utils";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { DESTINATION_ICONS } from "@/src/components/mobile/nav-icons";
import { visibleDestinations } from "@/src/lib/nav/destinations";
import {
  SETTINGS_ITEMS,
  groupForSection,
  settingsGroupLabel,
  settingsBlockName,
  settingsSectionDescription,
  settingsSectionName,
} from "@/src/app/(dashboard)/settings/sections";

type PaletteItem = {
  /** The page it opens. Unique already, so it doubles as the id selection reports back. */
  id: string;
  label: string;
  auxiliaryData: {
    /** The palette's own heading for this item; CommandPalette groups on it. */
    group: string;
    desc: string;
    /** Extra words a search can match on without them being shown. */
    keywords: string[];
    icon: LucideIcon;
  };
};

const PaletteContext = createContext<{ open: () => void }>({ open: () => {} });

/** Opens the global palette - for a search button that is not the keyboard shortcut. */
export function useCommandPalette() {
  return useContext(PaletteContext);
}

/** Opens the command palette: the rail's visible way in, beside the keyboard shortcut. */
export function PaletteSearchButton() {
  const t = useTranslations("commandPalette");
  const { open } = useCommandPalette();
  return (
    <Button
      variant="secondary"
      size="sm"
      width="100%"
      icon={<Search />}
      label={t("searchButton")}
      endContent={<Kbd keys="mod+K" />}
      onClick={open}
    />
  );
}

export function GlobalCommandPaletteProvider({
  role,
  children,
}: {
  /** The signed-in user's role: it decides which pages, and whether settings, are listed. */
  role: string | undefined;
  children: ReactNode;
}) {
  const t = useTranslations("commandPalette");
  const tNav = useTranslations("nav");
  const tSettings = useTranslations("settings");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // One toggle per press: a held shortcut repeats, and would flicker the palette open and shut.
        if (event.repeat) return;
        setIsOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Enter takes the top result when nothing is highlighted. Astryx highlights a row only once the
  // arrow keys or the pointer reach one, so "type, Enter" - the way a palette is used - otherwise
  // did nothing unless the mouse happened to rest over the list. Clicking the row goes through the
  // palette's own selection, so it closes and navigates exactly as a click would.
  useEffect(() => {
    if (!isOpen) return;
    function handler(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.isComposing) return;
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.getAttribute("role") !== "combobox") return;
      if (input.getAttribute("aria-activedescendant")) return;
      const listId = input.getAttribute("aria-controls");
      const first = listId
        ? document.getElementById(listId)?.querySelector<HTMLElement>('[role="option"]')
        : null;
      if (!first) return;
      event.preventDefault();
      event.stopPropagation();
      first.click();
    }
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isOpen]);

  // Built per render of the language rather than at module scope: the names it matches are the
  // reader's language. Environment variable names are the same in all of them.
  const searchSource = useMemo(() => {
    const pages: PaletteItem[] = visibleDestinations(role).map((destination) => ({
      id: destination.href,
      label: tNav(destination.labelKey),
      auxiliaryData: {
        group: t("groupPages"),
        desc: "",
        keywords: [destination.id],
        icon: DESTINATION_ICONS[destination.id],
      },
    }));

    // Settings are admin-only pages; listing them for anyone else would only lead to a refusal.
    const settings: PaletteItem[] =
      role === "admin"
        ? SETTINGS_ITEMS.map((item) => {
            const group = groupForSection(item.id);
            return {
              id: `/settings/${item.id}`,
              label: settingsSectionName(tSettings, item),
              auxiliaryData: {
                group: t("groupSettings"),
                desc: settingsSectionDescription(tSettings, item),
                keywords: [
                  group ? settingsGroupLabel(tSettings, group) : "",
                  // Every block's variables, and every block's name: a page is now found by
                  // anything it carries, not only by what it is called.
                  ...item.blocks.flatMap((block) => [
                    settingsBlockName(tSettings, block.id),
                    ...(block.env ?? []),
                    ...(block.envSearch ?? []),
                  ]),
                ],
                icon: item.icon,
              },
            };
          })
        : [];

    const items = [...pages, ...settings];
    return createStaticSource(items, {
      keywords: (item) => [item.auxiliaryData.desc, ...item.auxiliaryData.keywords],
    });
  }, [role, t, tNav, tSettings]);

  return (
    <PaletteContext value={{ open: () => setIsOpen(true) }}>
      {children}
      {/* Mounted only while open: closed, its search box would still sit in every page's DOM
          beside the page's own, and anything looking for "the search field" would find two. */}
      {isOpen && (
        <CommandPalette
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          label={t("label")}
          searchSource={searchSource}
          emptySearchText={t("empty")}
          onValueChange={(href) => {
            setIsOpen(false);
            router.push(href);
          }}
          renderItem={(item) => (
            <HStack gap={3} vAlign="center">
              <Icon icon={item.auxiliaryData.icon} size="sm" color="secondary" />
              <VStack gap={0}>
                <Text type="body" size="sm" weight="medium">
                  {item.label}
                </Text>
                {item.auxiliaryData.desc && (
                  <Text type="body" size="xsm" color="secondary" maxLines={1}>
                    {item.auxiliaryData.desc}
                  </Text>
                )}
              </VStack>
            </HStack>
          )}
        />
      )}
    </PaletteContext>
  );
}
