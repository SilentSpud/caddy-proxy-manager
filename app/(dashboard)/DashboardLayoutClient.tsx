"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, ArrowLeftRight, Cable, KeyRound, ShieldCheck,
  ShieldOff, BarChart2, History, Settings, LogOut, Sun, Moon,
  FileJson2, Users, UserCog,
} from "lucide-react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { UserAvatar } from "@/src/components/UserAvatar";
import type { ResolvedAvatar } from "@/src/lib/avatar";

type User = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string;
};

const NAV_ITEMS = [
  { href: "/",               label: "Overview",       icon: LayoutDashboard, adminOnly: false },
  { href: "/proxy-hosts",    label: "Proxy Hosts",    icon: ArrowLeftRight,  adminOnly: true  },
  { href: "/l4-proxy-hosts", label: "L4 Proxy Hosts", icon: Cable,           adminOnly: true  },
  { href: "/access-lists",   label: "Access Lists",   icon: KeyRound,        adminOnly: true  },
  { href: "/groups",         label: "Groups",         icon: Users,           adminOnly: true  },
  { href: "/users",          label: "Users",          icon: UserCog,         adminOnly: true  },
  { href: "/certificates",   label: "Certificates",   icon: ShieldCheck,     adminOnly: true  },
  { href: "/waf",            label: "WAF",            icon: ShieldOff,       adminOnly: true  },
  { href: "/analytics",      label: "Analytics",      icon: BarChart2,       adminOnly: true  },
  { href: "/audit-log",      label: "Audit Log",      icon: History,         adminOnly: true  },
  { href: "/api-docs",       label: "API Docs",       icon: FileJson2,       adminOnly: true  },
  { href: "/settings",       label: "Settings",       icon: Settings,        adminOnly: true  },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      icon={isDark ? <Moon /> : <Sun />}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    />
  );
}

function SignOutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <IconButton variant="ghost" size="sm" label="Sign out" icon={<LogOut />} type="submit" />
    </form>
  );
}

/** The signed-in user, shown in the SideNav footer as a link to their profile. */
function UserFooter({ user, avatar }: { user: User; avatar: ResolvedAvatar }) {
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
        <UserAvatar avatar={avatar} alt={user.name ?? "User"} size="sm" />
        <VStack hAlign="start">
          <Text type="body" size="sm" weight="medium" maxLines={1}>
            {user.name ?? "Administrator"}
          </Text>
          <Text type="body" size="xsm" color="secondary" maxLines={1}>
            {user.email}
          </Text>
        </VStack>
      </HStack>
      <HStack gap={1} vAlign="center">
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
  children,
}: {
  user: User;
  avatar: ResolvedAvatar;
  appName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = user.role === "admin";
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

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
              icon={<NavIcon icon={<Text type="body" size="xsm" weight="bold">C</Text>} />}
            />
          }
          footer={<UserFooter user={user} avatar={avatar} />}
        >
          <SideNavSection title="Navigation" isHeaderHidden>
            {visibleItems.map(({ href, label, icon }) => (
              <SideNavItem
                key={href}
                as={Link}
                href={href}
                label={label}
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
