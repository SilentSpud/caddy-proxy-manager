/**
 * Keeping Caddy's admin API on the address it was meant to bind, whoever sends the config.
 *
 * The controller writes one admin block for every Caddy, bound to every interface. On a Docker
 * network Caddy shares with the upstreams it proxies, that hands the admin API to each of them. The
 * agent pins it on the way through, and so does the controller when it loads a config directly.
 */

/** Whether a request replaces Caddy's running config, and so carries an admin block of its own. */
export function loadsConfig(request: { method: string; path: string }): boolean {
  const path = request.path.split("?")[0];
  if (path === "/load") return true;
  return /^\/config\/?$/.test(path) && request.method.toUpperCase() !== "GET";
}

/**
 * Pin the admin listener of a config on its way to Caddy, or null for a body that is not a JSON
 * object - refused rather than forwarded unpinned.
 */
export function pinAdminListen(body: string, listen: string): string | null {
  let config: unknown;
  try {
    config = JSON.parse(body);
  } catch {
    return null;
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;

  const root = config as Record<string, unknown>;
  const admin =
    root.admin && typeof root.admin === "object" && !Array.isArray(root.admin)
      ? (root.admin as Record<string, unknown>)
      : {};
  // A named bind turns on Caddy's Host check, so the name the sender dials has to be an origin.
  const origins = Array.isArray(admin.origins)
    ? admin.origins.filter((origin): origin is string => typeof origin === "string")
    : [];
  root.admin = {
    ...admin,
    listen,
    origins: origins.includes(listen) ? origins : [...origins, listen],
  };
  return JSON.stringify(root);
}
