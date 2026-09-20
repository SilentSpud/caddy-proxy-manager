/**
 * The origins Better Auth trusts beyond the `baseURL` it was built with, which it adds by itself.
 *
 * That alone locks out a fresh deployment reached any other way. Compose defaults BASE_URL to
 * http://localhost:3000, so an operator opening http://<server-ip>:3000 is refused at the setup
 * sign-in - before the step that asks for the public URL is reachable at all.
 *
 * Three additions:
 *
 * - The Public URL setting and BASE_URL, both. The Public URL is what the instance is built with,
 *   but trusting BASE_URL as well keeps an operator who just stored a different Public URL signed
 *   in from the address they were already using.
 * - The dashboard host's own origin. That domain is this application, served by the Caddy it
 *   manages, and it is rarely the Public URL - setup seeds it from BASE_URL's hostname, which
 *   differs by port alone. Without it, the dashboard answers on the domain an operator was sent to
 *   and then refuses the sign-in that domain exists for.
 * - Until setup is finished, the address the browser is already using, and only when the request
 *   is same-origin: the Origin it sends names the host the request was sent to. That is the whole
 *   of what the origin check defends. A cross-site page cannot forge Origin, and a DNS-rebound one
 *   carries no cookies for this host. It ends with setup because from then on the Public URL is a
 *   real answer, and anything else being trusted would be a quiet way to leave it wrong.
 */
import { publicOrigins } from "./public-url";

/** Setup never becomes unfinished again, so once seen it no longer costs a query. */
let setupFinished = false;

/** Test seam: forget that setup was seen finished. */
export function resetTrustedOriginsCache(): void {
  setupFinished = false;
}

/**
 * The origin a request claims, when it matches the host the request was sent to. Null for
 * anything cross-origin, opaque ("null"), unparseable or not http(s).
 */
export function sameOriginOf(request: Request): string | null {
  // Referer as Better Auth falls back to it: some same-origin POSTs arrive without Origin.
  const claimed = request.headers.get("origin") || request.headers.get("referer");
  if (!claimed || claimed === "null") return null;

  let origin: URL;
  let host: string;
  try {
    origin = new URL(claimed);
    host = request.headers.get("host") ?? new URL(request.url).host;
  } catch {
    return null;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return null;
  return origin.host.toLowerCase() === host.toLowerCase() ? origin.origin : null;
}

/**
 * The dashboard host's origin, or null when it serves nothing. Never throws: an unreadable setting
 * trusts one origin fewer, which is the safe direction.
 */
async function dashboardOrigin(): Promise<string | null> {
  try {
    const [{ dashboardHostOrigin }, { getDashboardSettings }] = await Promise.all([
      import("./dashboard-host"),
      import("./settings"),
    ]);
    return dashboardHostOrigin(await getDashboardSettings());
  } catch {
    return null;
  }
}

/** Whether setup is finished. Fails closed: an unreadable flag counts as finished, uncached. */
async function isSetupFinished(): Promise<boolean> {
  if (setupFinished) return true;
  try {
    const { isSetupCompleted } = await import("./setup");
    setupFinished = await isSetupCompleted();
    return setupFinished;
  } catch {
    return true;
  }
}

/**
 * Better Auth's `trustedOrigins`. Called on every auth request, and only the setup flag is
 * remembered - once setup is seen finished it stops costing a query. The Public URL and the
 * dashboard host are two `getSetting` calls, so two indexed single-row reads, on every auth
 * request; `settings` caches nothing. Worth revisiting if it ever shows up in a profile, but auth
 * already reads the session row from the same database.
 */
export async function extraTrustedOrigins(request?: Request): Promise<string[]> {
  const origins = new Set(await publicOrigins());

  const dashboard = await dashboardOrigin();
  if (dashboard) origins.add(dashboard);

  if (request && !(await isSetupFinished())) {
    const own = sameOriginOf(request);
    if (own) origins.add(own);
  }

  return [...origins];
}
