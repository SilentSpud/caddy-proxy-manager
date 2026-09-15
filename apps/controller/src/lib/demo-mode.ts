/**
 * Demo mode: the whole app runs against a database as usual, but nothing reaches a real Caddy.
 *
 * An environment variable rather than a setting, because it is a safety switch: an operator of a
 * public demo must not be able to turn it off from the UI and have the next save configure a real
 * server - or, through a DNS provider's ACME challenge, change someone's records.
 *
 * Read on every call rather than captured at load, so a test can flip it.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE?.trim().toLowerCase() === "true";
}
