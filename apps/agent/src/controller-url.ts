/**
 * Turning what an operator types into an origin the agent can dial, and deciding whether to.
 *
 * Mirrors the controller's `normalizeAgentAddress`, and is deliberately just as strict: this value
 * arrives from a terminal, and an address carrying a path or a query is a sign someone pasted a
 * dashboard URL. Quietly trimming it would send a pairing code somewhere they did not mean.
 *
 * The link is not just control traffic: the pair response carries the shared secret, and desired
 * state carries the ClickHouse password and the MaxMind key. So plain http is the default only
 * where it cannot leave the host or the compose network, and is refused towards a public address.
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
 * Whether the operator actually typed a port, which `new URL` will not tell you.
 *
 * The URL API normalises a scheme's default port away - `new URL("https://h:443").port` is the
 * empty string, indistinguishable from `https://h`. Both mean 443 here, but for http the two
 * differ: `http://h:80` asked for 80 and `http://h` did not ask for anything, and the second has
 * always meant the controller's own default.
 */
function authorityHasExplicitPort(input: string): boolean {
  const withoutScheme = input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  // A port only ever follows the closing bracket of an IPv6 literal, never a colon inside it.
  const afterHost = authority.startsWith("[")
    ? authority.slice(authority.indexOf("]") + 1)
    : authority;
  return /:\d+$/.test(afterHost);
}

function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * Loopback, or a single-label name: a compose service such as the bundled stack's `web`, or a
 * MagicDNS short name. Neither is resolvable from the internet at large.
 */
export function isLocalHost(hostname: string): boolean {
  const host = bareHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  return !host.includes(".") && !host.includes(":");
}

/**
 * An address on a private network: RFC 1918, CGNAT (which tailnets use), link-local, IPv6 ULA and
 * link-local, and the suffixes those networks name hosts with. A name is taken at its word - this
 * decides what to warn about, and a public name ending `.internal` is the operator's own doing.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = bareHost(hostname);
  if (isLocalHost(host)) return true;

  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(":")) return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);

  return [".local", ".internal", ".lan", ".home.arpa", ".ts.net"].some((suffix) =>
    host.endsWith(suffix),
  );
}

/**
 * `host` may be a bare host, a host:port, or a full origin; `port` overrides whatever the host
 * carried. Returns an origin with no trailing slash.
 */
export function normalizeControllerUrl(host: string, port?: number | null): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) throw new ControllerAddressError("Enter the controller's address.");

  const hasScheme = /^https?:\/\//i.test(trimmed);

  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    throw new ControllerAddressError(`"${trimmed}" is not a usable address.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ControllerAddressError("A controller address must be http:// or https://.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ControllerAddressError(
      "Enter only the controller's host and port, with no path - for example cpm.example.com.",
    );
  }
  if (!url.hostname) throw new ControllerAddressError("A controller address needs a host.");

  // A bare host means https unless it stays on this host or the compose network. Plain http has to
  // be spelled out, because this link carries the pairing secret.
  if (!hasScheme && !isLocalHost(url.hostname)) url.protocol = "https:";

  if (port !== undefined && port !== null) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ControllerAddressError(`"${port}" is not a valid port.`);
    }
    url.port = String(port);
  }

  // An explicit --port wins, then a port in the address, then the scheme's own default where the
  // operator committed to one - and only then the controller's default.
  //
  // `https://` is the case that matters: the controller serves plain HTTP, so an https address
  // means something is terminating TLS in front of it, and that thing listens on 443. This is how
  // a Tailscale or Headscale deployment addresses its controller - `tailscale serve` publishes it
  // at `https://<machine>.<tailnet>.ts.net` with no port to type - and defaulting that to 3000
  // dialled a port nothing was listening on. `http://` keeps meaning 3000 without an explicit
  // port, which is what every existing deployment relies on.
  const typedPort = authorityHasExplicitPort(trimmed);
  const schemeDefault = url.protocol === "https:" ? "443" : "80";
  const resolved =
    url.port ||
    (typedPort || url.protocol === "https:" ? schemeDefault : String(DEFAULT_CONTROLLER_PORT));
  return `${url.protocol}//${url.hostname}:${resolved}`;
}

/**
 * Whether the agent may dial `url`: a warning to log when it may but plain http is involved, null
 * when there is nothing to say, and a ControllerAddressError when it may not.
 *
 * http to loopback or a single-label name is the bundled stack talking to itself and says nothing.
 * To a private address it warns. Anywhere else it is refused unless `allowInsecureHttp` - the
 * `CONTROLLER_ALLOW_INSECURE_HTTP` opt-in - says the operator accepts that.
 */
export function checkControllerTransport(url: string, allowInsecureHttp: boolean): string | null {
  const parsed = new URL(url);
  if (parsed.protocol === "https:" || isLocalHost(parsed.hostname)) return null;

  if (isPrivateHost(parsed.hostname) || allowInsecureHttp) {
    return (
      `${url} is plain http, so the pairing secret and the credentials the controller pushes ` +
      "cross that network unencrypted. Prefer an https:// address."
    );
  }
  throw new ControllerAddressError(
    `Refusing plain http to ${parsed.hostname}, which is not a private address: the pairing ` +
      "secret and the credentials the controller pushes would cross it unencrypted. Use an " +
      "https:// address, or set CONTROLLER_ALLOW_INSECURE_HTTP=true to accept that.",
  );
}

/** The pairing code as the controller will compare it: capitals, no spaces. */
export function normalizePairingCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{6}$/.test(code)) {
    throw new ControllerAddressError("A pairing code is six letters, for example ABCDEF.");
  }
  return code;
}
