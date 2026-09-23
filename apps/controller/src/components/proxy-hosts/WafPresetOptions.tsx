"use client";

import { createContext, useContext, type ReactNode } from "react";

export type WafPresetOption = { id: number; name: string; description: string | null };

// A context rather than a prop: WafFields sits several dialogs deep, and the docs site renders it
// with no page around it at all.
const WafPresetOptionsContext = createContext<readonly WafPresetOption[]>([]);

export function WafPresetOptionsProvider({
  presets,
  children,
}: {
  presets: readonly WafPresetOption[];
  children: ReactNode;
}) {
  return (
    <WafPresetOptionsContext.Provider value={presets}>{children}</WafPresetOptionsContext.Provider>
  );
}

export function useWafPresetOptions(): readonly WafPresetOption[] {
  return useContext(WafPresetOptionsContext);
}
