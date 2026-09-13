/**
 * Turning a per-host Caddyfile snippet into JSON handlers. The translation is Caddy's own -
 * `/adapt` on the admin API, so the running binary with its actual plugin set does the parsing; a
 * hand-rolled parser would drift and accept directives for plugins that are not compiled in.
 */

import { connectedAgents } from "./agent/registry";
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
 * Caddy's adapter needs a complete Caddyfile, so the snippet is wrapped in a `:80` site block -
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
 * Adapt a snippet into HTTP routes. Throws CaddyfileAdaptError with Caddy's own message.
 *
 * `agentId` names the agent whose Caddy adapts it, and routes adapted for a document must come from
 * the agent that document is loaded onto. The answer is nested into the config unmodified, so an
 * agent adapting for another would be writing that agent's routes.
 */
export async function adaptCaddyfileSnippet(
  snippet: string,
  agentId?: string,
): Promise<AdaptedCaddyfile> {
  const trimmed = snippet.trim();
  if (!trimmed) return { routes: [], warnings: [], ignoredApps: [] };

  const response = await caddyAdminRequest({
    path: "/adapt",
    method: "POST",
    body: wrapSnippet(trimmed),
    contentType: "text/caddyfile",
    // Adaptation is pure parsing - no answer in ten seconds means something is wrong with the
    // admin endpoint, not with the snippet.
    timeoutMs: 10_000,
    agentId,
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
 * The handler entry carrying a snippet's routes into a host's chain. A `subroute`, not flat
 * handlers: the adapted routes carry their own matchers, and flattening would apply path-scoped
 * directives to every request.
 */
export function buildCaddyfileSubrouteHandler(
  routes: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (routes.length === 0) return null;
  return { handler: "subroute", routes };
}

/**
 * Validate a snippet by adapting it; error message or null. Used on save.
 *
 * `agentRowIds` are the agents the host is pinned to, empty for every agent - the same rule
 * `servedByAgent` applies when building each agent's document.
 */
export async function validateCaddyfileSnippet(
  snippet: string,
  agentRowIds: readonly number[] = [],
): Promise<string | null> {
  if (!snippet.trim()) return null;
  // Every agent that loads the host adapts the snippet for its own config, so each of those is
  // asked: one agent's verdict alone must not pass a snippet another would reject. An agent that
  // never loads the host has no say - its Caddy may lack a module the host's agent has.
  const agents = connectedAgents().filter(
    (agent) => agentRowIds.length === 0 || agentRowIds.includes(agent.agentRowId),
  );
  const targets = agents.length > 0 ? agents.map((agent) => agent.agentId) : [undefined];
  const verdicts = await Promise.all(
    targets.map(async (agentId): Promise<string | null> => {
      try {
        const { ignoredApps } = await adaptCaddyfileSnippet(snippet, agentId);
        if (ignoredApps.length > 0) {
          return `These directives configure Caddy at a level this field cannot reach (${ignoredApps.join(", ")}). Per-host Caddyfile directives may only produce HTTP routes.`;
        }
      } catch (error) {
        if (error instanceof CaddyfileAdaptError) return error.message;
        // A transport failure is not the operator's fault and must not read as a syntax error - let
        // the save through and let the config build warn.
        console.warn("Could not reach Caddy to validate a Caddyfile snippet", error);
      }
      return null;
    }),
  );
  return verdicts.find((verdict) => verdict !== null) ?? null;
}
