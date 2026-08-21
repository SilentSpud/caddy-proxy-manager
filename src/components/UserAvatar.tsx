"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import type { AvatarSize } from "@astryxdesign/core/Avatar";
import type { ResolvedAvatar } from "@/src/lib/avatar";

interface UserAvatarProps {
  /** Sources and initial, resolved on the server by resolveAvatar(). */
  avatar: ResolvedAvatar;
  /** Display name — drives the initials, the alt text, and the tooltip. */
  alt?: string;
  size?: AvatarSize;
  /** Omit the built-in tooltip where the name is already visible beside it. */
  tooltip?: boolean;
}

/**
 * Renders a user's icon, stepping down through the sources as each fails.
 *
 * Astryx's Avatar owns the whole cascade natively — `src` (their own icon),
 * then `fallbackSrc` (their Gravatar, which 404s when they have none), then
 * initials derived from the name. That replaces the manual step-down this
 * component used to run, and it covers the same failure modes: a Gravatar that
 * does not exist, a stale data URL, or a provider picture blocked by CSP.
 *
 * `avatar.initial` is still the last resort, for an account with no usable name
 * or email for Avatar to derive initials from.
 */
export function UserAvatar({ avatar, alt, size = "md", tooltip }: UserAvatarProps) {
  return (
    <Avatar
      src={avatar.imageUrl ?? undefined}
      fallbackSrc={avatar.gravatarUrl ?? undefined}
      name={alt?.trim() || avatar.initial}
      size={size}
      tooltip={tooltip}
    />
  );
}
