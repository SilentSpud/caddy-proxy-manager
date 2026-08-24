/**
 * Turning a per-host Caddyfile snippet into JSON handlers.
 *
 * Everything else in this app builds Caddy's JSON config directly, which is
 * precise but unwriteable by hand: `reverse_proxy` alone expands to a dozen
 * nested keys. Caddyfile syntax is what the upstream documentation, every blog
 * post, and every GitHub issue is written in, so a host-level escape hatch is
 * far more useful in that dialect than as another JSON blob.
 *
 * The translation is not reimplemented here. Caddy's own admin API exposes
 * `/adapt`, so the running binary — the same binary, with the same plugin set,
 * that will execute the result — does the parsing. That matters twice over: a
 * hand-rolled parser would drift from upstream syntax, and it would happily
 * accept directives for plugins that are not compiled in, producing a config
 * that fails to load.
 */

import { caddyAdminRequest } from "./caddy-admin";

export type AdaptedCaddyfile = {
  /** Routes extracted from the adapted config, ready to nest in a subroute. */
  routes: Record<string, unknown>[];
  /** Warnings Caddy reported while adapting, e.g. deprecated directives. */
  warnings: string[];
  /**
   * Top-level app keys the snippet produced that this app cannot honour at
   * host scope (`tls`, `layer4`, …). Surfaced rather than dropped silently:
   * an operator who wrote a `tls` directive needs to know it did nothing.
   */
  ignoredApps: string[];
};

export class CaddyfileAdaptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaddyfileAdaptError";
  }
}

/**
 * Caddy's adapter needs a complete Caddyfile, so the snippet is wrapped in a
 * site block. `:80` is used as the address because it produces no host matcher
 * — the routes come back matching on whatever the snippet itself specified,
 * and this app supplies the host matching when it nests them under a host.
 */
function wrapSnippet(snippet: string): string {
  return `:80 {\n${snippet}\n}\n`;
}

type AdaptResponse = {
  result?: {
    apps?: {
      http?: {
        servers?: Record<string, { routes?: Record<string, unknown>[] }>;
      };
    } & Record<string, unknown>;
  };
  warnings?: { message?: string; file?: string; line?: number }[];
  error?: string;
};

/**
 * Adapt a Caddyfile snippet into HTTP routes.
 *
 * Throws CaddyfileAdaptError with Caddy's own message when the snippet does not
 * parse — that text names the line and the directive, which is far more useful
 * than anything this layer could synthesise.
 */
export async function adaptCaddyfileSnippet(snippet: string): Promise<AdaptedCaddyfile> {
  const trimmed = snippet.trim();
  if (!trimmed) return { routes: [], warnings: [], ignoredApps: [] };

  const response = await caddyAdminRequest({
    path: "/adapt",
    method: "POST",
    body: wrapSnippet(trimmed),
    contentType: "text/caddyfile",
    // Adaptation is pure parsing — if it has not answered in ten seconds
    // something is wrong with the admin endpoint, not with the snippet.
    timeoutMs: 10_000,
  });

  let parsed: AdaptResponse;
  try {
    parsed = JSON.parse(response.text) as AdaptResponse;
  } catch {
    throw new CaddyfileAdaptError(
      `Caddy returned an unreadable response while adapting the Caddyfile (HTTP ${response.status}): ${response.text.slice(0, 200)}`,
    );
  }

  if (response.status >= 400 || parsed.error) {
    throw new CaddyfileAdaptError(
      parsed.error ?? `Caddy rejected the Caddyfile (HTTP ${response.status})`,
    );
  }

  const apps = parsed.result?.apps ?? {};
  const servers = apps.http?.servers ?? {};
  const routes: Record<string, unknown>[] = [];
  for (const server of Object.values(servers)) {
    for (const route of server.routes ?? []) {
      routes.push(route);
    }
  }

  const ignoredApps = Object.keys(apps).filter((key) => key !== "http");

  return {
    routes,
    warnings: (parsed.warnings ?? [])
      .map((w) => (w.line ? `line ${w.line}: ${w.message ?? ""}` : (w.message ?? "")))
      .filter(Boolean),
    ignoredApps,
  };
}

/**
 * The single handler entry that carries a snippet's routes into a host's
 * handler chain.
 *
 * A `subroute` is used rather than splicing the handlers in flat because the
 * adapted routes carry their own matchers and `terminal` flags. Flattening
 * would drop the matchers, applying a snippet's path-scoped directives to every
 * request the host serves — the exact opposite of what was written.
 */
export function buildCaddyfileSubrouteHandler(
  routes: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (routes.length === 0) return null;
  return { handler: "subroute", routes };
}

/**
 * Validate a snippet by adapting it, returning an error message or null.
 * Used on save so a snippet that cannot be adapted never reaches the database.
 */
export async function validateCaddyfileSnippet(snippet: string): Promise<string | null> {
  if (!snippet.trim()) return null;
  try {
    const { ignoredApps } = await adaptCaddyfileSnippet(snippet);
    if (ignoredApps.length > 0) {
      return `These directives configure Caddy at a level this field cannot reach (${ignoredApps.join(", ")}). Per-host Caddyfile directives may only produce HTTP routes.`;
    }
    return null;
  } catch (error) {
    if (error instanceof CaddyfileAdaptError) return error.message;
    // A transport failure is not the operator's fault and must not be reported
    // as a syntax error — let the save through and let the config build warn.
    console.warn("Could not reach Caddy to validate a Caddyfile snippet", error);
    return null;
  }
}
