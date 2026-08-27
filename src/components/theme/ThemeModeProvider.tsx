"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { Theme } from "@astryxdesign/core";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemeMode } from "@/src/lib/theme-mode";

interface ThemeModeContextValue {
  /** The stored preference — "system" included, unresolved. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

/**
 * Reads the preference the user picked.
 *
 * This is deliberately *not* the mode in effect: "system" stays "system" here.
 * For the resolved light/dark — what a non-CSS consumer such as Monaco needs —
 * use Astryx's own `useTheme()`, which resolves "system" against the OS and
 * tracks changes to it.
 */
export function useThemeMode(): ThemeModeContextValue {
  const ctx = use(ThemeModeContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used inside <ThemeModeProvider>");
  }
  return ctx;
}

function persist(mode: ThemeMode) {
  // SameSite=Lax is enough: the cookie only picks a colour, and it must survive
  // ordinary top-level navigation back into the app.
  /* biome-ignore lint/suspicious/noDocumentCookie: the suggested Cookie Store API
     is Chromium-only — no Safari, no Firefox — and its async set would let a
     reload race the write. document.cookie is the portable, synchronous option,
     and a single well-formed assignment has none of the overwrite hazards the
     rule guards against. */
  document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Owns the colour-mode preference and hands it to Astryx's `<Theme>`.
 *
 * `initialMode` comes from the cookie the server already read, so the first
 * client render matches the server's `<html data-theme>` exactly — no
 * hydration mismatch, and no post-mount correction that would show up as a
 * flash. Astryx's Theme keeps `<html>` in sync from then on.
 */
export function ThemeModeProvider({
  initialMode,
  children,
}: {
  initialMode: ThemeMode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    persist(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return (
    <ThemeModeContext value={value}>
      <Theme theme={neutralTheme} mode={mode}>
        {children}
      </Theme>
    </ThemeModeContext>
  );
}
