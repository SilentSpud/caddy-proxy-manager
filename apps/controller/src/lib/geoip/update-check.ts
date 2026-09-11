/**
 * Asking MaxMind whether a newer database exists, and remembering when we last asked.
 *
 * The file on disk only says when a download last *landed*. geoipupdate leaves no trace of a run
 * that found nothing new - its lock file is created once and never rewritten - so an operator
 * cannot tell "MaxMind has published nothing since Tuesday" from "the updater died on Tuesday".
 * This closes that gap by checking for itself and storing when it did.
 *
 * Same shape as ./../updates.ts, deliberately: nothing in this process runs on a schedule, so a
 * read refreshes a stale answer behind the caller and returns what was already known. A page never
 * waits on MaxMind, and a failure is cached so an unreachable endpoint is retried on the same
 * schedule as a success rather than on every render.
 */

import { getSetting, setSetting } from "../settings";
import { outsideStagingScope } from "../settings/staging-context";

const CACHE_KEY = "geoip_update_check";

/**
 * MaxMind's metadata endpoint: the database's build date and checksum, without downloading it.
 *
 * The same endpoint geoipupdate itself uses to decide whether to fetch, so a check here costs what
 * its check costs - a few hundred bytes - rather than tens of megabytes.
 */
const METADATA_URL = "https://updates.maxmind.com/geoip/updates/metadata";

/** How long an answer stands before a read kicks off a refresh behind it. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** MaxMind must not hold a page open; the cached answer is served regardless. */
const REQUEST_TIMEOUT_MS = 10_000;

export type GeoipUpdateCheck = {
  checkedAt: string;
  /** Null when the check succeeded. Cached either way - see the note above. */
  error: string | null;
  /** Edition id to the date MaxMind last built it, ISO `YYYY-MM-DD`. */
  available: Record<string, string>;
};

export type GeoipUpdateCheckStatus = {
  /** When MaxMind was last asked, or null when it never has been. */
  checkedAt: string | null;
  error: string | null;
  available: Record<string, string>;
};

type MetadataResponse = {
  databases?: { edition_id?: unknown; date?: unknown }[] | null;
};

async function credentials(): Promise<{ accountId: string; licenseKey: string }> {
  const [registry, { getSetting: resolve }] = await Promise.all([
    import("../settings/registry"),
    import("../settings/resolve"),
  ]);
  const [accountId, licenseKey] = await Promise.all([
    resolve(registry.geoipAccountId),
    resolve(registry.geoipLicenseKey),
  ]);
  return { accountId: accountId.trim(), licenseKey: licenseKey.trim() };
}

/**
 * Read the build dates MaxMind reports for the given editions.
 *
 * `fetchImpl` is a parameter so the parsing and error mapping can be tested without reaching the
 * network; production callers never pass it.
 */
export async function fetchGeoipMetadata(
  editions: readonly string[],
  accountId: string,
  licenseKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  if (editions.length === 0) return {};

  const url = new URL(METADATA_URL);
  for (const edition of editions) url.searchParams.append("edition_id", edition);

  const response = await fetchImpl(url.toString(), {
    headers: {
      // MaxMind authenticates the account id as the username and the licence key as the password.
      Authorization: `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString("base64")}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401) {
    throw new Error("MaxMind rejected the account ID or licence key");
  }
  if (!response.ok) {
    throw new Error(`MaxMind answered HTTP ${response.status}`);
  }

  const body = (await response.json()) as MetadataResponse;
  const available: Record<string, string> = {};
  for (const database of body.databases ?? []) {
    // Defensive: an unexpected row is skipped rather than poisoning the whole answer, because the
    // shape comes from a third party and one odd entry should not lose the others.
    if (typeof database?.edition_id === "string" && typeof database?.date === "string") {
      available[database.edition_id] = database.date;
    }
  }
  return available;
}

/** Guards against a stampede: several readers finding the answer stale ask MaxMind only once. */
let inFlight: Promise<GeoipUpdateCheck> | null = null;

/**
 * Ask MaxMind now and store the result, whether it succeeded or not.
 *
 * Exported so the GeoIP settings section can offer a "check now" button: the whole point of the
 * stored timestamp is that an operator can see the check happen rather than wonder.
 */
export async function checkGeoipUpdates(editions: readonly string[]): Promise<GeoipUpdateCheck> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<GeoipUpdateCheck> => {
    const result: GeoipUpdateCheck = {
      checkedAt: new Date().toISOString(),
      error: null,
      available: {},
    };

    const { accountId, licenseKey } = await credentials();
    if (!accountId || !licenseKey) {
      result.error = "No MaxMind account ID and licence key are configured";
    } else {
      try {
        result.available = await fetchGeoipMetadata(editions, accountId, licenseKey);
      } catch (error) {
        result.error =
          error instanceof Error && error.name === "TimeoutError"
            ? "MaxMind did not answer in time"
            : error instanceof Error
              ? error.message
              : "The check failed";
      }
    }

    // A cache, not configuration: written outside any staging scope so a refresh that a settings
    // page happened to trigger cannot land in that operator's pending change set.
    await outsideStagingScope(() => setSetting<GeoipUpdateCheck>(CACHE_KEY, result));
    return result;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * What is known about update checks, refreshing behind the caller when it has gone stale.
 *
 * Never awaits the network. The first render after enabling GeoIP reports no check yet and the
 * next one has the answer.
 */
export async function getGeoipUpdateCheck(
  editions: readonly string[],
): Promise<GeoipUpdateCheckStatus> {
  const cached = await getSetting<GeoipUpdateCheck>(CACHE_KEY);

  const age = cached ? Date.now() - Date.parse(cached.checkedAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(age) || age > CACHE_TTL_MS) {
    // Deliberately not awaited, and its failure is already recorded in the stored result - an
    // unhandled rejection here would take down the render this was meant not to block.
    void checkGeoipUpdates(editions).catch(() => {});
  }

  return {
    checkedAt: cached?.checkedAt ?? null,
    error: cached?.error ?? null,
    available: cached?.available ?? {},
  };
}

/**
 * Editions where MaxMind has built a database more recently than the copy on disk was written.
 *
 * The comparison is deliberately coarse - a build date against a file's write date, both to the
 * day - because that is the resolution MaxMind publishes and a few hours either way does not
 * change the answer to "is the updater keeping up".
 */
export function editionsBehind(
  available: Record<string, string>,
  installed: { edition: string; updatedAt: Date }[],
): string[] {
  const behind: string[] = [];
  for (const database of installed) {
    const built = available[database.edition];
    if (!built) continue;
    const builtAt = Date.parse(`${built}T00:00:00Z`);
    if (!Number.isFinite(builtAt)) continue;

    // Compare on the day the file was written, so a database downloaded the same day it was built
    // never reads as behind.
    const writtenDay = Date.parse(`${database.updatedAt.toISOString().slice(0, 10)}T00:00:00Z`);
    if (builtAt > writtenDay) behind.push(database.edition);
  }
  return behind;
}
