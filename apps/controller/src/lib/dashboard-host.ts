/**
 * Serving CPM's own dashboard through the Caddy it manages.
 *
 * The quickest way to understand what this product does is to watch it proxy something, and the
 * one upstream every deployment already has is the dashboard the operator is reading. So setup
 * turns this on and the dashboard is reachable by name immediately, with no host to create first.
 *
 * It is a *managed* host, not a row in `proxy_hosts`. Those two facts follow from that:
 *
 * - It is synthesised into the Caddy document on every apply, from these settings. Nothing can
 *   delete it out from under the operator, and changing the domain here is the only way to change
 *   it - there is no second copy in the hosts table to drift from this one.
 * - It is put ahead of the stored hosts before routes are built. Routes are then sorted by host
 *   specificity, which decides every case where two hosts could match the same request except one:
 *   two rows claiming the *same* exact domain, where the sort falls back to original order. Being
 *   first is what wins that tie, so a host somebody creates for the dashboard's domain cannot
 *   shadow the route the dashboard is reached through - the page that would fix the mistake is the
 *   one that would have stopped answering.
 *
 * The escape hatch is the reason all of this is safe: the controller publishes its own port
 * (`3000:3000` in the bundled compose file), so a broken dashboard host never locks anybody out -
 * `http://<host>:3000` still serves the settings page that turns it off.
 */

import { Resolver } from "node:dns/promises";
import { config } from "./config";
import {
  PROBE_PARAM,
  PROBE_PATH,
  createProbeNonce,
  probeSignatureMatches,
} from "./reachability-probe";
// Type-only: erased at compile time, so this does not import caddy.ts at runtime and cannot
// close a cycle with the module that consumes buildDashboardHostRow.
import type { ProxyHostRow } from "./caddy";

/** How CPM serves its own dashboard. Stored as the `dashboard` settings blob. */
export type DashboardHostSettings = {
  /** Whether the managed route exists at all. Off means the dashboard is reached by port only. */
  enabled: boolean;
  /** The domain it answers on. */
  domain: string;
  /**
   * Whether to force HTTPS, which is also what asks Caddy to obtain a certificate.
   *
   * Set from a reachability check rather than defaulted to true: a fresh install whose domain does
   * not arrive here yet would otherwise start failing ACME the moment setup finished, and the
   * operator's first experience of the product would be a certificate error.
   */
  tls: boolean;
};

/**
 * The id the synthetic row carries.
 *
 * Negative so it cannot collide with a `proxy_hosts` serial, and so anything that does look this
 * up by id - an access list, a certificate, an agent assignment - finds nothing rather than
 * somebody else's host.
 */
export const DASHBOARD_HOST_ID = -1;

/** Shown as the host's name wherever the generated config is inspected. */
export const DASHBOARD_HOST_NAME = "CPM Dashboard (managed)";

/**
 * Names that describe how to reach a machine from itself, and so cannot be proxied usefully.
 *
 * A deployment reached at `http://localhost:3000` during setup has told us nothing about the name
 * it will be reached at afterwards, and claiming `localhost` in Caddy would take the port-based
 * escape hatch away from the very deployment least likely to have a domain yet.
 */
const NOT_A_PUBLIC_NAME = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]);

/** The hostname in BASE_URL, when it is one this could serve. */
function domainFromBaseUrl(): string {
  try {
    const hostname = new URL(config.baseUrl).hostname.toLowerCase();
    return NOT_A_PUBLIC_NAME.has(hostname) ? "" : hostname;
  } catch {
    return "";
  }
}

/**
 * The domain to serve the dashboard on before anybody has chosen one.
 *
 * DASHBOARD_DOMAIN first, because setting it is an explicit answer. Otherwise the hostname in
 * BASE_URL - the deployment is already being reached there, so it is the name the operator has in
 * hand, and proxying it is exactly what they came to do. Empty when neither says anything usable,
 * which leaves the feature off rather than claiming a domain nobody asked for.
 */
export function seedDashboardDomain(): string {
  return config.dashboardDomain ?? domainFromBaseUrl();
}

export function defaultDashboardSettings(): DashboardHostSettings {
  return { enabled: false, domain: seedDashboardDomain(), tls: false };
}

/**
 * Turn the dashboard host on as setup finishes.
 *
 * Over HTTP, always. The check that decides HTTPS works by asking the domain for a signature only
 * this instance can produce, and at this moment there is nothing on that domain to ask: the route
 * is being created by this very call, no configuration has been applied yet, and on the bundled
 * stack Caddy may not even be running - it starts once an agent is paired. Probing here would
 * answer "unreachable" for reasons that say nothing about the operator's DNS.
 *
 * So the host comes up on HTTP and Settings -> Dashboard Host offers the check, which is
 * meaningful the moment the route is live. That is also the safe order: HTTP works immediately,
 * and HTTPS is turned on once something has confirmed it will succeed.
 */
export function activateDashboardHost(): DashboardHostSettings {
  const domain = seedDashboardDomain();
  if (!domain) return { enabled: false, domain: "", tls: false };
  return { enabled: true, domain, tls: false };
}

/**
 * The synthetic host, or null when there is nothing to serve.
 *
 * Returns a `ProxyHostRow` rather than a Caddy route so it travels the same path every other host
 * does - TLS automation, websocket upgrades, host-header handling, error pages. A hand-built route
 * would have to re-implement each of those and would drift from them at the first change.
 */
export function buildDashboardHostRow(
  settings: DashboardHostSettings | null,
  upstream: string | null,
): ProxyHostRow | null {
  if (!settings?.enabled) return null;

  const domain = settings.domain.trim().toLowerCase();
  if (!domain) return null;

  // No upstream means the controller could not work out how Caddy reaches it. Serving the domain
  // anyway would answer with a proxy error, which is worse than not claiming the domain at all.
  if (!upstream) return null;

  return {
    id: DASHBOARD_HOST_ID,
    name: DASHBOARD_HOST_NAME,
    domains: JSON.stringify([domain]),
    // Plain strings, the shape parseUpstreamTarget reads. http:// because Caddy reaches the
    // controller inside the network the two share, not across the internet.
    upstreams: JSON.stringify([`http://${upstream}`]),
    certificateId: null,
    accessListId: null,
    sslForced: settings.tls ? 1 : 0,
    // Tied to TLS: an HSTS header sent over a domain that is not yet on HTTPS pins the browser to
    // a scheme this host is not serving, and the operator cannot clear it from here.
    hstsEnabled: settings.tls ? 1 : 0,
    hstsSubdomains: 0,
    // The dashboard streams: agent status and the log views are server-sent events.
    allowWebsocket: 1,
    // The controller builds absolute URLs from the request host, and better-auth checks it.
    preserveHostHeader: 1,
    skipHttpsHostnameValidation: 0,
    meta: null,
    enabled: 1,
  };
}

/**
 * A DNS hostname, and nothing that could be mistaken for one.
 *
 * Labels of letters, digits and hyphens, separated by dots, up to the 253 characters DNS allows.
 * That excludes everything an attacker-shaped value would need: `//`, `@`, `:`, `?`, `#`, a path,
 * whitespace, or a bracketed IPv6 literal. A bare IPv4 literal passes, which is intended - an
 * operator may reasonably serve the dashboard on an address rather than a name.
 */
export function isHostname(value: string): boolean {
  const name = value.trim();
  if (name.length === 0 || name.length > 253) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(name);
}

/** What the reachability check found. `ok` is what the TLS toggle is set from. */
export type DashboardDnsCheck = {
  ok: boolean;
  /** Addresses the domain resolves to, empty when it resolves to nothing. */
  resolved: string[];
  /** Why the check answered the way it did. */
  reason: "reached" | "otherServer" | "unreachable" | "unresolved" | "noDomain";
};

/** Bounded so a slow resolver or an unreachable domain cannot hold a form submission open. */
const CHECK_TIMEOUT_MS = 5_000;

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    return await work(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every address the name resolves to, over both families. Empty when it resolves to nothing. */
async function resolveAddresses(name: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: CHECK_TIMEOUT_MS, tries: 1 });
  const [v4, v6] = await Promise.all([
    resolver.resolve4(name).catch(() => [] as string[]),
    resolver.resolve6(name).catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}

/**
 * Ask the domain for a signature only this instance can produce.
 *
 * Answers true only when the response carries the right signature: a server that is not this one
 * can return 200, can return `{"status":"ok"}`, and can echo the nonce, but cannot sign it.
 *
 * Plain HTTP, because this runs before HTTPS has been turned on - proving the name arrives here is
 * the precondition for asking Caddy for a certificate, not something that can wait until after.
 */
async function probeSelf(domain: string): Promise<boolean> {
  // Interpolating the stored setting straight into a URL is what CodeQL flagged, and it was right
  // to. `isHostname` is the narrow gate: letters, digits, dots and hyphens only, so nothing can
  // carry a scheme, credentials, a port, a path or a query into the request. An unusable value
  // means the check simply fails rather than dialling somewhere unintended.
  //
  // Note what is deliberately *not* blocked: an address in private or loopback space. This is a
  // deployment probing its own domain, and plenty of legitimate installs answer on a private
  // address - a LAN-only instance, or one reached through NAT hairpin. Refusing those would break
  // the feature for the deployments most likely to use it, to prevent an administrator from
  // pointing a boolean-valued probe at their own network.
  if (!isHostname(domain)) return false;

  const nonce = createProbeNonce();
  const url = `http://${domain}${PROBE_PATH}?${PROBE_PARAM}=${encodeURIComponent(nonce)}`;

  const answered = await withTimeout(async (signal) => {
    // `redirect: "manual"` rather than following: a redirect to somewhere else is not this
    // instance answering, and chasing it could send the nonce to a third party.
    const response = await fetch(url, { signal, redirect: "manual", cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { probe?: unknown };
    return typeof body.probe === "string" ? body.probe : null;
  });

  return answered !== null && probeSignatureMatches(nonce, answered);
}

/**
 * Whether the domain reaches this instance.
 *
 * Never throws: every failure is an answer of `ok: false` with a reason, because the caller is
 * rendering a warning rather than handling an exception, and a resolver being slow is not a reason
 * to fail their request.
 *
 * DNS resolution is kept alongside the probe purely to tell two failures apart - a name nothing
 * answers for needs a record created, a name that resolves but does not arrive here needs the
 * record or the network fixed. Both are local lookups; nothing is asked of a third party.
 */
export async function checkDashboardDns(
  domain: string,
  // Injected by tests, the way tailscale-api takes its fetchImpl. Real callers pass nothing.
  deps: {
    resolveAddresses?: (name: string) => Promise<string[]>;
    probe?: (name: string) => Promise<boolean>;
  } = {},
): Promise<DashboardDnsCheck> {
  const name = domain.trim().toLowerCase();
  if (!name) return { ok: false, resolved: [], reason: "noDomain" };

  const [resolved, reachedSelf] = await Promise.all([
    withTimeout(async () =>
      deps.resolveAddresses ? await deps.resolveAddresses(name) : await resolveAddresses(name),
    ),
    (deps.probe ?? probeSelf)(name),
  ]);

  const addresses = resolved ?? [];
  if (reachedSelf) return { ok: true, resolved: addresses, reason: "reached" };
  if (addresses.length === 0) return { ok: false, resolved: [], reason: "unresolved" };

  // It resolves and something is there, or nothing is. The probe cannot tell a wrong server from a
  // closed port without reporting more than it can be sure of, so both read as "did not reach
  // here" and the message covers the ways that happens.
  return { ok: false, resolved: addresses, reason: "otherServer" };
}
