/**
 * Checking an auth key against the Tailscale API, before Caddy has to find out the hard way.
 *
 * Why this exists: a node that cannot register is a listener that never comes up, and Caddy refuses
 * a configuration it cannot start — so one dead auth key fails the apply for *every* host on
 * *every* agent, with an error that names Tailscale rather than the host anyone was editing. There
 * is no cheaper way to learn this. A key is only proved good by registering with it, and the app
 * cannot do that: tsnet lives inside Caddy, not here.
 *
 * So this asks the API instead, which needs a credential of its own. An auth key (`tskey-auth-…`)
 * authenticates nothing but a device registration; only an access token (`tskey-api-…`) can call
 * the API. That second credential is the reason the whole check is opt-in.
 *
 * Kept apart from caddy-tailscale.ts so that file stays pure — it is on the config-generation path,
 * which must never make a network call.
 */

import { isCaddyPlaceholder, tailscaleKeyId } from "./caddy-tailscale";

const API_BASE = "https://api.tailscale.com/api/v2";

/** Short: this runs inside a settings save, and a hung request would hang the page. */
const REQUEST_TIMEOUT_MS = 10_000;

export type TailscaleKeyCheck =
  /** The key exists, is not revoked, and has not expired. */
  | { status: "ok" }
  /**
   * Nothing was learned, and that is not the key's fault — it has no id to look up. Callers must
   * let the save through: refusing here would block a Headscale key or an `{env.…}` placeholder,
   * both of which are legitimate.
   */
  | { status: "unknown"; reason: string }
  /** The key, or the token used to ask about it, is not usable. `reason` is shown to the operator. */
  | { status: "rejected"; reason: string };

type KeyResponse = {
  id?: string;
  revoked?: string;
  invalid?: boolean;
  expires?: string;
};

/**
 * Ask Tailscale whether an auth key is still good.
 *
 * Every failure mode is separated deliberately, because the operator's next action differs: a
 * revoked key means mint a new one, a refused token means fix the token, and an unreachable API
 * means try again or turn the check off. A single "validation failed" would send them looking in
 * the wrong place.
 */
export async function checkTailscaleAuthKey(options: {
  authKey: string;
  apiAccessToken: string;
  tailnet: string;
  /** Injected by tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}): Promise<TailscaleKeyCheck> {
  const authKey = options.authKey.trim();
  const token = options.apiAccessToken.trim();

  if (!authKey) return { status: "unknown", reason: "no auth key is stored" };
  if (isCaddyPlaceholder(authKey)) {
    return {
      status: "unknown",
      reason:
        "the auth key is a Caddy placeholder, so its value only exists inside the Caddy container",
    };
  }
  if (!token) {
    return {
      status: "rejected",
      reason:
        "Checking auth keys needs a Tailscale API access token (tskey-api-…). Add one, or turn the check off.",
    };
  }

  const keyId = tailscaleKeyId(authKey);
  if (!keyId) {
    return {
      status: "unknown",
      reason:
        "the key does not carry an id the API can address — this is normal for an older key or a Headscale one",
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const url = `${API_BASE}/tailnet/${encodeURIComponent(options.tailnet)}/keys/${encodeURIComponent(keyId)}`;

  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "rejected",
      reason: `Could not reach the Tailscale API to check the key (${
        error instanceof Error ? error.message : "network error"
      }). Try again, or turn the check off to save without it.`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "rejected",
      reason:
        "Tailscale refused the API access token. Check the token itself — this says nothing about the auth key.",
    };
  }
  if (response.status === 404) {
    return {
      status: "rejected",
      reason: `Tailnet "${options.tailnet}" has no key with id "${keyId}". It may have been deleted, or belong to a different tailnet.`,
    };
  }
  if (!response.ok) {
    return {
      status: "rejected",
      reason: `The Tailscale API answered ${response.status} when asked about the key. Try again, or turn the check off to save without it.`,
    };
  }

  let key: KeyResponse;
  try {
    key = (await response.json()) as KeyResponse;
  } catch {
    return { status: "unknown", reason: "the Tailscale API returned a response this cannot read" };
  }

  if (key.invalid) return { status: "rejected", reason: "Tailscale reports this key as invalid." };
  if (key.revoked) {
    return { status: "rejected", reason: `This key was revoked on ${key.revoked}.` };
  }
  // Compared here rather than trusted to `invalid`: a key past its expiry is reported plainly by
  // some tailnets and only through the timestamp by others.
  if (key.expires) {
    const expires = Date.parse(key.expires);
    if (Number.isFinite(expires) && expires <= Date.now()) {
      return { status: "rejected", reason: `This key expired on ${key.expires}.` };
    }
  }

  return { status: "ok" };
}
