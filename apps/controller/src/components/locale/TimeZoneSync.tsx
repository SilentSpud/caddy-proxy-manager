"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE, TIME_ZONE_COOKIE_MAX_AGE, parseTimeZone } from "@/src/lib/time-zone";

/**
 * Records the browser's time zone for the server, which has no other way to learn it.
 *
 * When the page rendered in a different zone than the browser is in - the first visit, or a laptop
 * that has travelled - this writes the cookie and refreshes once, so every timestamp re-renders on
 * the server in local time. The same pattern `LocaleProvider` uses for `navigator.languages`.
 */
export function TimeZoneSync({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  // Once per mount: if the cookie cannot be stored, a refresh would come back in UTC every time.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    const detected = parseTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (!detected || detected === timeZone) return;
    attempted.current = true;
    /* biome-ignore lint/suspicious/noDocumentCookie: same reasoning as LocaleProvider - the Cookie
       Store API is Chromium-only and its async set would let router.refresh() race the write. */
    document.cookie = `${TIME_ZONE_COOKIE}=${detected}; path=/; max-age=${TIME_ZONE_COOKIE_MAX_AGE}; SameSite=Lax`;
    router.refresh();
  }, [timeZone, router]);

  return null;
}
