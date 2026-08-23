/**
 * The seam between this app and the Caddy admin API.
 *
 * Caddy runs in its own container, so every call to it crosses a network
 * boundary we own. Rather than let each caller reach for node:http directly,
 * all admin traffic goes through one port here:
 *
 *   - production installs `httpCaddyAdminTransport` (node:http / node:https);
 *   - tests install an in-memory adapter (see tests/helpers/caddy-admin.ts),
 *     so the whole config-building and applying path can be exercised against
 *     a spoofed Caddy instance with no real server listening.
 *
 * Callers pass a path relative to `config.caddyApiUrl` and never assemble the
 * URL themselves, so redirecting the entire app at a fake Caddy is a single
 * `setCaddyAdminTransport` call.
 */
import http from "node:http";
import https from "node:https";

export type CaddyAdminRequest = {
  /** Path relative to the configured admin API root, e.g. "/load" or "/config/". */
  path: string;
  method: string;
  body?: string;
  /** Abort the request after this many ms. Omitted means no client-side timeout. */
  timeoutMs?: number;
};

export type CaddyAdminResponse = {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
};

export type CaddyAdminTransport = (request: CaddyAdminRequest) => Promise<CaddyAdminResponse>;

/**
 * Absolute URL for an admin path, so every caller resolves it the same way.
 *
 * `./config` is imported lazily rather than at module scope: config snapshots
 * process.env when it first loads, and this module is imported by the test
 * setup to install the fake adapter. A static import would freeze env before a
 * test file's hoisted block could set it. Nothing outside the real HTTP
 * adapter needs the URL, so deferring costs nothing.
 */
async function caddyAdminUrl(path: string): Promise<string> {
  const { config } = await import("./config");
  const root = config.caddyApiUrl.replace(/\/+$/, "");
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Real transport: a plain node:http request.
 *
 * Deliberately not `fetch` — native fetch sends browser-security headers
 * (Sec-Fetch-*) that trigger Caddy's CORS origin enforcement.
 */
export const httpCaddyAdminTransport: CaddyAdminTransport = async ({
  path,
  method,
  body,
  timeoutMs,
}) => {
  // Backstop for the guard installed by tests/setup.vitest.ts: if a test swaps
  // the real transport back in, fail loudly instead of quietly opening a socket
  // to whatever happens to be listening on the admin port.
  if (process.env.VITEST) {
    throw new Error(
      "The real Caddy admin transport was used inside a test. Tests must install an " +
        "in-memory adapter via setCaddyAdminTransport() — see tests/helpers/caddy-admin.ts.",
    );
  }

  const parsed = new URL(await caddyAdminUrl(path));

  return new Promise((resolve, reject) => {
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          ...(body
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: data, headers: res.headers }),
        );
      },
    );
    if (timeoutMs !== undefined) {
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    }
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
};

let transport: CaddyAdminTransport = httpCaddyAdminTransport;

/** Install an adapter at the seam. Returns the previous one so callers can restore it. */
export function setCaddyAdminTransport(next: CaddyAdminTransport): CaddyAdminTransport {
  const previous = transport;
  transport = next;
  return previous;
}

/** Issue a request against whichever adapter is currently installed. */
export function caddyAdminRequest(request: CaddyAdminRequest): Promise<CaddyAdminResponse> {
  return transport(request);
}
