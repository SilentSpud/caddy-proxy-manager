import type { ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

export type StatTile = {
  id: string;
  /** What the number is. Sits above it, in supporting type. */
  label: string;
  value: ReactNode;
  /** One line under the value, for the detail that makes the number actionable. */
  note?: ReactNode;
  /** A short qualifier beside the value - a trend, or what is wrong with it. */
  accent?: { label: string; variant: "neutral" | "info" | "success" | "warning" | "error" };
};

/**
 * The row of numbers a list page opens with.
 *
 * Shared because every list page answers the same first question - is anything wrong here - and a
 * row that is laid out differently on each page makes that question take longer to answer. The
 * tiles report on the whole visible set, never on the page that happens to be loaded.
 */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <Grid columns={{ minWidth: 200, max: 4 }} gap={3}>
      {tiles.map((tile) => (
        <Card key={tile.id} padding={4}>
          <VStack gap={1}>
            <Text type="supporting" color="secondary">
              {tile.label}
            </Text>
            <HStack gap={2} vAlign="center">
              <Text type="large" weight="semibold">
                {tile.value}
              </Text>
              {tile.accent && <Badge variant={tile.accent.variant} label={tile.accent.label} />}
            </HStack>
            {tile.note && (
              <Text type="supporting" color="secondary">
                {tile.note}
              </Text>
            )}
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}
