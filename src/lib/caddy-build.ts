/**
 * Caddy image build management.
 *
 * Caddy plugins are compiled in, not loaded at runtime, so changing the module
 * list means rebuilding and recreating the caddy container. That is the same
 * shape of problem as L4 port changes, and it reuses the same machinery: the
 * web app writes a compose override plus a trigger file onto the shared data
 * volume, and the sidecar — which is the only component holding a Docker API
 * handle — does the build.
 *
 * Flow:
 *   1. Admin toggles modules in Settings → Caddy Build; the selection is stored.
 *   2. "Rebuild Caddy" writes docker-compose.caddy-build.yml (a CADDY_MODULES
 *      build arg) and caddy-build.trigger.
 *   3. Sidecar detects the trigger, runs `docker compose build caddy` then
 *      recreates the container, and writes caddy-build.status. On success — and
 *      only on success — it also writes caddy-build.applied.json.
 *   4. Web reads the status to report progress and the applied module list.
 *
 * Two module sets therefore exist at any moment, and the difference between
 * them is load-bearing rather than incidental:
 *
 *   - *desired* — what the admin selected. Drives which settings the UI offers.
 *     Lives in the compose override, which is the build's *input*.
 *   - *applied* — what the running binary was actually built with, read from the
 *     record the sidecar writes after a successful build. Config generation must
 *     never emit a handler that is not in this set, because Caddy rejects a
 *     config containing an unknown module in full, taking every unrelated host
 *     with it.
 *
 * Those are two separate files for a reason: the override is written before the
 * build, so treating it as the applied set would make applied equal desired
 * while the old binary is still running — and keep it wrong forever if the build
 * failed. See getAppliedModuleSpecs.
 *
 * So config generation uses the intersection: turning a module *off* takes
 * effect immediately (harmless — the handler simply stops being emitted), while
 * turning one *on* waits for the rebuild that actually puts it in the binary.
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

// Shares the data volume with l4-ports.ts, and the same env override so tests
// can point both at a scratch directory.
const DATA_DIR = process.env.L4_PORTS_DIR || "/app/data";
const OVERRIDE_FILE = "docker-compose.caddy-build.yml";
const TRIGGER_FILE = "caddy-build.trigger";
const STATUS_FILE = "caddy-build.status";
// Written by the sidecar after a build succeeds and caddy is healthy again.
// Kept separate from OVERRIDE_FILE on purpose — see getAppliedModuleSpecs.
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
 * Resolve stored settings into a complete selection.
 *
 * A module id missing from the stored map counts as enabled. That is what makes
 * an upgrade safe: a module added to the catalog after an operator last saved
 * their selection appears on, matching the image they are already running,
 * rather than silently switching a working feature off.
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

/**
 * The full `--with` argument list for a selection, sorted so that an unchanged
 * selection always hashes to the same value regardless of toggle order.
 */
export function resolveModuleSpecs(settings: CaddyBuildSettings | null): string[] {
  const builtIn = resolveEnabledModuleIds(settings).map(
    (id) => findCaddyModule(id)?.modulePath ?? id,
  );
  const custom = resolveCustomModules(settings).map(customModuleSpec);
  return Array.from(new Set([...builtIn, ...custom])).sort();
}

/** The specs the shipped image is built with — the baseline before any rebuild. */
export function defaultModuleSpecs(): string[] {
  return CADDY_MODULES.map((m) => m.modulePath).sort();
}

// ─── Applied state ───────────────────────────────────────────────────────────

/**
 * The module specs actually compiled into the running binary.
 *
 * Read from a record the sidecar writes only *after* a build succeeds and the
 * container comes back healthy — deliberately not from the compose override,
 * even though that file also holds a module list.
 *
 * The override carries the *desired* list into the build, and it is written
 * before the build starts. Reading it here would make applied equal desired the
 * instant the rebuild is requested, which collapses the whole desired-vs-applied
 * distinction this module exists to maintain. Two concrete failures follow from
 * that, and both were reachable:
 *
 *   - During the minutes a build takes, any other config apply (a host edit, a
 *     cert renewal, an instance-sync push) would emit handlers for a module the
 *     running binary does not have yet, and Caddy would reject the document.
 *   - If the build then failed, the override would stay on disk, so the wrong
 *     answer would persist — every later apply rejected — until someone deleted
 *     the file by hand.
 *
 * No record means no successful rebuild has happened, so the container is still
 * the shipped image, which is built with the full catalog. Returning an empty
 * list here would drop every plugin-backed handler on a healthy default install.
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
  // Custom modules are opaque — they carry no feature mapping, but they do
  // belong in appliedPaths so a caller checking a specific path can find one
  // an operator added by hand.
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

/**
 * Whether config generation may emit handlers for a feature: the module must be
 * both selected and actually compiled into the running binary.
 */
export function isFeatureUsable(
  availability: CaddyModuleAvailability,
  feature: CaddyFeatureId,
): boolean {
  return availability.desired.has(feature) && availability.applied.has(feature);
}

/**
 * Whether a specific DNS provider can be used for an ACME DNS-01 challenge.
 * DNS-01 is per-provider, unlike the coarser feature check: having Cloudflare
 * compiled in says nothing about Route 53.
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
 * The Dockerfile the image is built from, rendered with the selected modules.
 *
 * Shown read-only in Settings so an operator can see exactly what the rebuild
 * will run, and copy it if they would rather build outside the sidecar. The
 * real file on disk stays generic — it takes CADDY_MODULES as a build arg — so
 * this only substitutes that one value.
 */
export function generateCaddyDockerfilePreview(specs: string[]): string {
  const withLines = specs.map((spec) => `#     --with ${spec}`).join("\n");
  return `# Generated preview — the real build uses docker/caddy/Dockerfile with
# CADDY_MODULES set to the value below.
#
# xcaddy build master \\
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
 * Persist the current selection as a compose override and signal the sidecar.
 *
 * Validation happens here as well as in the UI because this is also reachable
 * through the REST API, and a bad module path would otherwise surface as an
 * opaque build failure minutes later.
 */
export async function applyCaddyBuild(): Promise<CaddyBuildStatus> {
  const settings = await getCaddyBuildSettings();

  for (const entry of settings?.customModules ?? []) {
    if (!entry.enabled) continue;
    const error = validateCustomModule(entry);
    if (error) throw new Error(error);
  }

  // Re-apply the config before the rebuild, not after.
  //
  // Caddy runs with `--resume`, so when the sidecar recreates the container it
  // reloads whatever config was last autosaved. If that config still names a
  // module the new binary no longer contains, Caddy refuses to load it and the
  // proxy stays down — every host, not just the ones using that module — and the
  // app cannot push a correction because the admin API never comes up.
  //
  // Applying here rather than at the settings save covers every route in: the
  // UI's Rebuild button, the REST endpoint, and a rebuild triggered after a
  // selection change that arrived some other way. Imported lazily because
  // caddy.ts imports this module for its feature gating.
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

/**
 * Normalize a settings payload from a form or the REST API: unknown module ids
 * are dropped, and custom entries are cleaned up and validated.
 */
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
    // A duplicate path would make xcaddy fail with a confusing "module already
    // required" error long after the admin left the page.
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
 * The serializable snapshot the dashboard hands to client components.
 *
 * Gates on *desired* rather than applied state: the toggles are what the admin
 * just set, so a control that follows the applied set would stay greyed out
 * after being switched on and read as broken. The pending-rebuild flag is what
 * tells them the change is not live yet.
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
    // Per-module rather than per-feature, because DNS-01 is only meaningful one
    // provider at a time: having Cloudflare compiled in says nothing about
    // whether Route 53 is.
    enabledModuleIds: Array.from(availability.desiredIds),
    pendingRebuild: diff.needsRebuild,
  };
}
