/**
 * The MaxMind databases the controller holds, and how an agent is told to fetch them.
 *
 * The files come from the `geoipupdate` container into a shared volume. The controller does not
 * manage them beyond serving them: it holds the subscription, and agents on other hosts reach them
 * through it rather than each holding a licence key.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CONTROLLER_GEOIP_ROUTE,
  GEOIP_EDITIONS,
  type FleetConfig,
  type GeoipEdition,
} from "@cpm/shared";
import { config } from "../config";

/**
 * Where the geoipupdate container leaves them, and where Caddy reads them.
 *
 * Read per call rather than captured at module load: this is a mount point, and freezing it at
 * import makes the value depend on which module happened to load first.
 */
function geoipDir(): string {
  return process.env.GEOIP_DIR || "/usr/share/GeoIP";
}

export function geoipDatabasePath(edition: GeoipEdition): string {
  return join(geoipDir(), `${edition}.mmdb`);
}

/**
 * A strong ETag for a database file.
 *
 * Size and mtime rather than a content hash: these files are tens of megabytes, this runs on every
 * agent's daily check, and geoipupdate replaces the file wholesale - so a changed file always has
 * a changed mtime, and hashing it would buy nothing but I/O.
 */
export function geoipEtag(path: string): string {
  const stat = statSync(path);
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/** The editions this controller currently holds on disk. */
export function installedGeoipEditions(): GeoipEdition[] {
  return GEOIP_EDITIONS.filter((edition) => existsSync(geoipDatabasePath(edition)));
}

export type GeoipDatabaseInfo = {
  edition: GeoipEdition;
  /**
   * When geoipupdate last wrote this file.
   *
   * The file's own mtime, for the same reason `geoipEtag` trusts it: geoipupdate replaces a
   * database wholesale, so the write time is when this host last took delivery of one.
   *
   * MaxMind stamps its own `build_epoch` inside the file, which would be the age of the *data*
   * rather than of the download. Reading it needs a parser for the mmdb metadata section -
   * `mmdb-lib` has one but does not export it, and its public `Reader` loads the whole database
   * (tens of megabytes) and walks the search tree to get there. Not worth it for a line on a
   * tile: when the updater is working these differ by hours, and when it is broken - the case the
   * tile exists to catch - mtime is the one that stops moving.
   */
  updatedAt: Date;
};

/**
 * Every edition on disk, with the date the settings page reports.
 *
 * Never throws: a database being swapped in underneath us is a row that drops out of the list,
 * not a settings page that 500s.
 */
export function installedGeoipDatabases(): GeoipDatabaseInfo[] {
  const databases: GeoipDatabaseInfo[] = [];
  for (const edition of installedGeoipEditions()) {
    try {
      databases.push({ edition, updatedAt: statSync(geoipDatabasePath(edition)).mtime });
    } catch {
      // Deleted between the listing and the stat.
    }
  }
  return databases;
}

/** How long ago the freshest database was written, in whole days, or null when none are present. */
export function geoipDatabaseAgeDays(
  databases: GeoipDatabaseInfo[],
  now = Date.now(),
): number | null {
  if (databases.length === 0) return null;
  const newest = Math.max(...databases.map((database) => database.updatedAt.getTime()));
  return Math.max(0, Math.floor((now - newest) / 86_400_000));
}

/**
 * Whether GeoIP is switched on.
 *
 * The toggle is tri-state, and unset infers the answer rather than defaulting: before it existed,
 * "has GeoIP" meant "the databases are on disk", and an upgrade must not read as someone having
 * turned the feature off. Credentials count too, so enabling it on a host whose geoipupdate has
 * not finished its first download yet does not immediately report itself as unconfigured.
 */
export async function geoipEnabled(): Promise<boolean> {
  const [registry, { getSetting }] = await Promise.all([
    import("../settings/registry"),
    import("../settings/resolve"),
  ]);
  const toggle = await getSetting(registry.geoipEnabled);
  if (toggle !== null) return toggle;

  if (installedGeoipEditions().length > 0) return true;
  const [accountId, licenseKey] = await Promise.all([
    getSetting(registry.geoipAccountId),
    getSetting(registry.geoipLicenseKey),
  ]);
  return accountId.trim().length > 0 && licenseKey.trim().length > 0;
}

/**
 * What to tell agents about GeoIP, or null when this controller has none to offer.
 *
 * The URL has to be one the *agent* can reach, which for a remote agent means the controller's
 * public address - `BASE_URL`. There is no way to derive it from the request, because this is
 * assembled when the controller pushes rather than when an agent asks.
 */
export async function geoipFleetConfig(): Promise<FleetConfig["geoip"]> {
  if (!(await geoipEnabled())) return null;

  // Still gated on the files existing: with the feature on but the first download unfinished,
  // there is nothing for an agent to fetch, and naming an edition it cannot get would only turn
  // its daily sync into a daily 404.
  const editions = installedGeoipEditions();
  if (editions.length === 0) return null;

  return {
    url: `${config.baseUrl.replace(/\/+$/, "")}${CONTROLLER_GEOIP_ROUTE}`,
    editions: [...editions],
  };
}
