/**
 * Caddy image build management.
 *
 * Plugins are compiled in, so changing the module list means rebuilding the image and recreating
 * the container — which the controller cannot do itself, having no Docker socket. It sends the
 * selection to the agent and reads back what the agent actually built.
 *
 * *desired* is the admin's selection, which drives the UI; *applied* is what the running binary was
 * built with, which the agent reports and only after a build has succeeded and Caddy is healthy
 * again. Generation must never emit a handler outside *applied*, since Caddy rejects a config
 * naming an unknown module in full — so the two are kept apart, and generation uses the
 * intersection.
 */

import crypto from "node:crypto";
import type { CaddyBuildState, CaddyBuildStatus } from "@cpm/shared";
import {
  CADDY_MODULES,
  type CaddyCustomModule,
  type CaddyFeatureId,
  customModuleSpec,
  findCaddyModule,
  modulesForFeature,
  normalizeModulePath,
  validateCustomModule,
} from "./caddy-modules";
import { type CaddyBuildSettings, getCaddyBuildSettings } from "./settings";

import { requestCaddyBuild, tryGetAgentStatus } from "./agent/client";

export type { CaddyBuildState, CaddyBuildStatus };

export type CaddyBuildDiff = {
  /** `--with` specs the running image was built with. */
  appliedSpecs: string[];
  /** `--with` specs the current selection would build. */
  desiredSpecs: string[];
  /** Specs a rebuild would add. */
  added: string[];
  /** Specs a rebuild would remove. */
  removed: string[];
  needsRebuild: boolean;
};

// ─── Selection ───────────────────────────────────────────────────────────────

/**
 * Resolve stored settings into a complete selection. A missing module id counts as enabled, so a
 * module added to the catalog after the operator last saved appears on.
 */
export function resolveEnabledModuleIds(settings: CaddyBuildSettings | null): string[] {
  const overrides = settings?.modules ?? {};
  return CADDY_MODULES.filter((m) => overrides[m.id] !== false).map((m) => m.id);
}

export function resolveCustomModules(settings: CaddyBuildSettings | null): CaddyCustomModule[] {
  return (settings?.customModules ?? []).filter(
    (entry) => entry.enabled && validateCustomModule(entry) === null,
  );
}

/** The `--with` list for a selection, sorted so toggle order never changes the hash. */
export function resolveModuleSpecs(settings: CaddyBuildSettings | null): string[] {
  const builtIn = resolveEnabledModuleIds(settings).map(
    (id) => findCaddyModule(id)?.modulePath ?? id,
  );
  const custom = resolveCustomModules(settings).map(customModuleSpec);
  return Array.from(new Set([...builtIn, ...custom])).sort();
}

/** Specs the shipped image is built with — the baseline before any rebuild. */
export function defaultModuleSpecs(): string[] {
  return CADDY_MODULES.map((m) => m.modulePath).sort();
}

// ─── Applied state ───────────────────────────────────────────────────────────

/**
 * The module specs actually compiled into the running binary.
 *
 * From what the agent reports having built, which it records only after a build has succeeded and
 * Caddy is healthy again — never from the selection. Using the selection would make applied equal
 * desired the instant a rebuild was requested, so any config apply during the build would emit
 * handlers the running binary lacks, and a failed build would reject every apply after it.
 *
 * Null from the agent, or no agent at all, means no rebuild has happened: the container is the
 * shipped image, which carries the full catalog.
 */
export async function getAppliedModuleSpecs(): Promise<string[]> {
  const status = await tryGetAgentStatus();
  const applied = status?.caddyBuild.applied;
  return applied && applied.length > 0 ? [...applied].sort() : defaultModuleSpecs();
}

/** Split the whitespace-separated CADDY_MODULES build arg into specs. */
export function parseModuleSpecList(value: string): string[] {
  return value
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function hashSpecs(specs: string[]): string {
  return crypto.createHash("sha256").update(specs.join(" ")).digest("hex").slice(0, 16);
}

export async function getCaddyBuildDiff(): Promise<CaddyBuildDiff> {
  const [settings, appliedSpecs] = await Promise.all([
    getCaddyBuildSettings(),
    getAppliedModuleSpecs(),
  ]);
  const desiredSpecs = resolveModuleSpecs(settings);
  const appliedSet = new Set(appliedSpecs);
  const desiredSet = new Set(desiredSpecs);
  return {
    appliedSpecs,
    desiredSpecs,
    added: desiredSpecs.filter((s) => !appliedSet.has(s)),
    removed: appliedSpecs.filter((s) => !desiredSet.has(s)),
    needsRebuild: hashSpecs(appliedSpecs) !== hashSpecs(desiredSpecs),
  };
}

// ─── Feature gating ──────────────────────────────────────────────────────────

export type CaddyModuleAvailability = {
  /** Feature is selected by the admin — used to decide what the UI offers. */
  desired: Set<CaddyFeatureId>;
  /** Feature is in the running binary — used to decide what config may emit. */
  applied: Set<CaddyFeatureId>;
  /** Module paths present in the running binary. */
  appliedPaths: Set<string>;
  /** Module ids the admin has selected. */
  desiredIds: Set<string>;
};

function featuresForPaths(paths: Set<string>): Set<CaddyFeatureId> {
  const features = new Set<CaddyFeatureId>();
  for (const module of CADDY_MODULES) {
    if (!paths.has(module.modulePath)) continue;
    for (const feature of module.features) features.add(feature);
  }
  return features;
}

export async function getCaddyModuleAvailability(): Promise<CaddyModuleAvailability> {
  const [settings, appliedSpecs] = await Promise.all([
    getCaddyBuildSettings(),
    getAppliedModuleSpecs(),
  ]);
  const desiredIds = new Set(resolveEnabledModuleIds(settings));
  const desiredPaths = new Set(
    Array.from(desiredIds, (id) => findCaddyModule(id)?.modulePath).filter((p): p is string =>
      Boolean(p),
    ),
  );
  // Custom modules are opaque — no feature mapping, but they belong in appliedPaths so a
  // caller checking a specific path can find one an operator added by hand.
  const appliedPaths = new Set(appliedSpecs.map((spec) => stripVersion(spec)));
  return {
    desired: featuresForPaths(desiredPaths),
    applied: featuresForPaths(appliedPaths),
    appliedPaths,
    desiredIds,
  };
}

function stripVersion(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Whether generation may emit a feature's handlers: selected *and* compiled into the binary. */
export function isFeatureUsable(
  availability: CaddyModuleAvailability,
  feature: CaddyFeatureId,
): boolean {
  return availability.desired.has(feature) && availability.applied.has(feature);
}

/**
 * Whether a DNS provider can serve an ACME DNS-01 challenge. Per-provider, unlike the coarser
 * feature check: Cloudflare compiled in says nothing about Route 53.
 */
export function isDnsProviderUsable(
  availability: CaddyModuleAvailability,
  providerName: string,
): boolean {
  const module = CADDY_MODULES.find((m) => m.dnsProvider === providerName);
  if (!module) return false;
  return availability.desiredIds.has(module.id) && availability.appliedPaths.has(module.modulePath);
}

/** Names the module(s) an operator has to enable to get a feature back. */
export function featureModuleNames(feature: CaddyFeatureId): string {
  return modulesForFeature(feature)
    .map((m) => m.name)
    .join(", ");
}

// ─── Dockerfile / compose generation ─────────────────────────────────────────

/**
 * The Dockerfile the image is built from, rendered with the selected modules. Shown read-only in
 * Settings; the real file stays generic, so this substitutes only CADDY_MODULES.
 */
export function generateCaddyDockerfilePreview(specs: string[]): string {
  const withLines = specs.map((spec) => `#     --with ${spec}`).join("\n");
  return `# Generated preview — the real build uses docker/caddy/Dockerfile with
# CADDY_MODULES set to the value below.
#
# xcaddy build controller \\
${withLines || "#     (no plugins — plain Caddy)"}
#     --output /usr/bin/caddy

ARG CADDY_MODULES="${specs.join(" ")}"
`;
}

/**
 * Send the selection to the agent to build with. Validated here as well as in the UI, since the
 * REST API reaches this too and a bad module path would otherwise fail opaquely inside the build.
 */
export async function applyCaddyBuild(): Promise<CaddyBuildStatus> {
  const settings = await getCaddyBuildSettings();

  for (const entry of settings?.customModules ?? []) {
    if (!entry.enabled) continue;
    const error = validateCustomModule(entry);
    if (error) throw new Error(error);
  }

  // Re-apply the config before the rebuild. Caddy runs with `--resume`, so a recreated container
  // reloads the last autosaved config; if that names a module the new binary lacks, the proxy stays
  // down with no admin API to correct it. Imported lazily — caddy.ts imports this for gating.
  const { applyCaddyConfig } = await import("./caddy");
  await applyCaddyConfig();

  return requestCaddyBuild(resolveModuleSpecs(settings));
}

/** The agent's last word on the rebuild. */
export async function getCaddyBuildStatus(): Promise<CaddyBuildStatus> {
  const status = await tryGetAgentStatus();
  return status?.caddyBuild.status ?? { state: "idle" };
}

/** Normalize a settings payload: drop unknown module ids, clean and validate custom entries. */
export function sanitizeCaddyBuildSettings(input: {
  modules?: Record<string, boolean>;
  customModules?: CaddyCustomModule[];
}): CaddyBuildSettings {
  const modules: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(input.modules ?? {})) {
    if (!findCaddyModule(id)) continue;
    modules[id] = Boolean(enabled);
  }

  const seen = new Set<string>();
  const customModules: CaddyCustomModule[] = [];
  for (const entry of input.customModules ?? []) {
    const modulePath = normalizeModulePath(entry.modulePath ?? "");
    if (!modulePath) continue;
    const error = validateCustomModule({ ...entry, modulePath });
    if (error) throw new Error(error);
    // A duplicate path fails the build with a confusing "module already required" error,
    // long after the admin left the page.
    if (seen.has(modulePath)) {
      throw new Error(`Duplicate custom module "${modulePath}"`);
    }
    seen.add(modulePath);
    customModules.push({
      modulePath,
      ...(entry.version?.trim() ? { version: entry.version.trim() } : {}),
      enabled: entry.enabled !== false,
    });
  }

  return { modules, customModules };
}

// ─── UI gate ─────────────────────────────────────────────────────────────────

const GATED_FEATURES: CaddyFeatureId[] = ["l4", "geoblock", "waf", "dns01"];

/**
 * The serializable snapshot the dashboard hands to client components. Gates on *desired*, not
 * applied — a control following applied would stay greyed out right after being switched on.
 */
export async function getModuleGateState(): Promise<{
  features: Record<CaddyFeatureId, boolean>;
  moduleNames: Record<CaddyFeatureId, string>;
  enabledModuleIds: string[] | null;
  pendingRebuild: boolean;
}> {
  const [availability, diff] = await Promise.all([
    getCaddyModuleAvailability(),
    getCaddyBuildDiff(),
  ]);

  const features = {} as Record<CaddyFeatureId, boolean>;
  const moduleNames = {} as Record<CaddyFeatureId, string>;
  for (const feature of GATED_FEATURES) {
    features[feature] = availability.desired.has(feature);
    moduleNames[feature] = featureModuleNames(feature);
  }

  return {
    features,
    moduleNames,
    // Per-module rather than per-feature: DNS-01 is only meaningful one provider at a time,
    // and having Cloudflare compiled in says nothing about whether Route 53 is.
    enabledModuleIds: Array.from(availability.desiredIds),
    pendingRebuild: diff.needsRebuild,
  };
}
