"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "@astryxdesign/core";
import { LogOut, Sun, Moon } from "lucide-react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import SettingsSideNav from "./settings/SettingsSideNav";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { UserAvatar } from "@/src/components/UserAvatar";
import { LocaleSwitcher } from "@/src/components/locale/LocaleSwitcher";
import { MobileTabBar } from "@/src/components/mobile/MobileTabBar";
import { MoreDrawer } from "@/src/components/mobile/MoreDrawer";
import { DESTINATION_ICONS } from "@/src/components/mobile/nav-icons";
import { useThemeMode } from "@/src/components/theme/ThemeModeProvider";
import { formatAppVersion } from "@/src/lib/app-version";
import type { ResolvedAvatar } from "@/src/lib/avatar";
import {
  type DestinationId,
  moreDestinations,
  resolveDrawer,
  visibleDestinations,
} from "@/src/lib/nav/destinations";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string;
};

/** The same edge DataTable uses for its card view, so the phone layout switches in one place. */
const NARROW = "(max-width: 767px)";

function ThemeToggle() {
  // Astryx's useTheme reports the *resolved* mode, so "system" already reads as
  // light or dark here and tracks the OS if it changes. Clicking pins the
  // opposite mode, which is what leaves "system" behind.
  const t = useTranslations("common.theme");
  const { mode } = useTheme();
  const { setMode } = useThemeMode();
  const isDark = mode === "dark";
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={isDark ? t("toLight") : t("toDark")}
      icon={isDark ? <Moon /> : <Sun />}
      onClick={() => setMode(isDark ? "light" : "dark")}
    />
  );
}

function SignOutButton() {
  const t = useTranslations("common");
  return (
    <form action="/api/auth/logout" method="POST">
      <IconButton variant="ghost" size="sm" label={t("signOut")} icon={<LogOut />} type="submit" />
    </form>
  );
}

/** The signed-in user, shown in the SideNav footer as a link to their profile. */
function UserFooter({ user, avatar }: { user: User; avatar: ResolvedAvatar }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const { closeMobileNav } = useAppShellMobile();

  return (
    <HStack gap={2} vAlign="center" justify="between" width="100%">
      <HStack
        gap={2}
        vAlign="center"
        as="button"
        onClick={() => {
          router.push("/profile");
          closeMobileNav();
        }}
      >
        <UserAvatar avatar={avatar} alt={user.name ?? t("avatarAlt")} size="sm" />
        <VStack hAlign="start">
          <Text type="body" size="sm" weight="medium" maxLines={1}>
            {user.name ?? t("defaultUserName")}
          </Text>
          <Text type="body" size="xsm" color="secondary" maxLines={1}>
            {user.email}
          </Text>
        </VStack>
      </HStack>
      <HStack gap={1} vAlign="center">
        <LocaleSwitcher />
        <ThemeToggle />
        <SignOutButton />
      </HStack>
    </HStack>
  );
}

export default function DashboardLayoutClient({
  user,
  avatar,
  appName,
  updateAvailable,
  stagedKeys,
  morePins,
  children,
}: {
  user: User;
  avatar: ResolvedAvatar;
  appName: string;
  /** A newer release exists in the registry. Surfaced beside the version it replaces. */
  updateAvailable: boolean;
  /** Settings keys this operator has staged, so the settings rail can mark their sections. */
  stagedKeys: readonly string[];
  /** The pages this user keeps in the mobile More drawer, or null if they never customized it. */
  morePins: readonly DestinationId[] | null;
  children: ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isNarrow = useMediaQuery(NARROW);
  // Open on the path it was opened on. Any navigation - a tile, a tab, the browser's back button -
  // leaves that path, so the move itself closes the drawer, with no effect to keep in step.
  const [moreOpenOn, setMoreOpenOn] = useState<string | null>(null);
  const isMoreOpen = moreOpenOn === pathname;
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  // Profile is reached from the rail's footer on a desktop; it only needs a row of its own on a
  // phone, where there is no footer.
  const railItems = visibleDestinations(user.role).filter((d) => d.id !== "profile");
  const drawerItems = resolveDrawer(morePins, user.role);

  const closeMore = useCallback(() => setMoreOpenOn(null), []);
  const toggleMore = useCallback(
    () => setMoreOpenOn((openOn) => (openOn === pathname ? null : pathname)),
    [pathname],
  );

  // Settings renders its own header and padding; Access Lists its own full-bleed frame.
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isFullBleed = inSettings || pathname === "/access-lists";

  // On a phone the tab bar is the navigation, so AppShell's hamburger drawer is switched off
  // rather than left as a second way to do the same thing.
  const mobileChrome = isNarrow ? (
    <>
      <MoreDrawer
        isOpen={isMoreOpen}
        onClose={closeMore}
        items={drawerItems}
        totalPages={moreDestinations(user.role).length}
        offerCustomize={morePins === null}
        returnFocusRef={moreButtonRef}
      />
      <MobileTabBar
        role={user.role}
        isMoreOpen={isMoreOpen}
        onToggleMore={toggleMore}
        onCloseMore={closeMore}
        moreButtonRef={moreButtonRef}
      />
    </>
  ) : null;
  const content = <div className="cpm-mobile-content">{children}</div>;

  // Settings takes the rail over rather than nesting its own panel inside the page. One rail, and
  // its first row is the way back - see ./settings/SettingsSideNav.tsx.
  if (inSettings) {
    return (
      <>
        <AppShell
          contentPadding={0}
          mobileNav={false}
          sideNav={
            <SettingsSideNav
              footer={<UserFooter user={user} avatar={avatar} />}
              stagedKeys={stagedKeys}
            />
          }
        >
          {content}
        </AppShell>
        {mobileChrome}
      </>
    );
  }

  return (
    <>
      <AppShell
        contentPadding={isFullBleed ? 0 : 6}
        mobileNav={false}
        sideNav={
          <SideNav
            header={
              <SideNavHeading
                heading={appName}
                headingHref="/"
                subheading={formatAppVersion()}
                // Beside the version rather than as a banner: this is the number the notice is
                // about, and an operator who does not want to act on it should not have to dismiss
                // anything. The link goes to where it can be acted on or switched off.
                subheadingHref={updateAvailable ? "/settings" : undefined}
                headerEndContent={
                  updateAvailable ? <Badge variant="warning" label={t("updateBadge")} /> : undefined
                }
                icon={
                  <NavIcon
                    icon={
                      <Text type="body" size="xsm" weight="bold">
                        C
                      </Text>
                    }
                  />
                }
              />
            }
            footer={<UserFooter user={user} avatar={avatar} />}
          >
            <SideNavSection title={t("sectionLabel")} isHeaderHidden>
              {railItems.map(({ id, href, labelKey }) => (
                <SideNavItem
                  key={href}
                  as={Link}
                  href={href}
                  label={t(labelKey)}
                  icon={DESTINATION_ICONS[id]}
                  isSelected={pathname === href}
                />
              ))}
            </SideNavSection>
          </SideNav>
        }
      >
        {content}
      </AppShell>
      {mobileChrome}
    </>
  );
}
