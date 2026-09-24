"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useTranslations } from "next-intl";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SearchField } from "@/components/ui/SearchField";
import type { CrsRegistryEntry } from "@/lib/crs-plugins/registry";
import {
  checkCrsPluginUpdatesAction,
  installCrsPluginAction,
  listCrsRegistryAction,
  uninstallCrsPluginAction,
  updateCrsPluginAction,
} from "./actions";
import { WafPluginFiles } from "./WafPluginFiles";

export type WafPluginRow = {
  id: number;
  name: string;
  description: string | null;
  repository: string;
  version: string;
  ruleIdStart: number;
  ruleIdEnd: number;
  configRules: string;
  beforeRules: string;
  afterRules: string;
  configOverride: string | null;
  fileNames: string[];
  updatedAt: string;
  usedGlobally: boolean;
  usedByDashboard: boolean;
  hostCount: number;
};

type RegistryRow = CrsRegistryEntry & { installedId: number | null };

/** The registry's status, as a token colour and the catalog key naming it. */
const STATUS = {
  tested: { color: "green", key: "tested" },
  "being-tested": { color: "yellow", key: "beingTested" },
  untested: { color: "gray", key: "untested" },
  draft: { color: "gray", key: "draft" },
} as const;

/** A commit sha reads as noise at full length; a tag is kept as it is. */
function shortVersion(version: string): string {
  return /^[0-9a-f]{40}$/.test(version) ? version.slice(0, 7) : version;
}

export function WafPluginsPanel({ plugins }: { plugins: WafPluginRow[] }) {
  const t = useTranslations("waf");
  const router = useRouter();
  const [registry, setRegistry] = useState<
    (CrsRegistryEntry & { installedId: number | null })[] | null
  >(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<number, string> | null>(null);
  const [checking, setChecking] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [uninstalling, setUninstalling] = useState<WafPluginRow | null>(null);
  const [query, setQuery] = useState("");
  const registryRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (
      (registry ?? [])
        .filter((entry) => entry.name.toLowerCase().includes(needle))
        // The unsupported ones last: they are listed only so their absence is explained.
        .toSorted((a, b) => Number(!!a.unsupported) - Number(!!b.unsupported))
    );
  }, [registry, query]);

  const loadRegistry = useCallback(async () => {
    setRegistryError(null);
    const result = await listCrsRegistryAction();
    if (result.status === "error") setRegistryError(result.message);
    else setRegistry(result.entries);
  }, []);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const install = async (name: string) => {
    setInstalling(name);
    try {
      const result = await installCrsPluginAction(name);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      router.refresh();
      await loadRegistry();
    } finally {
      setInstalling(null);
    }
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const result = await checkCrsPluginUpdatesAction();
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      setUpdates(result.updates);
      if (Object.keys(result.updates).length === 0) toast.success(t("pluginsUpToDate"));
    } finally {
      setChecking(false);
    }
  };

  const update = async (row: WafPluginRow) => {
    setUpdatingId(row.id);
    try {
      const result = await updateCrsPluginAction(row.id);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setUpdates((prev) => {
        if (!prev) return prev;
        const { [row.id]: _done, ...rest } = prev;
        return rest;
      });
      router.refresh();
    } finally {
      setUpdatingId(null);
    }
  };

  const usageLabels = (row: WafPluginRow) => {
    const parts: string[] = [];
    if (row.usedGlobally) parts.push(t("presetUsedGlobally"));
    if (row.usedByDashboard) parts.push(t("presetUsedByDashboard"));
    if (row.hostCount > 0) parts.push(t("presetUsedByHosts", { count: row.hostCount }));
    return parts;
  };

  const installedColumns: Column<WafPluginRow>[] = [
    {
      id: "name",
      label: t("pluginName"),
      render: (row) => (
        <VStack gap={0}>
          <Text type="body" size="sm" weight="semibold">
            {row.name}
          </Text>
          {row.description && (
            <Text type="body" size="xsm" color="secondary" maxLines={1}>
              {row.description}
            </Text>
          )}
        </VStack>
      ),
    },
    {
      id: "version",
      label: t("pluginVersion"),
      width: 200,
      render: (row) => (
        <HStack gap={1} wrap="wrap">
          <Token size="sm" label={shortVersion(row.version)} />
          {row.configOverride !== null && (
            <Token size="sm" color="blue" label={t("pluginConfigEdited")} />
          )}
          {updates?.[row.id] && (
            <Token
              size="sm"
              color="orange"
              label={t("pluginUpdateAvailable", { version: shortVersion(updates[row.id]) })}
            />
          )}
        </HStack>
      ),
    },
    {
      id: "usage",
      label: t("presetUsedBy"),
      width: 220,
      render: (row) => {
        const labels = usageLabels(row);
        return labels.length === 0 ? (
          <Text type="body" size="xsm" color="secondary">
            {t("pluginUnused")}
          </Text>
        ) : (
          <HStack gap={1} wrap="wrap">
            {labels.map((label) => (
              <Badge key={label} label={label} />
            ))}
          </HStack>
        );
      },
    },
  ];

  const registryColumns: Column<RegistryRow>[] = [
    {
      id: "name",
      label: t("pluginName"),
      render: (row) => (
        <Link
          href={row.repository}
          target="_blank"
          color={row.unsupported ? "secondary" : undefined}
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: "type",
      label: t("pluginType"),
      width: 140,
      render: (row) => (
        <Token
          size="sm"
          color={row.type === "official" ? "blue" : "default"}
          label={row.type === "official" ? t("pluginOfficial") : t("pluginThirdParty")}
          isDisabled={Boolean(row.unsupported)}
        />
      ),
    },
    {
      id: "status",
      label: t("pluginStatusColumn"),
      width: 140,
      render: (row) => (
        <Token
          size="sm"
          color={STATUS[row.status].color}
          label={t(`pluginStatus.${STATUS[row.status].key}`)}
          isDisabled={Boolean(row.unsupported)}
        />
      ),
    },
    {
      id: "range",
      label: t("pluginRuleIds"),
      width: 180,
      render: (row) => (
        <Text type="body" size="xsm" color={row.unsupported ? "disabled" : "secondary"}>
          {t("pluginRuleIdRange", { start: row.ruleIdStart, end: row.ruleIdEnd })}
        </Text>
      ),
    },
    {
      id: "install",
      label: t("actions"),
      width: 120,
      align: "right",
      render: (row) =>
        row.installedId !== null ? (
          // As tall as the Install button, so every row is the same height.
          <HStack minHeight="var(--size-element-sm)" vAlign="center" justify="end">
            <Token size="sm" color="green" label={t("pluginInstalledBadge")} />
          </HStack>
        ) : row.unsupported ? (
          <HStack minHeight="var(--size-element-sm)" vAlign="center" justify="end">
            <Tooltip content={t(`pluginUnsupportedReason.${row.unsupported}`)}>
              <Token size="sm" color="red" label={t("pluginUnsupported")} />
            </Tooltip>
          </HStack>
        ) : (
          <Button
            size="sm"
            label={t("pluginInstall")}
            isLoading={installing === row.name}
            isDisabled={installing !== null && installing !== row.name}
            onClick={() => void install(row.name)}
          />
        ),
    },
  ];

  return (
    // gap 10 rather than the list pages' 6: two cards stacked need more air between them than a
    // header and its table do.
    <VStack gap={10}>
      <Card>
        <VStack gap={4}>
          <HStack justify="between" vAlign="start" gap={3} wrap="wrap">
            <VStack gap={1}>
              <Heading level={2}>{t("plugins")}</Heading>
              <Text type="body" size="sm" color="secondary">
                {t("pluginsDescription")}
              </Text>
            </VStack>
            {plugins.length > 0 && (
              <Button
                icon={<RefreshCw />}
                label={t("pluginsCheckUpdates")}
                isLoading={checking}
                onClick={() => void checkUpdates()}
              />
            )}
          </HStack>
          {plugins.length === 0 ? (
            <EmptyState title={t("pluginsEmptyTitle")} description={t("pluginsEmptyDescription")} />
          ) : (
            <DataTable
              columns={installedColumns}
              data={plugins}
              keyField="id"
              expandOnRowClick
              expandedRow={(row) => (
                <WafPluginFiles
                  plugin={row}
                  update={
                    updates?.[row.id]
                      ? {
                          version: shortVersion(updates[row.id]),
                          isUpdating: updatingId === row.id,
                          onUpdate: () => void update(row),
                        }
                      : null
                  }
                  onUninstall={() => setUninstalling(row)}
                />
              )}
            />
          )}
        </VStack>
      </Card>

      <Card>
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>{t("pluginRegistry")}</Heading>
            <Text type="body" size="sm" color="secondary">
              {t("pluginRegistryDescription")}
            </Text>
          </VStack>
          {registryError ? (
            <Banner
              status="error"
              title={registryError}
              endContent={
                <Button
                  size="sm"
                  label={t("pluginRegistryRetry")}
                  onClick={() => void loadRegistry()}
                />
              }
            />
          ) : registry === null ? (
            <Text type="body" size="sm" color="secondary">
              {t("pluginRegistryLoading")}
            </Text>
          ) : (
            <VStack gap={4}>
              <SearchField
                value={query}
                onChange={setQuery}
                label={t("pluginRegistrySearch")}
                placeholder={t("pluginRegistrySearchPlaceholder")}
                width="100%"
              />
              <DataTable
                columns={registryColumns}
                data={registryRows}
                keyField="name"
                emptyMessage={t("pluginRegistryNoMatches")}
              />
            </VStack>
          )}
        </VStack>
      </Card>

      <AlertDialog
        isOpen={uninstalling !== null}
        onOpenChange={(open) => !open && setUninstalling(null)}
        title={t("pluginUninstall")}
        description={uninstalling ? t("pluginUninstallConfirm", { name: uninstalling.name }) : ""}
        actionLabel={t("pluginUninstall")}
        onAction={async () => {
          if (!uninstalling) return;
          const result = await uninstallCrsPluginAction(uninstalling.id);
          setUninstalling(null);
          if (result.status === "error") {
            toast.error(result.message);
            return;
          }
          toast.success(result.message);
          router.refresh();
          await loadRegistry();
        }}
      />
    </VStack>
  );
}
