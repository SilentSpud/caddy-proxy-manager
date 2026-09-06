/**
 * Tailscale, as this app drives github.com/tailscale/caddy-tailscale.
 *
 * The plugin runs tsnet inside the Caddy process, which is what makes this worth having: a
 * `tailscale/<node>` listener puts a site on the tailnet with no tailscaled on the host and no TUN
 * device, so nothing in the Compose stack changes. Three of its modules are used — the listener
 * network, the `tailscale` authentication provider, and the reverse-proxy transport — and this
 * file is the JSON each of them wants, split from caddy.ts so the shapes stay unit-testable
 * without a database.
 *
 * Certificates are deliberately not the plugin's: Caddy itself ships `tls.get_certificate.tailscale`
 * and skips ACME for a policy whose subjects are all `.ts.net`, so a tailnet host keeps this app's
 * connection policies, HSTS and mTLS instead of being handed to the plugin's own TLS listener.
 */

/**
 * Local rather than imported from settings-validation, which reaches back here to validate the
 * REST settings group — one direction only, as caddy-default-response.ts does.
 */
function hasForbiddenControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Every Tailscale MagicDNS name ends here; Caddy keys its own certificate handling off it. */
export const TAILSCALE_DOMAIN_SUFFIX = ".ts.net";

/**
 * Where each node's tsnet state lands, one subdirectory per node. `/data` is the `caddy-data`
 * volume the image already owns, so a node keeps its identity across a container recreate — without
 * this the node re-registers on every restart and the tailnet fills with duplicates.
 */
export const TAILSCALE_DEFAULT_STATE_DIR = "/data/tailscale";

/** The node a host is served on when it names none. */
export const TAILSCALE_DEFAULT_NODE = "caddy";

/** A tailnet machine name is a DNS label: what the tailnet admin console will accept. */
const NODE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Tailscale ACL tags, as the admin console writes them. */
const TAG_PATTERN = /^tag:[a-z0-9][a-z0-9-]*$/;

const MAX_TAGS = 32;

export function isTailscaleDomain(domain: string): boolean {
  return domain.trim().toLowerCase().endsWith(TAILSCALE_DOMAIN_SUFFIX);
}

/**
 * A node name as the listener address will spell it. Lowercased rather than rejected on case: the
 * name is typed by hand into two places (here and the tailnet) and `Caddy` vs `caddy` would
 * otherwise register two nodes that look identical in the UI.
 */
export function normalizeNodeName(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Error message for an unusable node name, or null. */
export function validateNodeName(name: string, label = "Tailscale node name"): string | null {
  if (!name) return `${label} is required`;
  if (!NODE_NAME_PATTERN.test(name)) {
    return `${label} "${name}" is not a valid tailnet machine name. Use lowercase letters, digits and hyphens, e.g. "caddy".`;
  }
  return null;
}

/**
 * The key id inside a Tailscale key, or null.
 *
 * Keys are `tskey-<type>-<id>-<secret>` — the documented example is
 * `tskey-api-abcDEF1CNTRL-091234567890ABCDEF` — and the id is what the API addresses a key by.
 * Null for anything that does not have that shape: an older `tskey-<secret>` key, a Caddy
 * placeholder like `{env.TS_AUTHKEY}`, or a Headscale key, none of which this can look up. Callers
 * must treat null as "cannot check", never as "invalid" — the format is not a documented contract
 * and guessing wrong would refuse a key that works.
 */
export function tailscaleKeyId(key: string): string | null {
  const parts = key.trim().split("-");
  if (parts.length < 4 || parts[0] !== "tskey") return null;
  const id = parts[2];
  return /^[A-Za-z0-9]+$/.test(id) ? id : null;
}

/** True for a value Caddy will expand at load time, which cannot be resolved or checked here. */
export function isCaddyPlaceholder(value: string): boolean {
  return /\{[a-z][a-z0-9_.]*\}/i.test(value.trim());
}

// ─── Global settings ─────────────────────────────────────────────────────────

/**
 * Tailscale node defaults for the whole deployment.
 *
 * These are the plugin's global `tailscale` options. Per-host settings pick a node name; everything
 * about *how* a node registers is here, because a tailnet has one set of credentials and one
 * coordination server no matter how many sites are served on it.
 */
export type TailscaleSettings = {
  enabled: boolean;
  /**
   * Auth key used to register each node. Stored encrypted, and passed to Caddy verbatim — the
   * plugin runs it through Caddy's replacer, so `{env.TS_AUTHKEY}` works and keeps the key out of
   * the database entirely.
   */
  authKey: string;
  /** Coordination server, for Headscale and friends. Empty means Tailscale's own. */
  controlUrl: string;
  /** Register nodes as ephemeral, so they leave the tailnet when Caddy stops. */
  ephemeral: boolean;
  /** Parent directory for per-node state. Empty falls back to the plugin's own default. */
  stateDir: string;
  /** ACL tags applied at registration. Required by most reusable auth keys. */
  tags: string[];
  /** Node name for hosts that do not choose one. */
  defaultNode: string;
  /**
   * Check the auth key against the Tailscale API before saving it.
   *
   * Off by default, because it is the only thing in this app that reaches Tailscale on its own and
   * it needs a second credential to do it — an auth key cannot authenticate to the API, only an
   * access token can. With it off there is no way to tell a revoked key from a good one until
   * Caddy tries to register the node, and that failure rejects the whole configuration.
   */
  validateAuthKey: boolean;
  /** API access token (`tskey-api-…`) used for that check. Encrypted at rest. */
  apiAccessToken: string;
  /** Tailnet the check addresses. "-" means the token's own, which is right for most tailnets. */
  apiTailnet: string;
};

export const DEFAULT_TAILSCALE_SETTINGS: TailscaleSettings = {
  enabled: false,
  authKey: "",
  controlUrl: "",
  ephemeral: false,
  stateDir: TAILSCALE_DEFAULT_STATE_DIR,
  tags: [],
  defaultNode: TAILSCALE_DEFAULT_NODE,
  validateAuthKey: false,
  apiAccessToken: "",
  apiTailnet: "-",
};

/** What the browser and the REST API are allowed to see: everything but the two secrets. */
export type TailscaleSettingsView = Omit<TailscaleSettings, "authKey" | "apiAccessToken"> & {
  hasAuthKey: boolean;
  hasApiAccessToken: boolean;
};

export function redactTailscaleSettingsForApi(settings: TailscaleSettings): TailscaleSettingsView {
  const { authKey, apiAccessToken, ...rest } = settings;
  return {
    ...rest,
    hasAuthKey: authKey.trim().length > 0,
    hasApiAccessToken: apiAccessToken.trim().length > 0,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Validate and fill in a stored or submitted settings blob. Throws rather than silently correcting:
 * a node name Caddy cannot parse becomes a listener address it rejects, and Caddy rejects the whole
 * document — every other host goes down with it.
 */
export function normalizeTailscaleSettings(value: unknown): TailscaleSettings {
  const input = (value ?? {}) as Partial<Record<keyof TailscaleSettings, unknown>>;

  const defaultNode = normalizeNodeName(
    typeof input.defaultNode === "string" && input.defaultNode.trim()
      ? input.defaultNode
      : TAILSCALE_DEFAULT_NODE,
  );
  const nodeError = validateNodeName(defaultNode, "Default node name");
  if (nodeError) throw new Error(nodeError);

  // Generous, because this same function runs over the *stored* blob, where the key is a base64
  // ciphertext several times the length of what was typed.
  const authKey = typeof input.authKey === "string" ? input.authKey.trim() : "";
  if (authKey.length > 4096) throw new Error("Tailscale auth key is implausibly long");
  if (/\s/.test(authKey) || hasForbiddenControlCharacter(authKey)) {
    throw new Error("Tailscale auth key must not contain whitespace or control characters");
  }

  const controlUrl = typeof input.controlUrl === "string" ? input.controlUrl.trim() : "";
  if (controlUrl) {
    let parsed: URL;
    try {
      parsed = new URL(controlUrl);
    } catch {
      throw new Error(`Control server URL "${controlUrl}" is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Control server URL must be http or https");
    }
  }

  const stateDir = typeof input.stateDir === "string" ? input.stateDir.trim() : "";
  if (stateDir) {
    if (!stateDir.startsWith("/") || stateDir.includes("..")) {
      throw new Error("State directory must be an absolute path inside the container");
    }
    if (hasForbiddenControlCharacter(stateDir)) {
      throw new Error("State directory contains a control character");
    }
  }

  const apiAccessToken =
    typeof input.apiAccessToken === "string" ? input.apiAccessToken.trim() : "";
  if (apiAccessToken.length > 4096) throw new Error("API access token is implausibly long");
  if (/\s/.test(apiAccessToken) || hasForbiddenControlCharacter(apiAccessToken)) {
    throw new Error("API access token must not contain whitespace or control characters");
  }

  // "-" is Tailscale's own shorthand for the token's tailnet. A named one is a DNS-ish string, so
  // this only refuses what would corrupt the request path.
  const apiTailnet =
    typeof input.apiTailnet === "string" && input.apiTailnet.trim() ? input.apiTailnet.trim() : "-";
  if (!/^[A-Za-z0-9._@-]+$/.test(apiTailnet)) {
    throw new Error(`Tailnet "${apiTailnet}" is not valid. Use "-" for the token's own tailnet.`);
  }

  const tags = Array.from(
    new Set(
      asStringArray(input.tags)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (tags.length > MAX_TAGS) throw new Error(`At most ${MAX_TAGS} Tailscale tags are supported`);
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      throw new Error(`Tailscale tag "${tag}" is not valid. Tags look like "tag:caddy".`);
    }
  }

  return {
    enabled: Boolean(input.enabled),
    authKey,
    controlUrl,
    ephemeral: Boolean(input.ephemeral),
    stateDir,
    tags,
    defaultNode,
    validateAuthKey: Boolean(input.validateAuthKey),
    apiAccessToken,
    apiTailnet,
  };
}

// ─── Caddy JSON ──────────────────────────────────────────────────────────────

/**
 * The `apps.tailscale` block. `nodes` is deliberately absent: with no per-node overrides the
 * plugin derives each node's hostname from the name in its listener address, so an entry here
 * would only be a second place for the same string to drift.
 *
 * `authKey` arrives decrypted — the caller owns that, since only it knows whether the value came
 * from the database or from a Caddy placeholder that must be passed through untouched.
 */
export function buildTailscaleApp(
  settings: TailscaleSettings,
  authKey: string,
): Record<string, unknown> {
  return {
    ...(authKey ? { auth_key: authKey } : {}),
    ...(settings.controlUrl ? { control_url: settings.controlUrl } : {}),
    ...(settings.ephemeral ? { ephemeral: true } : {}),
    ...(settings.stateDir ? { state_dir: settings.stateDir } : {}),
    ...(settings.tags.length > 0 ? { tags: settings.tags } : {}),
  };
}

/**
 * The listener addresses for one node. Both ports, always: :443 is what serves the site and :80 is
 * what Caddy's automatic HTTPS redirects from, and a tailnet client typing a bare MagicDNS name
 * lands on :80 first.
 */
export function tailscaleListenAddresses(node: string): string[] {
  return [`tailscale/${node}:80`, `tailscale/${node}:443`];
}

/** The `tailscale_auth` equivalent: Caddy's authentication handler with the plugin's provider. */
export function buildTailscaleAuthHandler(): Record<string, unknown> {
  return { handler: "authentication", providers: { tailscale: {} } };
}

/**
 * Identity the plugin puts on the authenticated user, and the header each is forwarded as.
 *
 * The placeholder keys are Caddy's `http.auth.user.<metadata key>`, so they have to match the
 * plugin's Authenticate() exactly — a typo forwards an empty header rather than failing. Header
 * names are in Go's canonical MIME casing for the same reason the CPM forward-auth ones are:
 * Caddy looks them up literally.
 */
export const TAILSCALE_IDENTITY_HEADERS: Record<string, string> = {
  "X-Tailscale-User": "{http.auth.user.tailscale_user}",
  "X-Tailscale-Login": "{http.auth.user.tailscale_login}",
  "X-Tailscale-Name": "{http.auth.user.tailscale_name}",
  "X-Tailscale-Tailnet": "{http.auth.user.tailscale_tailnet}",
  "X-Tailscale-Profile-Picture": "{http.auth.user.tailscale_profile_picture}",
};

/**
 * Drop client-supplied identity headers before anything else runs. Without this a request could
 * arrive claiming to be someone, and the upstream would have no way to tell that apart from a
 * header this proxy set.
 */
export function buildTailscaleIdentityStripHandler(): Record<string, unknown> {
  return { handler: "headers", request: { delete: Object.keys(TAILSCALE_IDENTITY_HEADERS) } };
}

/** Set the identity headers from the authenticated user. Only valid after the auth handler. */
export function buildTailscaleIdentityHeadersHandler(): Record<string, unknown> {
  return {
    handler: "headers",
    request: {
      set: Object.fromEntries(
        Object.entries(TAILSCALE_IDENTITY_HEADERS).map(([header, placeholder]) => [
          header,
          [placeholder],
        ]),
      ),
    },
  };
}

/**
 * Auth and the identity headers as one handler, so callers that place a single "auth handler" in a
 * route chain — the shared path-mode builder — get both or neither.
 */
export function buildTailscaleAuthSubroute(forwardIdentity: boolean): Record<string, unknown> {
  const handle = forwardIdentity
    ? [buildTailscaleAuthHandler(), buildTailscaleIdentityHeadersHandler()]
    : [buildTailscaleAuthHandler()];
  return { handler: "subroute", routes: [{ handle }] };
}

/**
 * The reverse-proxy transport that dials through a node. `tls` is passed through rather than
 * derived: the plugin treats any non-nil TLS config as "use https" and reads nothing out of it, so
 * the caller's existing https/skip-verify decision carries over unchanged.
 *
 * A node named only here is never started until the first request goes through it. Releasing one in
 * that state used to crash Caddy from inside tsnet, which is why docker/caddy/go.mod pins the
 * plugin to a fork — see the note there before moving that pin.
 */
export function buildTailscaleTransport(
  node: string,
  tls: Record<string, unknown> | null,
): Record<string, unknown> {
  return { protocol: "tailscale", name: node, ...(tls ? { tls } : {}) };
}

/**
 * An automation policy that serves `.ts.net` names from Tailscale instead of ACME.
 *
 * Caddy provisions no issuers for a policy whose subjects are all `.ts.net` and whose managers
 * include this one, so there is deliberately no `issuers` key — adding one would put the policy
 * back on ACME for names no public CA can validate.
 */
export function buildTailscaleAutomationPolicy(subjects: string[]): Record<string, unknown> {
  return { subjects, get_certificate: [{ via: "tailscale" }] };
}
