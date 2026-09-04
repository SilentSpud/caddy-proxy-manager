/**
 * The seam between this app and the Caddy admin API: all traffic goes through one transport, so
 * production installs `agentCaddyAdminTransport` and tests an in-memory adapter, exercising the
 * whole build-and-apply path with nothing listening.
 *
 * Requests go through an agent, not to an address of this app's own. The agent is the only thing
 * that knows where its Caddy is, and a controller that dialled `CADDY_API_URL` itself would
 * configure a Caddy on *this* host while a paired remote agent recreated the container on
 * *another* — which is exactly the split brain the fan-out exists to prevent. `CADDY_API_URL` is
 * the agent's setting now; `httpCaddyAdminTransport` remains only for a deployment running Caddy
 * with no agent at all.
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
  /** Content-Type for the body. Defaults to application/json; /adapt needs text/caddyfile. */
  contentType?: string;
};

export type CaddyAdminResponse = {
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
};

export type CaddyAdminTransport = (request: CaddyAdminRequest) => Promise<CaddyAdminResponse>;

/**
 * Absolute URL for an admin path. The settings module is imported lazily for the same reason the
 * config module was: it reads process.env on first load, and a static import would freeze that
 * before a test's hoisted block could set it.
 */
async function caddyAdminUrl(path: string): Promise<string> {
  const [{ caddyApiUrl }, { getSetting }] = await Promise.all([
    import("./settings/registry"),
    import("./settings/resolve"),
  ]);
  const root = (await getSetting(caddyApiUrl)).replace(/\/+$/, "");
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Real transport: a plain node:http request. Not `fetch` — that sends Sec-Fetch-* headers, which
 * trigger Caddy's CORS origin enforcement.
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

/**
 * Production transport: ask the primary agent to make the request against its own Caddy.
 *
 * Falls back to a direct connection when no agent answers, so a development setup that runs Caddy
 * without the agent container keeps working. That fallback is the only remaining use of this app's
 * own `CADDY_API_URL`.
 */
export const agentCaddyAdminTransport: CaddyAdminTransport = async (request) => {
  const { caddyAdminViaAgent, AgentUnavailableError } = await import("./agent/client");
  try {
    const response = await caddyAdminViaAgent({
      path: request.path,
      method: request.method,
      body: request.body,
      contentType: request.contentType,
    });
    return { status: response.status, text: response.text, headers: response.headers };
  } catch (error) {
    if (error instanceof AgentUnavailableError) {
      return httpCaddyAdminTransport(request);
    }
    throw error;
  }
};

let transport: CaddyAdminTransport = agentCaddyAdminTransport;

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
