"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ResolvedAvatar } from "@/src/lib/avatar";

interface UserAvatarProps {
  /** Sources and initial, resolved on the server by resolveAvatar(). */
  avatar: ResolvedAvatar;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Renders a user's icon, stepping down through the available sources as each
 * one fails to load.
 *
 * Radix's Avatar only falls back once — from a single image to the fallback
 * node — so it cannot express "custom icon, then Gravatar, then initial" on its
 * own. Tracking which sources have failed and feeding it one `src` at a time
 * does, and it covers every reason a source can fail: a Gravatar that does not
 * exist (the URL asks for a 404), a stale data URL, or a provider picture the
 * Content-Security-Policy blocks.
 */
export function UserAvatar({ avatar, alt, className, fallbackClassName }: UserAvatarProps) {
  const sources = [avatar.imageUrl, avatar.gravatarUrl].filter(
    (source): source is string => Boolean(source)
  );

  const [failedCount, setFailedCount] = useState(0);

  // A different user (or a freshly uploaded icon) means the previous failures
  // say nothing about the new sources.
  useEffect(() => {
    setFailedCount(0);
  }, [avatar.imageUrl, avatar.gravatarUrl]);

  const currentSource = sources[failedCount];

  return (
    <Avatar className={className}>
      {currentSource && (
        // Keyed by source so React remounts on step-down; without it the img
        // keeps the failed element's error state and never retries.
        <AvatarImage
          key={currentSource}
          src={currentSource}
          alt={alt}
          onError={() => setFailedCount((count) => count + 1)}
        />
      )}
      <AvatarFallback className={cn("bg-primary text-primary-foreground", fallbackClassName)}>
        {avatar.initial}
      </AvatarFallback>
    </Avatar>
  );
}
