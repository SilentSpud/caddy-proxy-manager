/**
 * Downloading the MaxMind databases, which the geoipupdate container used to do.
 *
 * A timer in this process asks MaxMind's metadata endpoint what it has built and downloads only an
 * edition that is missing or whose build differs from the one on disk. The build each file came
 * from is stored rather than read off its mtime: a download that lands on the day MaxMind publishes
 * a second build would otherwise read as current until the next one.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { GEOIP_EDITIONS, type GeoipEdition } from "@cpm/shared";
import { geoipDatabasePath, geoipEnabled } from "../agent/geoip";
import { getSetting, setSetting } from "../settings";
import { outsideStagingScope } from "../settings/staging-context";
import { checkGeoipUpdates, geoipCredentials } from "./update-check";

const DOWNLOAD_URL = "https://download.maxmind.com/geoip/databases";

/** How often the timer wakes to see whether a check is due. The interval itself is a setting. */
const WAKE_MS = 15 * 60 * 1000;

/** Generous: City is tens of megabytes over whatever link this host has. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Several times the largest archive. Only there so an endless body cannot exhaust memory. */
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

const STATE_KEY = "geoip_downloads";

/** The mmdb format puts this before its metadata section, within the file's last 128 KiB. */
const METADATA_MARKER = Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from("MaxMind.com", "ascii")]);
const METADATA_SEARCH_BYTES = 128 * 1024;

export type GeoipDownloadState = {
  /** When the updater last ran with GeoIP enabled and credentials set, or null if never. */
  ranAt: string | null;
  /** Why the last run failed, when any part of it did. */
  error: string | null;
  /** Edition to the MaxMind build date, ISO `YYYY-MM-DD`, of the file on disk. */
  builds: Partial<Record<GeoipEdition, string>>;
};

export type GeoipUpdateResult = {
  downloaded: GeoipEdition[];
  error: string | null;
  /** Set when nothing was attempted, so a caller can say why. */
  skipped?: "disabled" | "unconfigured";
};

export async function getGeoipDownloadState(): Promise<GeoipDownloadState> {
  const stored = await getSetting<GeoipDownloadState>(STATE_KEY);
  return {
    ranAt: stored?.ranAt ?? null,
    error: stored?.error ?? null,
    builds: stored?.builds ?? {},
  };
}

/**
 * Read a body into memory, refusing more than `maxBytes`. Counted as it streams, since
 * Content-Length is the sender's claim and may be absent.
 */
export async function readCapped(
  response: Response,
  maxBytes = MAX_ARCHIVE_BYTES,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`the download declared ${declared} bytes, over the ${maxBytes} byte limit`);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`the download exceeded the ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetch one edition's `.tar.gz` from MaxMind.
 *
 * `fetchImpl` is a parameter so the redirect and error handling can be tested without the network.
 */
export async function fetchGeoipArchive(
  edition: GeoipEdition,
  accountId: string,
  licenseKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const url = `${DOWNLOAD_URL}/${edition}/download?suffix=tar.gz`;
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);

  let response = await fetchImpl(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString("base64")}`,
    },
    redirect: "manual",
    signal,
  });

  // MaxMind redirects to presigned storage, which refuses a request carrying a second credential,
  // so the Authorization header must not follow the redirect.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("MaxMind redirected without saying where");
    response = await fetchImpl(new URL(location, url).toString(), { signal });
  }

  if (response.status === 401) {
    throw new Error("MaxMind rejected the account ID or licence key");
  }
  if (!response.ok) {
    throw new Error(`MaxMind answered HTTP ${response.status}`);
  }
  return readCapped(response);
}

/**
 * Whether `bytes` ends like a MaxMind database: cheaper than opening it, and enough to refuse an
 * error page that arrived with a 200.
 */
export function looksLikeMmdb(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const from = Math.max(0, buffer.byteLength - METADATA_SEARCH_BYTES);
  return buffer.subarray(from).lastIndexOf(METADATA_MARKER) !== -1;
}

/**
 * Pull `<edition>.mmdb` out of MaxMind's archive, with the build date its directory is named for.
 *
 * The archive holds `<edition>_<YYYYMMDD>/` with the database, a licence and a copyright notice.
 */
export async function extractGeoipDatabase(
  archive: Uint8Array,
  edition: GeoipEdition,
): Promise<{ bytes: Uint8Array; build: string | null }> {
  let files: Map<string, Blob>;
  try {
    files = await new Bun.Archive(archive).files("**/*.mmdb");
  } catch {
    throw new Error("the download is not a readable archive");
  }

  for (const [path, file] of files) {
    if (basename(path) !== `${edition}.mmdb`) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeMmdb(bytes)) throw new Error(`${edition}.mmdb in the download is not a database`);
    const date = /_(\d{4})(\d{2})(\d{2})\//.exec(path);
    return { bytes, build: date ? `${date[1]}-${date[2]}-${date[3]}` : null };
  }
  throw new Error(`the download has no ${edition}.mmdb in it`);
}

/**
 * Swap a database into place.
 *
 * Through a uniquely named file in the same directory: the agent route may be streaming the old one,
 * and a rename leaves that read on the file it opened rather than a half-written one.
 */
export function installGeoipDatabase(edition: GeoipEdition, bytes: Uint8Array): void {
  const target = geoipDatabasePath(edition);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(4).toString("hex")}.download`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

let inFlight: Promise<GeoipUpdateResult> | null = null;

/**
 * Bring every edition up to date with MaxMind, and tell the agents when anything changed.
 *
 * Never throws: failures are recorded in the stored state, where the settings page reads them.
 */
export function updateGeoipDatabases(fetchImpl: typeof fetch = fetch): Promise<GeoipUpdateResult> {
  if (inFlight) return inFlight;
  inFlight = run(fetchImpl)
    .catch((error: unknown): GeoipUpdateResult => {
      console.error("[geoip] update failed:", error);
      return { downloaded: [], error: error instanceof Error ? error.message : String(error) };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function run(fetchImpl: typeof fetch): Promise<GeoipUpdateResult> {
  if (!(await geoipEnabled())) return { downloaded: [], error: null, skipped: "disabled" };
  const { accountId, licenseKey } = await geoipCredentials();
  if (!accountId || !licenseKey) return { downloaded: [], error: null, skipped: "unconfigured" };

  const state = await getGeoipDownloadState();
  const builds = { ...state.builds };
  // Also what the settings page reports as "last checked", so each tick keeps that current.
  const check = await checkGeoipUpdates(GEOIP_EDITIONS, fetchImpl);

  const downloaded: GeoipEdition[] = [];
  // Download failures only: a failed check is already stored, and shown, by the check itself.
  const failures: string[] = [];
  for (const edition of GEOIP_EDITIONS) {
    const available = check.available[edition];
    // With the check failed the answer is unknown, and a file already here is kept rather than
    // downloaded blind against MaxMind's daily download limit.
    const current =
      existsSync(geoipDatabasePath(edition)) &&
      (available === undefined || builds[edition] === available);
    if (current) continue;

    // Sequentially: three archives at once over one link is no faster and harder to read when it fails.
    try {
      const archive = await fetchGeoipArchive(edition, accountId, licenseKey, fetchImpl);
      const { bytes, build } = await extractGeoipDatabase(archive, edition);
      installGeoipDatabase(edition, bytes);
      const stamp = build ?? available;
      if (stamp) builds[edition] = stamp;
      else delete builds[edition];
      downloaded.push(edition);
      console.log(
        `[geoip] downloaded ${edition} (${bytes.byteLength} bytes, built ${stamp ?? "unknown"})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[geoip] could not download ${edition}: ${message}`);
      failures.push(`${edition}: ${message}`);
    }
  }

  const stored = failures.length > 0 ? failures.join("; ") : null;
  // A cache of what is on disk, not configuration, so it must not land in a staged change set.
  await outsideStagingScope(() =>
    setSetting<GeoipDownloadState>(STATE_KEY, {
      ranAt: new Date().toISOString(),
      error: stored,
      builds,
    }),
  );

  if (downloaded.length > 0) {
    // Every push has agents re-check the route, and the new ETag makes them download.
    const { pushFleetConfig } = await import("../agent/fleet-config");
    await pushFleetConfig();
  }
  const error = [check.error, stored].filter(Boolean).join("; ");
  return { downloaded, error: error || null };
}

/**
 * Whether the configured interval has passed since the last run.
 *
 * Measured from the stored run rather than from process start, so a restart does not reset the
 * clock, and a changed interval applies at the next wake without a timer to reschedule.
 */
export function geoipUpdateDue(
  ranAt: string | null,
  intervalHours: number,
  now = Date.now(),
): boolean {
  if (!ranAt) return true;
  const last = Date.parse(ranAt);
  return !Number.isFinite(last) || now - last >= intervalHours * 60 * 60 * 1000;
}

async function updateIfDue(): Promise<void> {
  const [registry, { getSetting: resolve }] = await Promise.all([
    import("../settings/registry"),
    import("../settings/resolve"),
  ]);
  const [state, intervalHours] = await Promise.all([
    getGeoipDownloadState(),
    resolve(registry.geoipUpdateIntervalHours),
  ]);
  if (geoipUpdateDue(state.ranAt, intervalHours)) await updateGeoipDatabases();
}

let timer: NodeJS.Timeout | null = null;

/** Check now if a check is due, and again at every wake. Idempotent. */
export function startGeoipUpdater(): void {
  if (timer) return;
  const wake = () => {
    void updateIfDue().catch((error: unknown) => {
      console.error("[geoip] scheduled update failed:", error);
    });
  };
  wake();
  timer = setInterval(wake, WAKE_MS);
  timer.unref();
}
