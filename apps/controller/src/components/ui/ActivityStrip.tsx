import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";

export type ActivityBucket = {
  /** Bucket label, used for the accessible description rather than drawn as an axis. */
  label: string;
  count: number;
};

/**
 * A bar per bucket, for "was anything unusual happening" at a glance.
 *
 * Drawn as divs rather than an SVG so the bars inherit the theme's colours directly and scale with
 * the container without a viewBox to keep in sync. The whole strip is one image to assistive
 * technology with the peak named, because forty individually labelled bars are noise to read
 * through and the peak is the only part anyone acts on.
 */
export function ActivityStrip({
  buckets,
  title,
  height = 34,
}: {
  buckets: ActivityBucket[];
  title: string;
  height?: number;
}) {
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const busiest = buckets.reduce(
    (best, bucket) => (bucket.count > best.count ? bucket : best),
    buckets[0] ?? { label: "", count: 0 },
  );

  return (
    <VStack gap={1} style={{ flexGrow: 1, minWidth: 0 }}>
      <HStack
        gap={1}
        vAlign="end"
        style={{ height, minWidth: 0 }}
        role="img"
        aria-label={
          peak > 0 ? `${title}. Busiest: ${busiest.label}, ${busiest.count} events.` : title
        }
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.label}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 2,
              // A bucket with events never collapses to nothing: a 1px floor keeps "one event"
              // visually distinct from "none", which is the comparison the strip exists for.
              height:
                peak === 0
                  ? 1
                  : Math.max(bucket.count === 0 ? 1 : 2, (bucket.count / peak) * height),
              borderRadius: 2,
              background:
                bucket.count === 0
                  ? "var(--color-border)"
                  : bucket.count === peak
                    ? "var(--color-border-yellow)"
                    : "var(--color-border-emphasized)",
            }}
          />
        ))}
      </HStack>
      <Text type="supporting" color="secondary">
        {title}
      </Text>
    </VStack>
  );
}
