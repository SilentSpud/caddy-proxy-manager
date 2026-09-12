/**
 * Where the agent finds Caddy's logs and keeps its MaxMind databases.
 *
 * Its own module, with nothing but `node:path`, so the parsers can share it without importing the
 * GeoIP fetcher - and so a test that mocks `node:fs` does not have to mock every export that
 * fetcher uses.
 */

import { dirname, join } from "node:path";

export function accessLogPath(): string {
  return process.env.CADDY_ACCESS_LOG || "/logs/access.log";
}

export function wafAuditLogPath(): string {
  return process.env.WAF_AUDIT_LOG || "/logs/waf-audit.log";
}

export function wafRulesLogPath(): string {
  return process.env.WAF_RULES_LOG || "/logs/waf-rules.log";
}

/** The directory Caddy rolls its logs in. */
export function logsDir(): string {
  return dirname(accessLogPath());
}

/**
 * The agent's copy of the databases, on its own volume.
 *
 * Not the `geoip-data` volume geoipupdate writes: that one is root's, and the agent does not run as
 * root. Caddy mounts this directory read-only in its place, so the agent owning it is the whole
 * permission story.
 */
export function geoipDir(): string {
  return process.env.GEOIP_DIR || join(process.env.DATA_DIR || "/data", "geoip");
}

/** The database the parsers look countries up in. */
export function geoipCountryDb(): string {
  return process.env.GEOIP_DB || join(geoipDir(), "GeoLite2-Country.mmdb");
}
