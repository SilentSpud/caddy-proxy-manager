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
 * volume, which Caddy mounts read-only, rather than on the root-owned volume geoipupdate writes.
 */

import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENT_ID_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  CONTROLLER_GEOIP_ROUTE,
  signatureBase,
} from "@cpm/shared";
import type { AgentStore } from "../db";
import { geoipDir } from "./paths";

/** Generous: these are tens of megabytes over whatever link the controller is on. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

function databasePath(edition: string): string {
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
function conditionalEtag(store: AgentStore, edition: string): string | null {
  if (!existsSync(databasePath(edition))) return null;
  return store.parseState(etagKey(edition));
}

/**
 * Fetch one edition if the controller has a newer copy.
 *
 * Written to a temporary name and renamed into place, because Caddy has the same directory open:
 * a partial file under the real name is one Caddy would try to load.
 */
async function syncEdition(
  store: AgentStore,
  controllerUrl: string,
  agentId: string,
  secret: string,
  edition: string,
): Promise<"updated" | "current" | "failed"> {
  const path = `${CONTROLLER_GEOIP_ROUTE}/${edition}`;
  const timestamp = Date.now();
  const emptyBody = new Bun.CryptoHasher("sha256").update("").digest("hex");
  const signature = createHmac("sha256", secret)
    .update(signatureBase("GET", path, timestamp, emptyBody))
    .digest("hex");

  const headers: Record<string, string> = {
    [AGENT_ID_HEADER]: agentId,
    [AGENT_TIMESTAMP_HEADER]: String(timestamp),
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

  const target = databasePath(edition);
  const temporary = `${target}.download`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(temporary, response);
    renameSync(temporary, target);
  } catch (error) {
    console.warn(`[geoip] could not install ${edition}:`, error);
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* the partial file is not worth a second failure */
    }
    return "failed";
  }

  const etag = response.headers.get("etag");
  if (etag) store.setParseState(etagKey(edition), etag);
  console.log(`[geoip] updated ${edition} (${statSync(target).size} bytes)`);
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
  editions: string[],
  agentId: string,
  secret: string,
): Promise<void> {
  for (const edition of editions) {
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
