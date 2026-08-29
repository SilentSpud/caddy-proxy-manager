/**
 * Turning a per-host Caddyfile snippet into JSON handlers. Everything else here builds Caddy's JSON
 * directly, which is precise but unwriteable by hand. The translation is Caddy's own — `/adapt` on
 * the admin API, so the running binary with its actual plugin set does the parsing; a hand-rolled
 * parser would drift and would accept directives for plugins that are not compiled in.
 */

import { caddyAdminRequest } from "./caddy-admin";

export type AdaptedCaddyfile = {
  /** Routes extracted from the adapted config, ready to nest in a subroute. */
  routes: Record<string, unknown>[];
  /** Warnings Caddy reported while adapting, e.g. deprecated directives. */
  warnings: string[];
  /**
   * Top-level app keys the snippet produced that cannot be honoured at host scope (`tls`,
   * `layer4`, …). Surfaced rather than dropped: an operator's `tls` directive did nothing.
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
 * Caddy's adapter needs a complete Caddyfile, so the snippet is wrapped in a `:80` site block —
 * that address produces no host matcher, and this app supplies host matching when it nests them.
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
 * Adapt a Caddyfile snippet into HTTP routes. Throws CaddyfileAdaptError carrying Caddy's own
 * message, which names the line and the directive.
 */
export async function adaptCaddyfileSnippet(snippet: string): Promise<AdaptedCaddyfile> {
  const trimmed = snippet.trim();
  if (!trimmed) return { routes: [], warnings: [], ignoredApps: [] };

  const response = await caddyAdminRequest({
    path: "/adapt",
    method: "POST",
    body: wrapSnippet(trimmed),
    contentType: "text/caddyfile",
    // Adaptation is pure parsing — no answer in ten seconds means something is wrong with the
    // admin endpoint, not with the snippet.
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
 * The handler entry carrying a snippet's routes into a host's chain. A `subroute` rather than flat
 * handlers: the adapted routes carry their own matchers, and flattening would apply a snippet's
 * path-scoped directives to every request.
 */
export function buildCaddyfileSubrouteHandler(
  routes: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (routes.length === 0) return null;
  return { handler: "subroute", routes };
}

/**
 * Validate a snippet by adapting it, returning an error message or null. Used on save so a
 * snippet that cannot be adapted never reaches the database.
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
    // A transport failure is not the operator's fault and must not read as a syntax error — let
    // the save through and let the config build warn.
    console.warn("Could not reach Caddy to validate a Caddyfile snippet", error);
    return null;
  }
}
