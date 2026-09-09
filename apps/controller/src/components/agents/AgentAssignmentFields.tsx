"use client";

/**
 * Which agents serve this host.
 *
 * Nothing ticked means every agent, which is what a host had before it could be assigned at all -
 * so the empty state is the safe one, and the banner says so out loud rather than leaving an
 * operator to guess whether an unticked list means "everywhere" or "nowhere".
 */

import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";

export type AgentOption = {
  id: number;
  name: string;
  connected: boolean;
  hasOwnBuildSettings: boolean;
};

export function AgentAssignmentFields({
  agents = [],
  selected = [],
}: {
  agents?: AgentOption[];
  selected?: number[];
}) {
  const t = useTranslations("agents");
  const [selectedIds, setSelectedIds] = useState<number[]>(selected);

  // Nothing to place it on. Rendering the card anyway would be one more thing to read on a form
  // that is already long, but the marker still goes out: without it an edit that clears the list
  // is indistinguishable from a form that never carried the field.
  if (agents.length === 0) {
    return <input type="hidden" name="agentAssignmentPresent" value="1" />;
  }

  return (
    <Card>
      {/* The marker, not the values, for the reason above. */}
      <input type="hidden" name="agentAssignmentPresent" value="1" />
      {selectedIds.map((id) => (
        <input key={`agent-${id}`} type="hidden" name="agentId" value={String(id)} />
      ))}

      <VStack gap={4}>
        <VStack gap={1}>
          <Text type="body" size="sm" weight="semibold">
            {t("assignment")}
          </Text>
          <Text type="body" size="sm" color="secondary">
            {t("assignmentDescription")}
          </Text>
        </VStack>

        <CheckboxList
          label={t("assignedAgents")}
          hasDividers
          value={selectedIds.map(String)}
          onChange={(values) => setSelectedIds(values.map(Number))}
        >
          {agents.map((agent) => (
            <CheckboxListItem
              key={agent.id}
              value={String(agent.id)}
              label={agent.name}
              description={agent.connected ? t("connected") : t("notConnected")}
              endContent={
                agent.hasOwnBuildSettings ? <Badge label={t("ownBuildBadge")} /> : undefined
              }
            />
          ))}
        </CheckboxList>

        {selectedIds.length === 0 && (
          <Banner status="info" title={t("assignedToAll")} description={t("assignedToAllHelp")} />
        )}
      </VStack>
    </Card>
  );
}
