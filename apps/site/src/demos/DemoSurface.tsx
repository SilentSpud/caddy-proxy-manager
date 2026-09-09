import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeContext, registerTheme } from "@astryxdesign/core/theme";
import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { IntlProvider } from "use-intl";
import messages from "@cpm/controller/messages/en.json";
import "./demo.css";

// The theme's CSS ships pre-built, so registering is all that is left to do and it is idempotent.
registerTheme(neutralTheme);

type Mode = "light" | "dark";

/** Whatever Starlight's theme select last chose. It writes `data-theme` on <html>, as Astryx does. */
function readMode(): Mode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function useStarlightMode(): Mode {
  const [mode, setMode] = useState<Mode>(readMode);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

/**
 * The bit of the controller's app shell a demo needs: Astryx's theme surface and the real message
 * catalog. Everything is scoped to the wrapper below, so several demos can sit on one page.
 *
 * Astryx's own `<Theme>` is deliberately not used. The first one in a tree declares itself the root
 * and syncs `data-theme` and `data-astryx-theme` onto `<html>` - which would both fight Starlight
 * for the page's colour mode and pull the theme's prose defaults (heading sizes, paragraph colour,
 * `hr`) over the whole documentation site. What `<Theme>` renders otherwise is this wrapper and
 * this context, so the demos render them directly and leave `<html>` alone.
 */
export function DemoSurface({ children }: { children: ReactNode }) {
  const mode = useStarlightMode();
  const theme = useMemo(() => ({ theme: neutralTheme, mode }), [mode]);

  return (
    <ThemeContext value={theme}>
      {/* A fixed zone, not the reader's: the demos render dates only as examples, and letting the
          server and the browser disagree about the zone would be a hydration mismatch. */}
      <IntlProvider locale="en" messages={messages} timeZone="UTC">
        <InternationalizationProvider locale="en">
          <div
            className="cpm-demo"
            data-astryx-theme={neutralTheme.name}
            data-theme={mode}
            style={{ colorScheme: mode }}
          >
            {children}
          </div>
        </InternationalizationProvider>
      </IntlProvider>
    </ThemeContext>
  );
}
