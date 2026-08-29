/**
 * The seam between this app and the Caddy admin API: all admin traffic goes through one transport,
 * so production installs `httpCaddyAdminTransport` while tests install an in-memory adapter (see
 * tests/helpers/caddy-admin.ts) and exercise the whole build-and-apply path with nothing
 * listening. Callers pass a path relative to `config.caddyApiUrl` and never build the URL.
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
  /**
   * Content-Type for the body. Defaults to application/json, which is right for every config
   * endpoint; /adapt is the exception — it needs text/caddyfile to know which adapter to run.
   */
  contentType?: string;
};

export type CaddyAdminResponse = {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
};

export type CaddyAdminTransport = (request: CaddyAdminRequest) => Promise<CaddyAdminResponse>;

/**
 * Absolute URL for an admin path. `./config` is imported lazily because config snapshots
 * process.env on first load and the test setup imports this module to install the fake adapter — a
 * static import would freeze env before a test's hoisted block could set it.
 */
async function caddyAdminUrl(path: string): Promise<string> {
  const { config } = await import("./config");
  const root = config.caddyApiUrl.replace(/\/+$/, "");
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Real transport: a plain node:http request. Deliberately not `fetch` — native fetch sends
 * browser-security headers (Sec-Fetch-*) that trigger Caddy's CORS origin enforcement.
 */
export const httpCaddyAdminTransport: CaddyAdminTransport = async ({
  path,
  method,
  body,
  timeoutMs,
  contentType,
}) => {
  // Backstop for the guard installed by tests/setup.bun.ts: if a test swaps the real transport
  // back in, fail loudly instead of quietly opening a socket to whatever is listening on the
  // admin port. CPM_TEST is set by tests/helpers/env.ts — `bun test` sets no marker of its own.
  if (process.env.CPM_TEST) {
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
            ? {
                "Content-Type": contentType ?? "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
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
