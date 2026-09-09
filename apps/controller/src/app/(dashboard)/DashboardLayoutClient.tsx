"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "@astryxdesign/core";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Cable,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  BarChart2,
  History,
  Settings,
  LogOut,
  Sun,
  Moon,
  FileJson2,
  Users,
  UserCog,
  Server,
} from "lucide-react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { UserAvatar } from "@/src/components/UserAvatar";
import { LocaleSwitcher } from "@/src/components/locale/LocaleSwitcher";
import { useThemeMode } from "@/src/components/theme/ThemeModeProvider";
import { formatAppVersion } from "@/src/lib/app-version";
import type { ResolvedAvatar } from "@/src/lib/avatar";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string;
};

// `labelKey` rather than a label: this is module scope, where no hook can run. Each key is
// resolved against the `nav` namespace at render.
/**
 * `adminOnly` gates the pages that answer for the whole instance. `operator` marks the three an
 * operator can also open - they show only the hosts and agents that operator's groups were
 * granted, and an operator with no grants sees them empty rather than not at all, because "you
 * have no hosts yet" explains itself and a missing menu item does not.
 */
const NAV_ITEMS = [
  { href: "/", labelKey: "overview", icon: LayoutDashboard, adminOnly: false, operator: false },
  {
    href: "/proxy-hosts",
    labelKey: "proxyHosts",
    icon: ArrowLeftRight,
    adminOnly: true,
    operator: true,
  },
  {
    href: "/l4-proxy-hosts",
    labelKey: "l4ProxyHosts",
    icon: Cable,
    adminOnly: true,
    operator: true,
  },
  { href: "/agents", labelKey: "agents", icon: Server, adminOnly: true, operator: true },
  {
    href: "/access-lists",
    labelKey: "accessLists",
    icon: KeyRound,
    adminOnly: true,
    operator: false,
  },
  { href: "/groups", labelKey: "groups", icon: Users, adminOnly: true, operator: false },
  { href: "/users", labelKey: "users", icon: UserCog, adminOnly: true, operator: false },
  {
    href: "/certificates",
    labelKey: "certificates",
    icon: ShieldCheck,
    adminOnly: true,
    operator: false,
  },
  { href: "/waf", labelKey: "waf", icon: ShieldOff, adminOnly: true, operator: false },
  { href: "/analytics", labelKey: "analytics", icon: BarChart2, adminOnly: true, operator: false },
  { href: "/audit-log", labelKey: "auditLog", icon: History, adminOnly: true, operator: false },
  { href: "/api-docs", labelKey: "apiDocs", icon: FileJson2, adminOnly: true, operator: false },
  { href: "/settings", labelKey: "settings", icon: Settings, adminOnly: true, operator: false },
] as const;

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
  children,
}: {
  user: User;
  avatar: ResolvedAvatar;
  appName: string;
  /** A newer release exists in the registry. Surfaced beside the version it replaces. */
  updateAvailable: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isAdmin = user.role === "admin";
  const isOperator = user.role === "operator";
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin || (isOperator && item.operator === true),
  );

  // Settings and Access Lists render their own full-bleed frame, so the shell
  // does not add page padding on top of it.
  const isFullBleed = pathname === "/settings" || pathname === "/access-lists";

  return (
    <AppShell
      contentPadding={isFullBleed ? 0 : 6}
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
            {visibleItems.map(({ href, labelKey, icon }) => (
              <SideNavItem
                key={href}
                as={Link}
                href={href}
                label={t(labelKey)}
                icon={icon}
                isSelected={pathname === href}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
}
