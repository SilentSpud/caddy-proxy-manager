/**
 * Forwarding a controller's request to this agent's own Caddy.
 *
 * The agent is the only thing that knows where its Caddy is. Routing admin traffic through it is
 * what makes a remote agent work at all: otherwise the controller would recreate a container on
 * one host while configuring a Caddy on another, and the two would silently disagree.
 */

import http from "node:http";
import https from "node:https";
import type { CaddyAdminProxyRequest, CaddyAdminProxyResponse } from "@cpm/shared";

/**
 * Paths a controller may ask for.
 *
 * An allowlist rather than a sanitiser: Caddy's admin API can also stop the server and load
 * arbitrary config at arbitrary paths, and the controller needs exactly four things from it. A
 * path that is not one of these is a sign the request did not come from this application, whatever
 * signed it.
 */
const ALLOWED_PATHS: ReadonlyArray<RegExp> = [
  /** Replace the whole config — the apply path. */
  /^\/load$/,
  /** Read the running config, for the restart detector. */
  /^\/config\/?$/,
  /** Convert a Caddyfile snippet to JSON. */
  /^\/adapt$/,
  /** Caddy's own liveness endpoint. */
  /^\/reverse_proxy\/upstreams$/,
];

export function isAllowedAdminPath(path: string): boolean {
  // Checked before the allowlist so a traversal can never be smuggled through a pattern that
  // happens to match after normalisation.
  if (!path.startsWith("/") || path.includes("..")) return false;
  const withoutQuery = path.split("?")[0];
  return ALLOWED_PATHS.some((pattern) => pattern.test(withoutQuery));
}

export class CaddyAdminUnreachable extends Error {}

/**
 * Send one request to Caddy's admin API.
 *
 * node:http rather than fetch, for the same reason the controller used to: fetch sends Sec-Fetch-*
 * headers, which trip Caddy's CORS origin enforcement and turn every admin call into a 403.
 */
export async function forwardToCaddy(
  adminRoot: string,
  request: CaddyAdminProxyRequest,
  timeoutMs = 30_000,
): Promise<CaddyAdminProxyResponse> {
  const root = adminRoot.replace(/\/+$/, "");
  const parsed = new URL(`${root}${request.path}`);
  const body = request.body;

  return new Promise((resolve, reject) => {
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: request.method,
        headers: body
          ? {
              "Content-Type": request.contentType ?? "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") headers[key] = value;
            else if (Array.isArray(value)) headers[key] = value.join(", ");
          }
          resolve({ status: res.statusCode ?? 0, text: data, headers });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new CaddyAdminUnreachable("Caddy did not answer in time."));
    });
    req.on("error", () => reject(new CaddyAdminUnreachable("Caddy is not reachable.")));
    if (body) req.write(body);
    req.end();
  });
}
