/**
 * Turning what an operator types into an origin the agent can dial.
 *
 * Mirrors the controller's `normalizeAgentAddress`, and is deliberately just as strict: this value
 * arrives from a terminal, and an address carrying a path or a query is a sign someone pasted a
 * dashboard URL. Quietly trimming it would send a pairing code somewhere they did not mean.
 */

/** Where the controller listens when the operator gave a host and no port. */
export const DEFAULT_CONTROLLER_PORT = 3000;

export class ControllerAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControllerAddressError";
  }
}

/**
 * `host` may be a bare host, a host:port, or a full origin; `port` overrides whatever the host
 * carried. Returns an origin with no trailing slash.
 */
export function normalizeControllerUrl(host: string, port?: number | null): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) throw new ControllerAddressError("Enter the controller's address.");

  // A bare host is the common case — an operator reads an IP off a console, not a URL.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ControllerAddressError(`"${trimmed}" is not a usable address.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ControllerAddressError("A controller address must be http:// or https://.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ControllerAddressError(
      "Enter only the controller's host and port, with no path — for example 10.0.0.5:3000.",
    );
  }
  if (!url.hostname) throw new ControllerAddressError("A controller address needs a host.");

  if (port !== undefined && port !== null) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ControllerAddressError(`"${port}" is not a valid port.`);
    }
    url.port = String(port);
  }

  // An explicit --port wins; otherwise whatever was in the address; otherwise the controller's own
  // default rather than 80, which nothing about this address suggests.
  const resolved = url.port || String(DEFAULT_CONTROLLER_PORT);
  return `${url.protocol}//${url.hostname}:${resolved}`;
}

/** The pairing code as the controller will compare it: capitals, no spaces. */
export function normalizePairingCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{6}$/.test(code)) {
    throw new ControllerAddressError("A pairing code is six letters, for example ABCDEF.");
  }
  return code;
}
