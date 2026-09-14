/**
 * The address users reach this instance at: the Public URL setting, where a value stored by setup
 * or Settings wins over BASE_URL. OAuth redirect URIs, the forward-auth portal and the origin
 * checks that guard it are all built from it, so everything that shows or uses the public address
 * reads it here rather than from `config.baseUrl`, which is the environment alone.
 *
 * The settings modules are imported lazily, as caddy-admin.ts does: they read process.env on first
 * load, and a static import would freeze that before a test could set it.
 */
import { config } from "./config";

/** The Public URL without a trailing slash. Falls back to BASE_URL when settings cannot be read. */
export async function getPublicBaseUrl(): Promise<string> {
  try {
    const [{ baseUrl }, { getSetting }] = await Promise.all([
      import("./settings/registry"),
      import("./settings/resolve"),
    ]);
    return (await getSetting(baseUrl)).replace(/\/+$/, "");
  } catch {
    return config.baseUrl.replace(/\/+$/, "");
  }
}

/**
 * The origins this instance answers as its own: BASE_URL's and the Public URL's, deduplicated.
 *
 * Both, not just the Public URL: an operator who has just stored a different one is still on the
 * address they were reached at, and their session must not be refused for it. Used wherever a
 * request has to come from this app's own pages - the forward-auth portal, and Better Auth's
 * trusted origins.
 */
export async function publicOrigins(): Promise<string[]> {
  const origins = new Set<string>();
  for (const url of [config.baseUrl, await getPublicBaseUrl()]) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A malformed URL is refused by the settings validation elsewhere; trust nothing for it.
    }
  }
  return [...origins];
}

/** Whether `origin` - an Origin header, say - is one of this instance's own. */
export async function isPublicOrigin(origin: string | null): Promise<boolean> {
  if (!origin) return false;
  return (await publicOrigins()).includes(origin);
}
