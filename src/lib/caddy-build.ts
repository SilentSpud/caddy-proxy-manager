/**
 * Caddy image build management.
 *
 * Plugins are compiled in, so a module-list change means rebuilding and recreating the container:
 * the web app writes a compose override plus a trigger to the shared volume, and the sidecar builds
 * and writes caddy-build.status — plus caddy-build.applied.json on success only.
 *
 * *desired* is the admin's selection (the compose override, drives the UI); *applied* is what the
 * running binary was built with (the sidecar's record). Generation must never emit a handler
 * outside *applied*, since Caddy rejects a config naming an unknown module in full — hence separate
 * files, since the override is written before the build. Generation uses the intersection.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
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

// Shares the data volume and env override with l4-ports.ts, so tests can point both at a
// scratch directory.
const DATA_DIR = process.env.L4_PORTS_DIR || "/app/data";
const OVERRIDE_FILE = "docker-compose.caddy-build.yml";
const TRIGGER_FILE = "caddy-build.trigger";
const STATUS_FILE = "caddy-build.status";
// Written by the sidecar after a build succeeds and caddy is healthy again. Separate from
// OVERRIDE_FILE on purpose — see getAppliedModuleSpecs.
const APPLIED_FILE = "caddy-build.applied.json";

export type CaddyBuildState = "idle" | "pending" | "building" | "applied" | "failed";

export type CaddyBuildStatus = {
  state: CaddyBuildState;
  message?: string;
  appliedAt?: string;
  triggeredAt?: string;
  appliedHash?: string;
  error?: string;
};

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
 * From the record the sidecar writes only after a successful, healthy build — not the compose
 * override, which holds the *desired* list and is written first. Using that would make applied
 * equal desired the instant a rebuild is requested, so any apply during the build would emit
 * handlers the binary lacks, and a failed build would reject every later apply.
 *
 * No record means no rebuild yet, so the container is the shipped image with the full catalog.
 */
export function getAppliedModuleSpecs(): string[] {
  const filePath = join(DATA_DIR, APPLIED_FILE);
  if (!existsSync(filePath)) return defaultModuleSpecs();

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as { modules?: string };
    if (typeof parsed.modules !== "string") return defaultModuleSpecs();
    return parseModuleSpecList(parsed.modules);
  } catch {
    return defaultModuleSpecs();
  }
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
  const settings = await getCaddyBuildSettings();
  const desiredSpecs = resolveModuleSpecs(settings);
  const appliedSpecs = getAppliedModuleSpecs();
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
  const settings = await getCaddyBuildSettings();
  const desiredIds = new Set(resolveEnabledModuleIds(settings));
  const desiredPaths = new Set(
    Array.from(desiredIds, (id) => findCaddyModule(id)?.modulePath).filter((p): p is string =>
      Boolean(p),
    ),
  );
  // Custom modules are opaque — no feature mapping, but they belong in appliedPaths so a
  // caller checking a specific path can find one an operator added by hand.
  const appliedPaths = new Set(getAppliedModuleSpecs().map((spec) => stripVersion(spec)));
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

/** The compose override that carries the module list into the build. */
export function generateCaddyBuildOverride(specs: string[]): string {
  return `# Auto-generated by Caddy Proxy Manager — Caddy module selection
# Do not edit manually — this file is regenerated when you click "Rebuild Caddy"
services:
  caddy:
    build:
      args:
        CADDY_MODULES: "${specs.join(" ")}"
`;
}

/**
 * Persist the selection as a compose override and signal the sidecar. Validated here as well as in
 * the UI, since the REST API reaches it too and a bad path would fail opaquely later.
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

  const specs = resolveModuleSpecs(settings);
  const overridePath = join(DATA_DIR, OVERRIDE_FILE);
  const triggerPath = join(DATA_DIR, TRIGGER_FILE);

  writeFileSync(overridePath, generateCaddyBuildOverride(specs), "utf-8");

  const triggeredAt = new Date().toISOString();
  writeFileSync(
    triggerPath,
    JSON.stringify({ triggeredAt, hash: hashSpecs(specs), modules: specs }),
    "utf-8",
  );

  return {
    state: "pending",
    message: `Trigger written. Waiting for the sidecar to rebuild Caddy with ${specs.length} module(s). This can take several minutes.`,
    triggeredAt,
  };
}

export function getCaddyBuildStatus(): CaddyBuildStatus {
  const statusPath = join(DATA_DIR, STATUS_FILE);
  if (!existsSync(statusPath)) return { state: "idle" };
  try {
    return JSON.parse(readFileSync(statusPath, "utf-8")) as CaddyBuildStatus;
  } catch {
    return { state: "idle" };
  }
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
