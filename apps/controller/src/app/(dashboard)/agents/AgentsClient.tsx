"use client";

/**
 * The agents this viewer may see, and the two things they may do to one.
 *
 * An admin sees every paired agent; an operator sees the ones their groups were granted. The row
 * says which hosts are pinned to the agent, but not how many it actually serves - every unassigned
 * host lands on all of them, and a number that quietly folded those in would look wrong the moment
 * someone counted.
 */

import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { AppDialog } from "@/components/ui/AppDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Fab } from "@/src/components/mobile/Fab";
import { StatusChip } from "@/components/ui/StatusChip";
import { StatTiles } from "@/components/ui/StatTiles";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { LogAccessFix } from "@/src/lib/agent/log-access";
import { rebuildAgentCaddyAction, renameAgentAction } from "./actions";

export type AgentRow = {
  id: number;
  name: string;
  enabled: boolean;
  connected: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  version: string | null;
  buildState: string;
  buildMessage: string | null;
  hasOwnBuildSettings: boolean;
  assignedHttpHosts: number;
  assignedL4Hosts: number;
  canManage: boolean;
  /** Log permission problems the agent reported, each with the command that fixes it. */
  logAccessFixes: LogAccessFix[];
};

/**
 * Relative where that is the useful reading - an agent seen four hours ago is the thing worth
 * noticing - and absolute once it is old enough that "14 days ago" stops meaning anything.
 * Client-side, because the server does not know the reader's timezone, and through Intl so the
 * wording follows the reader's locale rather than being English baked into the component.
 */
function formatLastSeen(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const seconds = Math.round((at.getTime() - Date.now()) / 1000);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return relative.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function AgentsClient({
  agents,
  anyPaired,
  isAdmin,
}: {
  agents: AgentRow[];
  anyPaired: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("agents");
  const router = useRouter();

  function describeFix(fix: LogAccessFix): string {
    const values = { path: fix.path, gid: fix.gid };
    switch (fix.kind) {
      case "groupMismatch":
        return t("logAccessGroupMismatch", values);
      case "unreadable":
        return t("logAccessUnreadable", values);
      case "notTruncatable":
        return t("logAccessNotTruncatable", values);
      case "cleanupBlocked":
        return t("logAccessCleanupBlocked", values);
    }
  }
  const [renaming, setRenaming] = useState<AgentRow | null>(null);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const connectedCount = agents.filter((agent) => agent.connected).length;
  const ownBuildCount = agents.filter((agent) => agent.hasOwnBuildSettings).length;
  // Pinned, not served: an unassigned host runs on every agent, and folding those in would give a
  // number nobody could reconcile against the host list.
  const pinnedHosts = agents.reduce(
    (sum, agent) => sum + agent.assignedHttpHosts + agent.assignedL4Hosts,
    0,
  );
  // One version across the fleet is the answer people want; anything else is the problem.
  const versions = new Set(agents.map((agent) => agent.version).filter(Boolean));
  const versionLabel =
    versions.size === 0 ? "-" : versions.size === 1 ? `v${[...versions][0]}` : `${versions.size}`;

  async function rebuild(agent: AgentRow) {
    setBusyId(agent.id);
    setMessage(null);
    const result = await rebuildAgentCaddyAction(agent.id);
    setBusyId(null);
    setMessage({ ok: result.status === "success", text: result.message ?? "" });
    router.refresh();
  }

  async function submitRename() {
    if (!renaming) return;
    const data = new FormData();
    data.set("name", newName);
    const result = await renameAgentAction(renaming.id, undefined, data);
    setMessage({ ok: result.status === "success", text: result.message ?? "" });
    setRenaming(null);
    router.refresh();
  }

  return (
    <VStack gap={6}>
      <PageHeader title={t("title")} description={t("pageDescription")} />
      {/* Pairing lives in Settings behind requireAdmin, so only an admin is offered the way there. */}
      {isAdmin && <Fab label={t("pairAgent")} href="/settings/agent" />}

      {message?.text && <Banner status={message.ok ? "success" : "error"} title={message.text} />}

      {agents.length === 0 && (
        <EmptyState
          title={t("noneTitle")}
          description={anyPaired && !isAdmin ? t("noneGrantedDescription") : t("noneDescription")}
        />
      )}

      {agents.length > 0 && (
        <StatTiles
          tiles={[
            {
              id: "agents",
              label: t("title"),
              value: agents.length,
              note: t("pinnedHostsNote", { count: pinnedHosts }),
            },
            {
              id: "connected",
              label: t("connected"),
              value: connectedCount,
              note: t("connectedNote", { count: agents.length }),
              accent:
                connectedCount < agents.length
                  ? {
                      label: t("offlineAccent", { count: agents.length - connectedCount }),
                      variant: "warning" as const,
                    }
                  : undefined,
            },
            {
              id: "builds",
              label: t("buildSelection"),
              value: ownBuildCount,
              note: t("ownBuildNote", { count: agents.length - ownBuildCount }),
            },
            {
              id: "versions",
              label: t("version"),
              value: versionLabel,
              note: t("versionNote"),
            },
          ]}
        />
      )}

      <Grid columns={{ minWidth: 340, max: 3 }} gap={4}>
        {agents.map((agent) => (
          <Card key={agent.id} padding={4}>
            <VStack gap={3}>
              <HStack justify="between" vAlign="center" gap={4} wrap="wrap">
                <VStack gap={1}>
                  <Heading level={2}>{agent.name}</Heading>
                  <Text type="body" size="sm" color="secondary">
                    {agent.version ? `v${agent.version}` : t("never")}
                  </Text>
                </VStack>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <StatusChip
                    status={agent.connected ? "active" : "inactive"}
                    label={agent.connected ? t("connected") : t("notConnected")}
                  />
                  <Badge label={agent.hasOwnBuildSettings ? t("ownBuild") : t("fleetBuild")} />
                  {agent.canManage && (
                    <>
                      <Button
                        label={t("rename")}
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setRenaming(agent);
                          setNewName(agent.name);
                        }}
                      />
                      <Button
                        label={t("rebuild")}
                        size="sm"
                        isDisabled={!agent.connected || busyId === agent.id}
                        onClick={() => void rebuild(agent)}
                      />
                    </>
                  )}
                </HStack>
              </HStack>

              <Divider />

              <HStack gap={6} wrap="wrap">
                <VStack gap={0}>
                  <Text type="body" size="xsm" color="secondary">
                    {t("assignedHosts")}
                  </Text>
                  <Text type="body" size="sm">
                    {agent.assignedHttpHosts + agent.assignedL4Hosts}
                  </Text>
                </VStack>
                <VStack gap={0}>
                  <Text type="body" size="xsm" color="secondary">
                    {t("buildState")}
                  </Text>
                  <Text type="body" size="sm">
                    {agent.buildState}
                  </Text>
                </VStack>
                <VStack gap={0}>
                  <Text type="body" size="xsm" color="secondary">
                    {t("lastSeen")}
                  </Text>
                  <Text type="body" size="sm">
                    {formatLastSeen(agent.lastSeenAt) ?? t("never")}
                  </Text>
                </VStack>
              </HStack>

              <Text type="body" size="xsm" color="secondary">
                {t("unassignedHint")}
              </Text>

              {agent.lastError && <Banner status="warning" title={agent.lastError} />}
              {agent.logAccessFixes.length > 0 && (
                <Banner status="warning" title={t("logAccessTitle")}>
                  <VStack gap={3}>
                    {agent.logAccessFixes.map((fix) => (
                      <VStack key={`${fix.kind}:${fix.path}`} gap={1}>
                        <Text type="body" size="sm">
                          {describeFix(fix)}
                        </Text>
                        {/* CodeBlock owns the copy button. */}
                        <CodeBlock code={fix.command} width="100%" />
                      </VStack>
                    ))}
                  </VStack>
                </Banner>
              )}
              {agent.buildMessage && <Banner status="info" title={agent.buildMessage} />}
            </VStack>
          </Card>
        ))}
      </Grid>

      {renaming && (
        <AppDialog
          open
          onClose={() => setRenaming(null)}
          title={t("renameTitle")}
          submitLabel={t("rename")}
          onSubmit={() => void submitRename()}
        >
          <TextInput label={t("name")} value={newName} onChange={setNewName} isRequired />
        </AppDialog>
      )}
    </VStack>
  );
}
