/**
 * Telling an operator that a newer image has been published.
 *
 * The check reads the tag list of the registry the deployment pulls from, so it reports what could
 * actually be deployed rather than what has been tagged in git. The repository is a setting because
 * a fork publishes to its own namespace - a hard-coded `ghcr.io/silentspud/...` would tell everyone
 * running `ghcr.io/theirname/...` about releases they cannot pull.
 *
 * Nothing here runs on a schedule: there is no scheduler in this process. A read refreshes a stale
 * result in the background and returns what it already had, so a page never waits on the network
 * and a registry that is slow or down costs a render nothing.
 */

import { APP_VERSION } from "./app-version";
import { type StoredErrorCode, domainError, storedErrorCode } from "./domain-error";
import { getSetting, setSetting } from "./settings";

const CACHE_KEY = "update_check";

/**
 * The image the version is read from.
 *
 * `web` is the controller itself - the thing APP_VERSION describes. caddy and agent are released
 * from the same tags, so checking one is checking all three.
 */
const VERSIONED_IMAGE = "web";

/** How long a result stands before a read kicks off a refresh behind it. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A slow registry must not hold a request open; the cached answer is served regardless. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Bounded so a repository with thousands of tags cannot walk pages indefinitely. */
const MAX_TAG_PAGES = 10;

type CachedCheck = {
  checkedAt: string;
  latest: string | null;
  error: string | null;
  /** The code behind `error`, when it had one. Absent from a result stored before codes were. */
  errorCode?: StoredErrorCode | null;
  /** What was checked. A changed repository setting makes the stored result irrelevant. */
  repository: string;
};

/** Store a failure as its English and, when it has one, its code. */
function recordFailure(result: CachedCheck, failure: Error): void {
  result.error = failure.message;
  result.errorCode = storedErrorCode(failure);
}

export type UpdateStatus = {
  enabled: boolean;
  /** This build's version, or "unknown" for a dev build with no APP_VERSION baked in. */
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  /** Why the last check failed, for a page that would otherwise just say nothing. */
  error: string | null;
  /** Its code, for `storedErrorMessage` to say it in the reader's language. */
  errorCode: StoredErrorCode | null;
  repository: string;
};

// ── Version comparison ───────────────────────────────────────────────────────

type Semver = { major: number; minor: number; patch: number; prerelease: string[] };

/**
 * Parse a release tag, or null for anything that is not one.
 *
 * All three numbers are required, which is what separates a release from the moving aliases the
 * build publishes beside it: `latest`, `3`, `3.0` and `sha-abc1234` are all deliberately rejected,
 * because none of them names a version this could compare against.
 */
export function parseSemver(tag: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Compare one prerelease identifier: numeric ones sort below alphanumeric, and numerically. */
function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` is older. Follows semver's precedence rules, prereleases included. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // 3.0.0-beta.2 precedes 3.0.0. An absent prerelease is the higher version, not the lower one -
  // getting this backwards would announce an "update" to the beta an operator just moved off.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index++) {
    const result = comparePrereleaseIdentifier(a.prerelease[index], b.prerelease[index]);
    if (result !== 0) return result;
  }
  return a.prerelease.length - b.prerelease.length;
}

/** The newest release among a tag list, ignoring everything that is not one. */
export function newestRelease(tags: string[]): string | null {
  let best: { tag: string; parsed: Semver } | null = null;
  for (const tag of tags) {
    const parsed = parseSemver(tag);
    if (!parsed) continue;
    if (!best || compareSemver(parsed, best.parsed) > 0) best = { tag, parsed };
  }
  return best?.tag ?? null;
}

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * Split `ghcr.io/owner/name` into its host and path, with or without a trailing slash.
 *
 * Forced to https and required to look like a registry reference. This value becomes a URL the
 * *server* fetches, and while only an admin can set it - an admin who already configures Caddy
 * upstreams and DNS credentials - there is no reason to let it name a scheme or a shape that is
 * not a registry.
 */
export function parseRepository(repository: string): { host: string; path: string } | null {
  const trimmed = repository
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*(:\d{1,5})?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  const separator = trimmed.indexOf("/");
  return { host: trimmed.slice(0, separator), path: trimmed.slice(separator + 1) };
}

/**
 * The next page's URL, or null when the registry says there is no next page.
 *
 * The link is refused unless it stays on the host the check was pointed at. `new URL(value, base)`
 * ignores the base the moment the value is absolute, so without this a registry could name any
 * host it liked in a `Link` header and have this server fetch it - carrying the bearer token
 * `listTags` is holding at the time. A real registry pages with a relative link, which is
 * unaffected; anything else is reported rather than followed, because a check that quietly stopped
 * paging could go on reporting "up to date" from half a tag list.
 */
export function nextPageUrl(header: string | null, host: string): string | null {
  const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(header ?? "");
  if (!match) return null;

  const expected = new URL(`https://${host}/`);
  let next: URL;
  try {
    next = new URL(match[1], expected);
  } catch {
    throw domainError("registryPaginationNotUrl");
  }

  // Origin rather than hostname: a link that downgrades to http, or moves to another port, is as
  // much a different destination as one that names another host. Both origins are named because
  // this text is what an operator is shown, and "somewhere else" would not tell them where.
  if (next.origin !== expected.origin) {
    throw domainError("registryPaginatedElsewhere", {
      origin: next.origin,
      expected: expected.origin,
    });
  }
  return next.toString();
}

/** Token services a registry is known to send its auth challenge to, besides itself. */
const TOKEN_SERVICE_HOSTS: Record<string, readonly string[]> = {
  "docker.io": ["auth.docker.io"],
  "index.docker.io": ["auth.docker.io"],
  "registry-1.docker.io": ["auth.docker.io"],
  "registry.gitlab.com": ["gitlab.com"],
};

/**
 * The token endpoint a `WWW-Authenticate` realm names, refused unless it is one to follow.
 *
 * The same hazard as `nextPageUrl`: the realm is a URL the registry picks and this server fetches.
 * So it has to be https, on the registry's own origin or a token service that registry is known to
 * use - otherwise a registry could point the check at anything this host can reach.
 */
export function tokenRealmUrl(realm: string, host: string): URL {
  let url: URL;
  try {
    url = new URL(realm);
  } catch {
    throw domainError("registryRealmNotUrl");
  }

  const registry = new URL(`https://${host}/`);
  const knownService =
    url.port === "" && (TOKEN_SERVICE_HOSTS[registry.hostname] ?? []).includes(url.hostname);
  if (url.protocol !== "https:" || (url.host !== registry.host && !knownService)) {
    throw domainError("registryRealmElsewhere", { origin: url.origin, expected: registry.origin });
  }
  return url;
}

/** The realm/service/scope out of a `WWW-Authenticate: Bearer ...` challenge. */
function parseChallenge(header: string): Record<string, string> | null {
  if (!/^bearer /i.test(header)) return null;
  const fields: Record<string, string> = {};
  for (const [, key, value] of header.slice(7).matchAll(/([a-z]+)="([^"]*)"/gi)) {
    fields[key.toLowerCase()] = value;
  }
  return fields.realm ? fields : null;
}

/**
 * List a repository's tags, following the registry's own auth challenge.
 *
 * The challenge is followed rather than the token endpoint being hard-coded, because that is the
 * standard the registry API defines and it is what makes this work against a fork's registry
 * without special-casing each one. For a public image the token comes back anonymously.
 */
async function listTags(host: string, repository: string, signal: AbortSignal): Promise<string[]> {
  let url: string | null = `https://${host}/v2/${repository}/tags/list?n=100`;
  let token: string | null = null;
  const tags: string[] = [];

  for (let page = 0; page < MAX_TAG_PAGES && url; page++) {
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;

    let response = await fetch(url, { headers, signal, redirect: "follow" });

    if (response.status === 401 && !token) {
      const challenge = parseChallenge(response.headers.get("www-authenticate") ?? "");
      if (!challenge) throw domainError("registryCredentialsRequired");

      const tokenUrl = tokenRealmUrl(challenge.realm, host);
      if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
      tokenUrl.searchParams.set("scope", challenge.scope ?? `repository:${repository}:pull`);

      const tokenResponse = await fetch(tokenUrl, {
        headers: { accept: "application/json" },
        signal,
        // A redirect would carry the request past the check above.
        redirect: "error",
      });
      if (!tokenResponse.ok) {
        throw domainError("registryTokenRefused", { status: tokenResponse.status });
      }
      const issued = (await tokenResponse.json()) as { token?: string; access_token?: string };
      token = issued.token ?? issued.access_token ?? null;
      if (!token) throw domainError("registryNoToken");

      response = await fetch(url, {
        headers: { ...headers, authorization: `Bearer ${token}` },
        signal,
      });
    }

    if (response.status === 404) throw domainError("registryRepositoryNotFound");
    if (!response.ok) throw domainError("registryHttpStatus", { status: response.status });

    const body = (await response.json()) as { tags?: string[] | null };
    if (Array.isArray(body.tags)) tags.push(...body.tags);

    // Registries page with a Link header rather than a cursor in the body.
    url = nextPageUrl(response.headers.get("link"), host);
  }

  return tags;
}

// ── Checking ─────────────────────────────────────────────────────────────────

async function settings(): Promise<{ enabled: boolean; repository: string }> {
  const [registry, { getSetting: resolve }] = await Promise.all([
    import("./settings/registry"),
    import("./settings/resolve"),
  ]);
  const [enabled, repository] = await Promise.all([
    resolve(registry.updateCheckEnabled),
    resolve(registry.updateImageRepository),
  ]);
  return { enabled, repository };
}

/** Guards against a stampede: several readers finding the cache stale at once ask only once. */
let inFlight: Promise<CachedCheck> | null = null;

/**
 * Query the registry and store the result, whether it succeeded or not.
 *
 * A failure is cached too, so a registry that is unreachable is retried on the same schedule as a
 * success rather than on every page load - and so the operator can be told *why* the answer is
 * missing instead of being shown a check that silently never happened.
 */
export async function checkForUpdates(): Promise<CachedCheck> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<CachedCheck> => {
    const { repository } = await settings();
    const result: CachedCheck = {
      checkedAt: new Date().toISOString(),
      latest: null,
      error: null,
      errorCode: null,
      repository,
    };

    const parsed = parseRepository(repository);
    if (!parsed) {
      recordFailure(result, domainError("updateRepositoryInvalid", { repository }));
    } else {
      try {
        const tags = await listTags(
          parsed.host,
          `${parsed.path}/${VERSIONED_IMAGE}`,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        );
        result.latest = newestRelease(tags);
        if (!result.latest) recordFailure(result, domainError("updateNoReleases"));
      } catch (error) {
        recordFailure(
          result,
          error instanceof Error && error.name === "TimeoutError"
            ? domainError("updateTimedOut")
            : error instanceof Error
              ? error
              : domainError("checkFailed"),
        );
      }
    }

    await setSetting<CachedCheck>(CACHE_KEY, result);
    return result;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * What to show, refreshing behind the caller when the stored answer has gone stale.
 *
 * Never awaits the network. A page that renders this gets whatever is already known - including
 * nothing at all, on the first load after enabling it - and the next render has the answer.
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const { enabled, repository } = await settings();

  // Nothing is known while the check is off, and the cached answer is not an exception. Reporting
  // it let the Settings page say "3.0.0 is the newest release published, so this is up to date"
  // from a check that stopped running months ago - with no way to refresh it, since "Check now"
  // is disabled along with the setting. The cache row is left alone, so re-enabling shows the last
  // answer again immediately rather than waiting for the first refresh.
  if (!enabled) {
    return {
      enabled: false,
      current: APP_VERSION,
      latest: null,
      updateAvailable: false,
      checkedAt: null,
      error: null,
      errorCode: null,
      repository,
    };
  }

  const cached = await getSetting<CachedCheck>(CACHE_KEY);

  const status: UpdateStatus = {
    enabled,
    current: APP_VERSION,
    latest: cached?.repository === repository ? (cached.latest ?? null) : null,
    updateAvailable: false,
    checkedAt: cached?.repository === repository ? cached.checkedAt : null,
    error: cached?.repository === repository ? (cached.error ?? null) : null,
    errorCode: cached?.repository === repository ? (cached.errorCode ?? null) : null,
    repository,
  };

  const age = status.checkedAt
    ? Date.now() - Date.parse(status.checkedAt)
    : Number.POSITIVE_INFINITY;
  if (age > CACHE_TTL_MS) {
    // Deliberately not awaited, and deliberately swallowed: this is a background refresh for the
    // *next* render, and an unreachable registry must not surface as an unhandled rejection.
    void checkForUpdates().catch(() => {});
  }

  status.updateAvailable = isNewer(status.current, status.latest);
  return status;
}

/**
 * Whether `latest` is a release beyond `current`.
 *
 * False whenever the comparison cannot be made - an unknown current version, a build ahead of the
 * registry - because the cost of a wrong "yes" is an operator chasing an update that is not there.
 */
export function isNewer(current: string, latest: string | null): boolean {
  if (!latest) return false;
  const a = parseSemver(current);
  const b = parseSemver(latest);
  if (!a || !b) return false;
  return compareSemver(b, a) > 0;
}
