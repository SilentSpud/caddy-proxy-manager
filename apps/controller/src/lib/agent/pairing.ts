/**
 * Pairing: turning an address and a code an operator read off an agent's logs into a stored secret.
 *
 * This is the one unauthenticated request the controller ever makes to an agent, and the one that
 * establishes everything after it. It runs exactly once per agent — the code is burned on use —
 * so the failure messages matter more than usual: an operator who mistypes a code has to be told
 * which of "wrong code", "wrong address" and "nothing listening there" happened.
 */

import { AGENT_ROUTES, type PairRequest, type PairResponse } from "@cpm/shared";
import { config } from "../config";
import { getControllerId, saveAgent, type PairedAgent } from "../models/agents";

/** Long enough for a TLS handshake to a host across the internet, short enough to fail a typo fast. */
const PAIR_TIMEOUT_MS = 15_000;

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingError";
  }
}

/**
 * Normalise an operator-typed address into an origin.
 *
 * Deliberately strict about the scheme and deliberately silent about the rest: an address with a
 * path or a query is a sign the operator pasted something else, and quietly trimming it would send
 * a pairing code somewhere they did not mean.
 */
export function normalizeAgentAddress(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new PairingError("Enter the agent's address.");

  // A bare host is the common case — an operator reads an IP off a console, not a URL.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new PairingError(`"${raw.trim()}" is not a usable address.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PairingError("An agent address must be http:// or https://.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new PairingError("Enter only the agent's host and port, with no path.");
  }
  if (!url.hostname) throw new PairingError("An agent address needs a host.");

  // Default to the agent's own port rather than 80, which nothing about this address suggests.
  const port = url.port || "3100";
  return `${url.protocol}//${url.hostname}:${port}`;
}

/** The pairing code as the agent will compare it: capitals, no spaces. */
export function normalizePairingCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{6}$/.test(code)) {
    throw new PairingError("A pairing code is six letters, as printed in the agent's logs.");
  }
  return code;
}

/**
 * Exchange a code for a secret and store the result.
 *
 * The secret only ever exists here and in the database: it is not returned to the caller, not
 * logged, and not put in a server-action result that would cross to the browser.
 */
export async function pairWithAgent(input: {
  address: string;
  code: string;
  name?: string;
}): Promise<PairedAgent> {
  const address = normalizeAgentAddress(input.address);
  const code = normalizePairingCode(input.code);

  const body: PairRequest = {
    code,
    controllerId: await getControllerId(),
    controllerName: config.appName,
  };

  let response: Response;
  try {
    response = await fetch(`${address}${AGENT_ROUTES.pair}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
    });
  } catch {
    // The exception carries the address, which the operator already knows, and nothing else worth
    // showing. Say what to check instead.
    throw new PairingError(
      `Nothing answered at ${address}. Check the address, that the agent is running in managed ` +
        `mode, and that its port is reachable from here.`,
    );
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((parsed: unknown) =>
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : null,
      )
      .catch(() => null);
    throw new PairingError(detail ?? `The agent refused to pair (HTTP ${response.status}).`);
  }

  const paired = (await response.json()) as PairResponse;
  if (typeof paired.secret !== "string" || paired.secret.length < 32) {
    // Either not an agent, or one whose reply was rewritten in transit. Storing a short secret
    // would leave a pairing that looks complete and authenticates nothing.
    throw new PairingError(`${address} answered, but not like an agent.`);
  }

  return saveAgent({
    name: input.name?.trim() || new URL(address).hostname,
    address,
    agentId: typeof paired.agentId === "string" ? paired.agentId : null,
    secret: paired.secret,
  });
}
