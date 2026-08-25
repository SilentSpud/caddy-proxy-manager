"use client";

/**
 * Which plugin-backed features are switched on, made available to every client
 * component under the dashboard.
 *
 * The alternative — threading a prop from each page's server component down
 * through its client shell, its dialogs, and its field groups — would touch a
 * dozen files per feature and add a parameter to components that only forward
 * it. The answer is the same everywhere, changes only when an admin edits
 * Settings → Caddy Build, and is read at the leaves, which is exactly the shape
 * context is for.
 *
 * Gating here is about honesty, not enforcement: server-side config generation
 * already refuses to emit handlers for absent modules (see caddy-build.ts). This
 * layer exists so a control that cannot do anything looks like it cannot do
 * anything, and says which module to turn back on.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import type { CaddyFeatureId } from "@/src/lib/caddy-modules";

export type ModuleGateState = {
  /** Feature -> whether the admin has its module(s) selected. */
  features: Record<CaddyFeatureId, boolean>;
  /** Feature -> human-readable module name(s) to name in the tooltip. */
  moduleNames: Record<CaddyFeatureId, string>;
  /**
   * Individual module ids the admin has selected, for per-module checks.
   *
   * `null` means "not known here" (no provider above us); an empty array is a
   * real answer meaning the admin disabled everything. Using `[]` for both — as
   * this once did — makes "nothing is enabled" indistinguishable from "we have
   * no idea", and the DNS provider picker then reports every provider as
   * available on an instance where none of them are.
   */
  enabledModuleIds: string[] | null;
  /** True when the selection has not been built into the image yet. */
  pendingRebuild: boolean;
};

// Defaulting to "everything on" keeps components usable outside the provider —
// tests, storybook, and the login shell — instead of silently disabling every
// control when the context is missing.
const FALLBACK: ModuleGateState = {
  features: { l4: true, geoblock: true, waf: true, dns01: true },
  moduleNames: { l4: "", geoblock: "", waf: "", dns01: "" },
  enabledModuleIds: null,
  pendingRebuild: false,
};

const ModuleGateContext = createContext<ModuleGateState>(FALLBACK);

export function ModuleGateProvider({
  value,
  children,
}: {
  value: ModuleGateState;
  children: ReactNode;
}) {
  return <ModuleGateContext.Provider value={value}>{children}</ModuleGateContext.Provider>;
}

export function useModuleGate(): ModuleGateState {
  return useContext(ModuleGateContext);
}

/**
 * Whether one specific module is selected.
 *
 * Outside a provider (null) everything reads as enabled — see FALLBACK.
 */
export function useModuleEnabled(moduleId: string): boolean {
  const { enabledModuleIds } = useModuleGate();
  if (enabledModuleIds === null) return true;
  return enabledModuleIds.includes(moduleId);
}

/** Whether a feature's controls should be live. */
export function useFeatureEnabled(feature: CaddyFeatureId): boolean {
  return useModuleGate().features[feature] ?? true;
}

/**
 * The sentence shown when a feature is off: names the module, and says where to
 * turn it on. Returns null when the feature is available.
 */
export function useDisabledReason(feature: CaddyFeatureId): string | null {
  const gate = useModuleGate();
  if (gate.features[feature] ?? true) return null;
  const name = gate.moduleNames[feature];
  return name
    ? `Requires the ${name} Caddy module. Enable it in Settings → Caddy Build and rebuild Caddy.`
    : "Requires a Caddy module that is not enabled. See Settings → Caddy Build.";
}

/**
 * Wrap controls that depend on a Caddy module.
 *
 * When the module is on this renders its children untouched — no wrapper
 * element, no layout change — so the common case costs nothing. When it is off,
 * the children are wrapped in a tooltip explaining which module is missing.
 * Disabling the controls themselves is left to each caller, because only the
 * caller knows which of its inputs are the module-backed ones.
 */
export function ModuleGated({
  feature,
  children,
}: {
  feature: CaddyFeatureId;
  children: ReactNode;
}) {
  const reason = useDisabledReason(feature);
  if (!reason) return <>{children}</>;
  return <Tooltip content={reason}>{children}</Tooltip>;
}
