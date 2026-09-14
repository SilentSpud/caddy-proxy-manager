/**
 * Keeping this host's MaxMind databases in step with the controller's.
 *
 * The controller holds the subscription and the files. An agent on another host fetches them
 * through it rather than needing a licence key of its own - and the agent, not just the parsers,
 * is what needs them: Caddy reads the same directory for geo-blocking.
 *
 * Pulled rather than pushed because these are tens of megabytes. It is the only request that runs
 * agent-to-controller, and it is signed with the same pairing secret in the other direction, so it
 * needs no second credential.
 *
 * Every agent fetches, the one beside the controller included: the files land on the agent's own
 * volume, which Caddy mounts read-only, rather than on the controller's.
 */

import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENT_ID_HEADER,
  AGENT_NONCE_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  CONTROLLER_GEOIP_ROUTE,
  GEOIP_EDITIONS,
  type GeoipEdition,
  signatureBase,
} from "@cpm/shared";
import type { AgentStore } from "../db";
import { geoipDir } from "./paths";

/** Generous: these are tens of megabytes over whatever link the controller is on. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Several times the largest edition. Only there so an endless body cannot fill the volume. */
export const MAX_DATABASE_BYTES = 200 * 1024 * 1024;

/** The edition names come from desired state and become a file name, so only known ones pass. */
export function isGeoipEdition(edition: unknown): edition is GeoipEdition {
  return (GEOIP_EDITIONS as readonly unknown[]).includes(edition);
}

function databasePath(edition: GeoipEdition): string {
  return join(geoipDir(), `${edition}.mmdb`);
}

/** The ETag key for an edition, so a re-check can be answered 304 instead of re-downloading. */
function etagKey(edition: string): string {
  return `geoip_etag:${edition}`;
}

/**
 * The ETag to send for an edition, or null to fetch unconditionally.
 *
 * A stored tag is only meaningful while the file it described is still there: an operator who
 * deleted the database, or a fresh volume, must produce a download rather than a 304 for a file
 * that is gone.
 */
function conditionalEtag(store: AgentStore, edition: GeoipEdition): string | null {
  if (!existsSync(databasePath(edition))) return null;
  return store.parseState(etagKey(edition));
}

/**
 * Stream a response body to `target`, refusing more than `maxBytes`. Returns the bytes written.
 *
 * Written to a temporary name in the same directory and renamed into place, because Caddy has the
 * directory open: a partial file under the real name is one Caddy would try to load. Counted while
 * streaming, since Content-Length is the sender's claim and may be absent.
 */
export async function writeCappedDownload(
  response: Response,
  target: string,
  maxBytes = MAX_DATABASE_BYTES,
): Promise<number> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`declared ${declared} bytes, over the ${maxBytes} byte limit`);
  }

  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.download`;
  const sink = Bun.file(temporary).writer();
  let written = 0;
  try {
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.byteLength;
        if (written > maxBytes) {
          await reader.cancel();
          throw new Error(`body exceeded the ${maxBytes} byte limit`);
        }
        sink.write(value);
      }
    }
    await sink.end();
    renameSync(temporary, target);
    return written;
  } catch (error) {
    try {
      await sink.end();
    } catch {
      /* already closed */
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* the partial file is not worth a second failure */
    }
    throw error;
  }
}

/** Fetch one edition if the controller has a newer copy. */
async function syncEdition(
  store: AgentStore,
  controllerUrl: string,
  agentId: string,
  secret: string,
  edition: GeoipEdition,
): Promise<"updated" | "current" | "failed"> {
  const path = `${CONTROLLER_GEOIP_ROUTE}/${edition}`;
  const timestamp = Date.now();
  const emptyBody = new Bun.CryptoHasher("sha256").update("").digest("hex");
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  const signature = createHmac("sha256", secret)
    .update(signatureBase("GET", path, timestamp, emptyBody, nonce))
    .digest("hex");

  const headers: Record<string, string> = {
    [AGENT_ID_HEADER]: agentId,
    [AGENT_TIMESTAMP_HEADER]: String(timestamp),
    [AGENT_NONCE_HEADER]: nonce,
    [AGENT_SIGNATURE_HEADER]: signature,
  };
  const known = conditionalEtag(store, edition);
  if (known) headers["if-none-match"] = known;

  let response: Response;
  try {
    response = await fetch(`${controllerUrl.replace(/\/+$/, "")}${path}`, {
      headers,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    // The controller is not reachable from here. Whatever database this host already has keeps
    // being used; country codes going stale is not worth a noisy failure every day.
    return "failed";
  }

  if (response.status === 304) return "current";
  if (!response.ok) return "failed";

  let size: number;
  try {
    size = await writeCappedDownload(response, databasePath(edition));
  } catch (error) {
    console.warn(`[geoip] could not install ${edition}:`, error);
    return "failed";
  }

  const etag = response.headers.get("etag");
  if (etag) store.setParseState(etagKey(edition), etag);
  console.log(`[geoip] updated ${edition} (${size} bytes)`);
  return "updated";
}

/**
 * Bring every edition the controller offers up to date.
 *
 * Never throws: a controller this agent cannot reach, or a database it cannot write, must not stop
 * it recreating containers - which is the job it exists for.
 */
export async function syncGeoipDatabases(
  store: AgentStore,
  controllerUrl: string,
  editions: unknown,
  agentId: string,
  secret: string,
): Promise<void> {
  if (!Array.isArray(editions)) return;
  for (const edition of editions) {
    if (!isGeoipEdition(edition)) {
      console.warn(`[geoip] ignoring unknown edition ${JSON.stringify(edition)}`);
      continue;
    }
    // Sequentially: each is tens of megabytes, and three at once over one link is slower than
    // three in a row while making the failure harder to read.
    const outcome = await syncEdition(store, controllerUrl, agentId, secret, edition);
    if (outcome === "failed") {
      console.warn(`[geoip] could not fetch ${edition} from ${controllerUrl}`);
    }
  }
}

/**
 * The controller origin to fetch from: the one this agent is paired with, else the origin inside
 * the pushed URL.
 *
 * The paired address first, because the pushed one is the controller's public `BASE_URL`, and for
 * the agent in the controller's own stack that means going out through the Caddy it may not have
 * started yet. The pushed URL already ends in the route, which the fetch appends again - so it is
 * stripped, where it used to be doubled and every fetch through it 404'd.
 */
export function geoipControllerUrl(paired: string | null, pushed: string): string {
  if (paired) return paired;
  const url = pushed.replace(/\/+$/, "");
  return url.endsWith(CONTROLLER_GEOIP_ROUTE) ? url.slice(0, -CONTROLLER_GEOIP_ROUTE.length) : url;
}
