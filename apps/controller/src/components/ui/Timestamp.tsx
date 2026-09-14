"use client";

/**
 * A timestamp in the reader's time zone, with the UTC instant in a tooltip for matching it against
 * logs. The zone comes from next-intl, which the server and the browser both configure from the
 * time zone cookie (`lib/time-zone.ts`), so the two renders agree.
 */

import type { ReactNode } from "react";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { useFormatter, useNow } from "next-intl";
import { formatUtc, toDate } from "@/src/lib/date-format";

export type TimestampStyle = "dateTime" | "dateTimeShort" | "date" | "time";

/**
 * Plain Intl options without a zone: the zone is the provider's, which is the point. Not next-intl's
 * own options type, which the docs site's `next-intl` shim does not re-export.
 */
type TimestampOptions = Pick<Intl.DateTimeFormatOptions, "dateStyle" | "timeStyle">;

export const TIMESTAMP_STYLES: Record<TimestampStyle, TimestampOptions> = {
  dateTime: { dateStyle: "medium", timeStyle: "medium" },
  dateTimeShort: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
  time: { timeStyle: "medium" },
};

/** Wraps something that states a time - a sentence, a badge - in the UTC tooltip. */
export function UtcTooltip({
  value,
  children,
}: {
  value: Date | number | string;
  children: ReactNode;
}) {
  return <Tooltip content={formatUtc(value)}>{children}</Tooltip>;
}

export function Timestamp({
  value,
  style = "dateTime",
  relativeWithinMs,
}: {
  value: Date | number | string;
  style?: TimestampStyle;
  /** Say "4 hours ago" instead while the time is this recent. */
  relativeWithinMs?: number;
}) {
  const format = useFormatter();
  const now = useNow();
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return <>{String(value)}</>;

  const relative =
    relativeWithinMs !== undefined && Math.abs(now.getTime() - date.getTime()) < relativeWithinMs;
  const text = relative
    ? format.relativeTime(date, now)
    : format.dateTime(date, TIMESTAMP_STYLES[style]);
  // A relative time hides the date itself, so its tooltip carries the local time too.
  const tooltip = relative
    ? `${format.dateTime(date, TIMESTAMP_STYLES.dateTime)} · ${formatUtc(date)}`
    : formatUtc(date);

  return (
    <Tooltip content={tooltip}>
      {/* The server and the browser read the clock moments apart, so a relative time can differ
          by a second between the two renders. */}
      <time dateTime={date.toISOString()} suppressHydrationWarning>
        {text}
      </time>
    </Tooltip>
  );
}
