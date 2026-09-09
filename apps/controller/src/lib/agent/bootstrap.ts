/**
 * Pairing the agent that shares this controller's volume, without anyone typing anything.
 *
 * The bundled single-host stack is the case almost every deployment is in, and asking that operator
 * to read a code off one container and run a command in another to make their own machine talk to
 * itself is ceremony for a trust boundary they already crossed by running `docker compose up`.
 *
 * So the controller leaves a token on the shared data volume and an idle agent that finds one pairs
 * with it. The boundary is the volume: reaching this file already means being inside the stack.
 * That is the same boundary the pre-inversion design used - it kept a long-lived shared secret
 * there - except this token is single-use, so redeeming it is what makes the copy on disk worthless
 * rather than something that keeps working for whoever else read it.
 *
 * An agent on another host cannot mount this volume and never sees any of it. It pairs with a
 * six-letter code an operator carries, which is the flow this one shortcuts rather than replaces.
 */

import { randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_BOOTSTRAP_FILE, AGENT_BOOTSTRAP_TOKEN_PATTERN } from "@cpm/shared";

/**
 * Where the shared volume is mounted. Named for the setting it originally served so a deployment
 * that already points it at a scratch directory - every test rig does - keeps working.
 */
function dataDir(): string {
  return process.env.L4_PORTS_DIR || "/app/data";
}

export function bootstrapPath(): string {
  return join(dataDir(), AGENT_BOOTSTRAP_FILE);
}

/** Long enough that guessing is hopeless, and shaped so it cannot be confused with a typed code. */
function mintToken(): string {
  return randomBytes(32).toString("hex");
}

function secureEquals(a: string, b: string): boolean {
  // Hashed to a fixed width first: timingSafeEqual throws on a length mismatch, which would itself
  // be an oracle for how long the token is.
  const left = createHmac("sha256", "compare").update(Buffer.from(a, "utf8")).digest();
  const right = createHmac("sha256", "compare").update(Buffer.from(b, "utf8")).digest();
  return timingSafeEqual(left, right);
}

/**
 * Write a token if there is not already one, and return whether the volume can carry one at all.
 *
 * Called at startup. Absent rather than expiring: a controller that has been up for a week must
 * still be able to adopt an agent that was restarted this morning, and a token with a lifetime
 * would need a timer to stay useful for no gain - it is single-use either way.
 */
export function ensureBootstrapToken(): boolean {
  const path = bootstrapPath();
  try {
    if (existsSync(path) && readFileSync(path, "utf-8").trim().length > 0) return true;
    // 0600: the controller writes as its own unprivileged uid and the agent reads as root, which
    // is not stopped by the mode. Nothing else in the stack has any business reading it.
    writeFileSync(path, mintToken(), { encoding: "utf-8", mode: 0o600 });
    return true;
  } catch (error) {
    // No shared volume - a controller running without the bundled agent, or a read-only mount.
    // Not an error: that deployment pairs with a typed code like any remote one.
    console.warn(`[cpm] could not write the agent bootstrap token to ${path}:`, error);
    return false;
  }
}

/**
 * Whether `submitted` is the current bootstrap token, rotating it if so.
 *
 * Rotation rather than deletion is what keeps this single-use without making it once-ever: the
 * agent's database can be rebuilt, and the next one to come up needs a token of its own. The window
 * a redeemed token stays valid is zero, because the replacement is written before this returns.
 */
export function redeemBootstrapToken(submitted: string): boolean {
  const path = bootstrapPath();
  try {
    if (!existsSync(path)) return false;
    const current = readFileSync(path, "utf-8").trim();
    if (current.length === 0 || !secureEquals(current, submitted.trim())) return false;

    writeFileSync(path, mintToken(), { encoding: "utf-8", mode: 0o600 });
    return true;
  } catch (error) {
    console.warn("[cpm] could not redeem the agent bootstrap token:", error);
    return false;
  }
}

/** Shape check, so the pair route can tell a bootstrap token from a typed six-letter code. */
export function looksLikeBootstrapToken(value: string): boolean {
  return AGENT_BOOTSTRAP_TOKEN_PATTERN.test(value.trim());
}
