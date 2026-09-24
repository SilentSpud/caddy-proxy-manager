import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { crsPlugins, proxyHosts } from "../db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { domainError } from "../domain-error";
import { type CrsPluginRules, findCrsPluginRejections, normalizeWafPluginIds } from "../caddy-waf";
import {
  type CrsRegistryEntry,
  type Fetcher,
  assertCrsPluginRulesLoadable,
  fetchCrsPluginRelease,
  fetchCrsRegistry,
  resolveCrsPluginVersion,
} from "../crs-plugins/registry";
import { getDashboardSettings, getWafSettings } from "../settings";

// ── Types ────────────────────────────────────────────────────────────

export type CrsPlugin = {
  id: number;
  name: string;
  repository: string;
  version: string;
  description: string | null;
  ruleIdStart: number;
  ruleIdEnd: number;
  configRules: string;
  beforeRules: string;
  afterRules: string;
  /** The operator's -config file, or null while the upstream one runs. */
  configOverride: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Where a plugin is selected, shaped like a preset's. */
export type CrsPluginUsage = {
  global: boolean;
  dashboard: boolean;
  hosts: { id: number; name: string }[];
};

type PluginRow = typeof crsPlugins.$inferSelect;

function toCrsPlugin(row: PluginRow): CrsPlugin {
  return {
    id: row.id,
    name: row.name,
    repository: row.repository,
    version: row.version,
    description: row.description,
    ruleIdStart: row.ruleIdStart,
    ruleIdEnd: row.ruleIdEnd,
    configRules: row.configRules,
    beforeRules: row.beforeRules,
    afterRules: row.afterRules,
    configOverride: row.configOverride,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

/** What a host form's picker needs. */
export function toCrsPluginOption(plugin: CrsPlugin): {
  id: number;
  name: string;
  description: string | null;
} {
  return { id: plugin.id, name: plugin.name, description: plugin.description };
}

// ── Reads ────────────────────────────────────────────────────────────

export async function listCrsPlugins(): Promise<CrsPlugin[]> {
  const rows = await db.query.crsPlugins.findMany({ orderBy: (table) => asc(table.name) });
  return rows.map(toCrsPlugin);
}

export async function getCrsPlugin(id: number): Promise<CrsPlugin | null> {
  const row = await db.query.crsPlugins.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  return row ? toCrsPlugin(row) : null;
}

/**
 * id -> rule files, for the Caddy builder. Every write is checked already; a row that fails anyway
 * is left out whole, since half a plugin can leave its exclusions on with its guards gone.
 */
export async function getCrsPluginRules(): Promise<Map<number, CrsPluginRules>> {
  const rules = new Map<number, CrsPluginRules>();
  for (const row of await db.select().from(crsPlugins)) {
    const plugin: CrsPluginRules = {
      config: row.configOverride ?? row.configRules,
      before: row.beforeRules,
      after: row.afterRules,
    };
    const range = { start: row.ruleIdStart, end: row.ruleIdEnd };
    const loadable = Object.values(plugin).every(
      (text) => findCrsPluginRejections(text, range).length === 0,
    );
    if (loadable) rules.set(row.id, plugin);
  }
  return rules;
}

function pluginIdsInMeta(meta: string | null): number[] {
  if (!meta) return [];
  try {
    return normalizeWafPluginIds(
      (JSON.parse(meta) as { waf?: { plugin_ids?: unknown } })?.waf?.plugin_ids,
    );
  } catch {
    return [];
  }
}

/** Where each plugin is selected, keyed by plugin id. Plugins selected nowhere are absent. */
export async function getCrsPluginUsage(): Promise<Map<number, CrsPluginUsage>> {
  const [global, dashboard, hosts] = await Promise.all([
    getWafSettings(),
    getDashboardSettings(),
    db.select({ id: proxyHosts.id, name: proxyHosts.name, meta: proxyHosts.meta }).from(proxyHosts),
  ]);
  const usage = new Map<number, CrsPluginUsage>();
  const entry = (id: number) => {
    const found = usage.get(id) ?? { global: false, dashboard: false, hosts: [] };
    usage.set(id, found);
    return found;
  };
  for (const id of normalizeWafPluginIds(global?.plugin_ids)) entry(id).global = true;
  for (const id of pluginIdsInMeta(dashboard?.options?.meta ?? null)) entry(id).dashboard = true;
  for (const host of hosts) {
    for (const id of pluginIdsInMeta(host.meta))
      entry(id).hosts.push({ id: host.id, name: host.name });
  }
  return usage;
}

/** Throws unless every id names an installed plugin, so a selection never emits nothing. */
export async function assertCrsPluginIdsExist(ids: readonly number[] | undefined): Promise<void> {
  if (!ids || ids.length === 0) return;
  const rows = await db
    .select({ id: crsPlugins.id })
    .from(crsPlugins)
    .where(inArray(crsPlugins.id, [...ids]));
  const known = new Set(rows.map((row) => row.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw domainError("crsPluginUnknownIds", { ids: unknown.map(String) }, { status: 400 });
  }
}

/** The registry, each entry marked with the id it is installed under. */
export async function listCrsRegistry(
  fetcher?: Fetcher,
): Promise<(CrsRegistryEntry & { installedId: number | null })[]> {
  const [entries, installed] = await Promise.all([fetchCrsRegistry(fetcher), listCrsPlugins()]);
  const byName = new Map(installed.map((plugin) => [plugin.name, plugin.id]));
  return entries.map((entry) => ({ ...entry, installedId: byName.get(entry.name) ?? null }));
}

async function registryEntry(name: string, fetcher?: Fetcher): Promise<CrsRegistryEntry> {
  const entry = (await fetchCrsRegistry(fetcher)).find((candidate) => candidate.name === name);
  if (!entry) throw domainError("crsPluginNotInRegistry", { name }, { status: 404 });
  return entry;
}

/** id -> the latest version upstream, for plugins that have a newer one than installed. */
export async function checkCrsPluginUpdates(fetcher?: Fetcher): Promise<Map<number, string>> {
  const updates = new Map<number, string>();
  for (const plugin of await listCrsPlugins()) {
    const latest = await resolveCrsPluginVersion(plugin, fetcher);
    if (latest !== plugin.version) updates.set(plugin.id, latest);
  }
  return updates;
}

// ── Writes ───────────────────────────────────────────────────────────

export async function installCrsPlugin(
  name: string,
  actorUserId: number,
  fetcher?: Fetcher,
): Promise<CrsPlugin> {
  const existing = await db.query.crsPlugins.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.name, name),
  });
  if (existing) throw domainError("crsPluginAlreadyInstalled", { name }, { status: 409 });

  const entry = await registryEntry(name, fetcher);
  const version = await resolveCrsPluginVersion(entry, fetcher);
  const release = await fetchCrsPluginRelease(entry, version, fetcher);
  const now = nowIso();
  const [record] = await db
    .insert(crsPlugins)
    .values({
      name: entry.name,
      repository: entry.repository,
      version: release.version,
      description: release.description,
      ruleIdStart: entry.ruleIdStart,
      ruleIdEnd: entry.ruleIdEnd,
      configRules: release.configRules,
      beforeRules: release.beforeRules,
      afterRules: release.afterRules,
      configOverride: null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "crs_plugin",
    entityId: record.id,
    summary: `Installed CRS plugin ${entry.name} ${release.version}`,
  });

  // Nothing selects a new plugin yet, so there is no config to apply.
  return toCrsPlugin(record);
}

async function applyIfSelected(id: number): Promise<void> {
  if ((await getCrsPluginUsage()).has(id)) await applyCaddyConfig();
}

/** Re-fetches at the latest version. The operator's config edit is kept. */
export async function updateCrsPlugin(
  id: number,
  actorUserId: number,
  fetcher?: Fetcher,
): Promise<CrsPlugin> {
  const existing = await getCrsPlugin(id);
  if (!existing) throw domainError("crsPluginNotFound", {}, { status: 404 });

  const entry = await registryEntry(existing.name, fetcher);
  const version = await resolveCrsPluginVersion(entry, fetcher);
  if (version === existing.version) return existing;
  const release = await fetchCrsPluginRelease(entry, version, fetcher);
  // A range the registry moved would strand an edited config's rule ids outside it.
  if (existing.configOverride !== null) {
    assertCrsPluginRulesLoadable([existing.configOverride], entry.ruleIdStart, entry.ruleIdEnd);
  }

  const [record] = await db
    .update(crsPlugins)
    .set({
      repository: entry.repository,
      version: release.version,
      description: release.description,
      ruleIdStart: entry.ruleIdStart,
      ruleIdEnd: entry.ruleIdEnd,
      configRules: release.configRules,
      beforeRules: release.beforeRules,
      afterRules: release.afterRules,
      updatedAt: nowIso(),
    })
    .where(eq(crsPlugins.id, id))
    .returning();

  await logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "crs_plugin",
    entityId: id,
    summary: `Updated CRS plugin ${existing.name} to ${release.version}`,
  });

  await applyIfSelected(id);
  return toCrsPlugin(record);
}

/** Replaces the plugin's -config file. Blank, or the upstream text, goes back to upstream. */
export async function setCrsPluginConfig(
  id: number,
  config: string | null,
  actorUserId: number,
): Promise<CrsPlugin> {
  const existing = await getCrsPlugin(id);
  if (!existing) throw domainError("crsPluginNotFound", {}, { status: 404 });

  const trimmed = config?.replace(/\r\n?/g, "\n").trim() ?? "";
  const override = trimmed && trimmed !== existing.configRules.trim() ? trimmed : null;
  if (override !== null) {
    assertCrsPluginRulesLoadable([override], existing.ruleIdStart, existing.ruleIdEnd);
  }
  if (override === existing.configOverride) return existing;

  const [record] = await db
    .update(crsPlugins)
    .set({ configOverride: override, updatedAt: nowIso() })
    .where(eq(crsPlugins.id, id))
    .returning();

  await logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "crs_plugin",
    entityId: id,
    summary: `Configured CRS plugin ${existing.name}`,
  });

  await applyIfSelected(id);
  return toCrsPlugin(record);
}

/** Refuses while anything selects the plugin: dropping it silently changes that host's WAF. */
export async function uninstallCrsPlugin(id: number, actorUserId: number): Promise<void> {
  const existing = await getCrsPlugin(id);
  if (!existing) throw domainError("crsPluginNotFound", {}, { status: 404 });

  const usage = (await getCrsPluginUsage()).get(id);
  if (usage?.global) throw domainError("crsPluginInUseGlobally", {}, { status: 409 });
  if (usage?.dashboard) throw domainError("crsPluginInUseByDashboard", {}, { status: 409 });
  if (usage && usage.hosts.length > 0) {
    throw domainError(
      "crsPluginInUseByHosts",
      { hosts: usage.hosts.map((host) => host.name) },
      { status: 409 },
    );
  }

  await db.delete(crsPlugins).where(eq(crsPlugins.id, id));

  await logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "crs_plugin",
    entityId: id,
    summary: `Uninstalled CRS plugin ${existing.name}`,
  });
}
