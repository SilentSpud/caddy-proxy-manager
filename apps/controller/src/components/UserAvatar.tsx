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

/** Renders a user's icon. Astryx's Avatar cascades `src` → `fallbackSrc` (Gravatar) → initials. */
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
