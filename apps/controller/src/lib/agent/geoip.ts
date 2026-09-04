/**
 * The MaxMind databases the controller holds, and how an agent is told to fetch them.
 *
 * The files come from the `geoipupdate` container into a shared volume. The controller does not
 * manage them beyond serving them: it holds the subscription, and agents on other hosts reach them
 * through it rather than each holding a licence key.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { GEOIP_EDITIONS, type FleetConfig, type GeoipEdition } from "@cpm/shared";
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
 * agent's daily check, and geoipupdate replaces the file wholesale — so a changed file always has
 * a changed mtime, and hashing it would buy nothing but I/O.
 */
export function geoipEtag(path: string): string {
  const stat = statSync(path);
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/**
 * What to tell agents about GeoIP, or null when this controller has no databases.
 *
 * The URL has to be one the *agent* can reach, which for a remote agent means the controller's
 * public address — `BASE_URL`. There is no way to derive it from the request, because this is
 * assembled when the controller pushes rather than when an agent asks.
 */
export function geoipFleetConfig(): FleetConfig["geoip"] {
  const editions = GEOIP_EDITIONS.filter((edition) => existsSync(geoipDatabasePath(edition)));
  if (editions.length === 0) return null;

  return {
    url: `${config.baseUrl.replace(/\/+$/, "")}/api/agent/geoip`,
    editions: [...editions],
  };
}
