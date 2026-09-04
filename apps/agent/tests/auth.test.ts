/**
 * Request signing and the pairing code.
 *
 * This is the agent's whole security boundary: it executes `docker compose` on its host, so
 * anything that gets a request past `verifyRequest` can recreate containers. The properties below
 * are the ones that make an accepted request unforgeable — not that a correct signature works,
 * which any implementation gets right, but that every near miss is refused.
 */
import { Database } from "bun:sqlite";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AGENT_CLOCK_SKEW_MS,
  AGENT_CONTROLLER_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  PAIRING_CODE_LENGTH,
  signatureBase,
} from "@cpm/shared";
import { PairingCodeIssuer, sha256Hex, verifyRequest } from "../src/auth";
import { AgentStore } from "../src/db";

const SECRET = "a".repeat(64);
const CONTROLLER = "local";

let dir: string;
let store: AgentStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-auth-"));
  store = new AgentStore(join(dir, "agent.db"));
  store.upsertController({
    controllerId: CONTROLLER,
    controllerName: "Test",
    secret: SECRET,
  });
});

afterEach(() => {
  store.close();
  // bun:sqlite holds the file open until it is collected, which on Windows makes the unlink fail.
  Bun.gc(true);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp directory is not worth failing a test over */
  }
});

async function signedRequest(
  overrides: {
    method?: string;
    path?: string;
    body?: string;
    timestamp?: number;
    secret?: string;
    controllerId?: string;
    signature?: string;
  } = {},
) {
  const method = overrides.method ?? "POST";
  const path = overrides.path ?? "/v1/l4-ports";
  const body = overrides.body ?? JSON.stringify({ ports: [] });
  const timestamp = overrides.timestamp ?? Date.now();
  const signature =
    overrides.signature ??
    createHmac("sha256", overrides.secret ?? SECRET)
      .update(signatureBase(method, path, timestamp, await sha256Hex(body)))
      .digest("hex");

  const url = new URL(`http://agent.local${path}`);
  const request = new Request(url.toString(), {
    method,
    body: method === "GET" ? undefined : body,
    headers: {
      [AGENT_CONTROLLER_HEADER]: overrides.controllerId ?? CONTROLLER,
      [AGENT_TIMESTAMP_HEADER]: String(timestamp),
      [AGENT_SIGNATURE_HEADER]: signature,
    },
  });
  return { request, url, bytes: new TextEncoder().encode(body).buffer as ArrayBuffer };
}

describe("verifyRequest", () => {
  it("accepts a correctly signed request", async () => {
    const { request, url, bytes } = await signedRequest();
    const result = await verifyRequest(store, request, url, bytes);
    expect(result.ok).toBe(true);
  });

  it("refuses a request signed with the wrong secret", async () => {
    const { request, url, bytes } = await signedRequest({ secret: "b".repeat(64) });
    expect((await verifyRequest(store, request, url, bytes)).ok).toBe(false);
  });

  it("refuses a request from a controller it has never paired with", async () => {
    const { request, url, bytes } = await signedRequest({ controllerId: "someone-else" });
    expect((await verifyRequest(store, request, url, bytes)).ok).toBe(false);
  });

  it("refuses a signature lifted from a different path", async () => {
    // Otherwise a captured read of /v1/status would be replayable as a write to /v1/caddy-build,
    // which is the difference between observing a host and rebuilding its proxy.
    const timestamp = Date.now();
    const body = "";
    const stolen = createHmac("sha256", SECRET)
      .update(signatureBase("GET", "/v1/status", timestamp, await sha256Hex(body)))
      .digest("hex");

    const { request, url, bytes } = await signedRequest({
      method: "GET",
      path: "/v1/caddy-build",
      body,
      timestamp,
      signature: stolen,
    });
    expect((await verifyRequest(store, request, url, bytes)).ok).toBe(false);
  });

  it("refuses a body swapped after signing", async () => {
    const { request, url } = await signedRequest({ body: JSON.stringify({ ports: [] }) });
    const tampered = new TextEncoder().encode(JSON.stringify({ ports: ["25:25"] }))
      .buffer as ArrayBuffer;
    expect((await verifyRequest(store, request, url, tampered)).ok).toBe(false);
  });

  it("refuses a request older than the skew window", async () => {
    const { request, url, bytes } = await signedRequest({
      timestamp: Date.now() - AGENT_CLOCK_SKEW_MS - 1000,
    });
    expect((await verifyRequest(store, request, url, bytes)).ok).toBe(false);
  });

  it("refuses a request from further in the future than the skew window", async () => {
    // Symmetric on purpose: a one-sided window lets a captured request be replayed indefinitely by
    // an attacker who can post-date it.
    const { request, url, bytes } = await signedRequest({
      timestamp: Date.now() + AGENT_CLOCK_SKEW_MS + 1000,
    });
    expect((await verifyRequest(store, request, url, bytes)).ok).toBe(false);
  });

  it("accepts a request within the skew window in either direction", async () => {
    for (const offset of [-AGENT_CLOCK_SKEW_MS + 1000, AGENT_CLOCK_SKEW_MS - 1000]) {
      const { request, url, bytes } = await signedRequest({ timestamp: Date.now() + offset });
      expect((await verifyRequest(store, request, url, bytes)).ok).toBe(true);
    }
  });

  it("refuses a request with no signature headers at all", async () => {
    const url = new URL("http://agent.local/v1/status");
    const request = new Request(url.toString(), { method: "GET" });
    expect((await verifyRequest(store, request, url, new ArrayBuffer(0))).ok).toBe(false);
  });

  it("gives the same refusal whichever part was wrong", async () => {
    // Distinguishing "unknown controller" from "bad signature" turns the endpoint into a probe for
    // which half an attacker already has right.
    const wrongSecret = await signedRequest({ secret: "b".repeat(64) });
    const wrongController = await signedRequest({ controllerId: "nobody" });
    const stale = await signedRequest({ timestamp: 0 });

    const results = await Promise.all([
      verifyRequest(store, wrongSecret.request, wrongSecret.url, wrongSecret.bytes),
      verifyRequest(store, wrongController.request, wrongController.url, wrongController.bytes),
      verifyRequest(store, stale.request, stale.url, stale.bytes),
    ]);

    const messages = new Set(results.map((r) => (r.ok ? "accepted" : `${r.code}:${r.message}`)));
    expect(messages.size).toBe(1);
  });
});

describe("PairingCodeIssuer", () => {
  it("mints a code of the documented shape", () => {
    const code = new PairingCodeIssuer(true).ensure();
    expect(code?.code).toMatch(new RegExp(`^[A-Z]{${PAIRING_CODE_LENGTH}}$`));
  });

  it("keeps handing back the same code until it expires", () => {
    const issuer = new PairingCodeIssuer(true);
    expect(issuer.ensure()?.code).toBe(issuer.ensure()?.code as string);
  });

  it("mints a new one once the old has expired", () => {
    const issuer = new PairingCodeIssuer(true, 1000);
    const first = issuer.ensure(0)?.code;
    const second = issuer.ensure(2000)?.code;
    expect(second).not.toBe(first as string);
  });

  it("accepts the live code once and never again", () => {
    // One-time is the whole point: a code that stayed valid for its full five minutes would let
    // anyone who saw the operator's screen pair a second controller.
    const issuer = new PairingCodeIssuer(true);
    const code = issuer.ensure()?.code as string;
    expect(issuer.redeem(code).ok).toBe(true);
    expect(issuer.redeem(code).ok).toBe(false);
  });

  it("accepts a code typed in lower case or with stray spaces", () => {
    const issuer = new PairingCodeIssuer(true);
    const code = issuer.ensure()?.code as string;
    expect(issuer.redeem(`  ${code.toLowerCase()} `).ok).toBe(true);
  });

  it("refuses an expired code", () => {
    const issuer = new PairingCodeIssuer(true, 1000);
    const code = issuer.ensure(0)?.code as string;
    const result = issuer.redeem(code, 2000);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("PAIRING_CODE_EXPIRED");
  });

  it("burns the code after repeated wrong guesses", () => {
    // The code has 24^6 possibilities but five whole minutes to be guessed in, and nothing else
    // rate-limits the endpoint.
    const issuer = new PairingCodeIssuer(true);
    const code = issuer.ensure()?.code as string;
    for (let i = 0; i < 10; i++) issuer.redeem("ZZZZZZ");
    expect(issuer.redeem(code).ok).toBe(false);
  });

  it("refuses to pair at all when disabled", () => {
    const issuer = new PairingCodeIssuer(false);
    expect(issuer.ensure()).toBeNull();
    const result = issuer.redeem("ABCDEF");
    expect(result.ok === false && result.code).toBe("PAIRING_DISABLED");
  });
});

describe("generated secrets", () => {
  it("are long enough that guessing is not a strategy", async () => {
    const { generateSecret } = await import("../src/auth");
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([generateSecret(), generateSecret(), generateSecret()]).size).toBe(3);
  });

  it("hashes a body the same way both sides do", async () => {
    const body = JSON.stringify({ ports: ["25:25"] });
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(body);
    expect(await sha256Hex(body)).toBe(hasher.digest("hex"));
  });
});

describe("AgentStore", () => {
  it("keeps its id across restarts", () => {
    const path = join(dir, "identity.db");
    const first = new AgentStore(path);
    const id = first.agentId();
    first.close();

    const second = new AgentStore(path);
    // A new id would read to a paired controller as a different machine at the same address.
    expect(second.agentId()).toBe(id);
    second.close();
  });

  it("replaces a controller's secret when it pairs again", () => {
    // Re-pairing is the recovery path for a controller that lost its secret, so a second pairing
    // must overwrite rather than be refused or accumulate.
    const replacement = randomBytes(32).toString("hex");
    store.upsertController({
      controllerId: CONTROLLER,
      controllerName: "Test",
      secret: replacement,
    });
    expect(store.listControllers()).toHaveLength(1);
    expect(store.findController(CONTROLLER)?.secret).toBe(replacement);
  });

  it("reports no applied modules until a build has been recorded", () => {
    // Null and [] are different claims: "never rebuilt" versus "built with no plugins at all".
    expect(store.appliedCaddyModules()).toBeNull();
    store.setAppliedCaddyModules([]);
    expect(store.appliedCaddyModules()).toEqual([]);
  });

  it("survives a state row that is not parseable JSON", () => {
    // The file is on a shared volume an operator can reach. An unreadable row must not make every
    // status read throw.
    store.setL4PortsStatus({ state: "applied", message: "fine" });
    expect(store.l4PortsStatus().state).toBe("applied");

    const raw = new Database(join(dir, "agent.db"));
    const changed = raw
      .query("UPDATE state SET value = ? WHERE key = ?")
      .run("{not json", "l4_ports_status");
    // The row has to have existed, or the corruption this pins would never be read back.
    expect(changed.changes).toBe(1);
    raw.close();

    const reopened = new AgentStore(join(dir, "agent.db"));
    expect(reopened.l4PortsStatus()).toEqual({ state: "idle" });
    reopened.close();
  });
});
