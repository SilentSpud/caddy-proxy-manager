/**
 * The controller <-> agent contract.
 *
 * The agent is a separate service reached over HTTP: a Unix socket on the same host, or a TCP
 * address after an operator has paired the two. Every field either side puts on the wire is named
 * here, because the two are built from different source trees and a rename that reaches only one
 * of them fails at runtime rather than at compile time.
 *
 * Request authentication is HMAC-SHA256 over a canonical string, not a bearer token — see
 * `signatureBase`. The secret is established once (written beside the socket in standalone mode,
 * handed back by `POST /v1/pair` in managed mode) and never travels with a request.
 */

/** Path prefix every authenticated endpoint sits under. */
export const AGENT_API_PREFIX = "/v1";

export const AGENT_ROUTES = {
  /** Unauthenticated liveness. Answers before pairing, so the UI can say "reachable, not paired". */
  health: "/health",
  /** Exchange a one-time code for the shared secret. Managed mode only. */
  pair: "/v1/pair",
  /** Everything the controller shows about this agent in one round trip. */
  status: "/v1/status",
  /** GET the applied ports; POST a new set to publish. */
  l4Ports: "/v1/l4-ports",
  /** GET the applied module list; POST a new one to rebuild with. */
  caddyBuild: "/v1/caddy-build",
  /** Proxy a request to this agent's own Caddy admin API. */
  caddyAdmin: "/v1/caddy-admin",
  /** Push the credentials an agent needs to reach the controller's shared services. */
  fleetConfig: "/v1/fleet-config",
} as const;

// ─── Authentication ──────────────────────────────────────────────────────────

/** Header carrying the request's Unix-millisecond timestamp. Part of the signed material. */
export const AGENT_TIMESTAMP_HEADER = "x-cpm-timestamp";
/** Header carrying the lowercase hex HMAC-SHA256 of `signatureBase`. */
export const AGENT_SIGNATURE_HEADER = "x-cpm-signature";
/** Header naming which paired controller is calling, so the agent can pick the right secret. */
export const AGENT_CONTROLLER_HEADER = "x-cpm-controller";
/**
 * Header naming which paired agent is calling, for the one route that runs the other way.
 *
 * The shared secret is symmetric, so an agent can sign a request to the controller with the same
 * primitive and the controller can verify it against the row it stored at pairing. That is why
 * fetching the GeoIP databases needs no second credential.
 */
export const AGENT_ID_HEADER = "x-cpm-agent";

/**
 * How far a request's timestamp may be from the agent's clock. Wide enough to survive two
 * containers whose clocks were never synchronised, narrow enough that a captured request stops
 * being replayable in a minute rather than a day.
 */
export const AGENT_CLOCK_SKEW_MS = 60_000;

/**
 * The exact bytes both sides sign. Newline-separated with a fixed field count, so no combination
 * of path and body can be made to produce another request's base string.
 *
 * `bodyHash` is the hex SHA-256 of the raw body — of the empty string when there is none — which
 * keeps the signature over the body without making the signer buffer it twice.
 */
export function signatureBase(
  method: string,
  path: string,
  timestamp: number,
  bodyHash: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

/** Alphabet the pairing code is drawn from: capitals only, so it can be read aloud and typed. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 6;
/** How long a pairing code stays valid. The agent prints a fresh one when this elapses. */
export const PAIRING_CODE_TTL_MS = 5 * 60_000;

export type PairRequest = {
  /** The code the operator read off the agent's logs. */
  code: string;
  /** Stable id of the controller asking, so re-pairing replaces its secret rather than adding one. */
  controllerId: string;
  /** Shown in the agent's logs so an operator can tell two controllers apart. */
  controllerName?: string;
};

export type PairResponse = {
  /** Hex-encoded shared secret. Returned exactly once, at pairing time. */
  secret: string;
  agentId: string;
  agentVersion: string;
};

// ─── Status ──────────────────────────────────────────────────────────────────

export type L4PortsState = "idle" | "pending" | "applying" | "applied" | "failed";
export type CaddyBuildState = "idle" | "pending" | "building" | "applied" | "failed";

/** Shared shape of both operation statuses. `state` narrows per operation. */
export type AgentOperationStatus<TState extends string> = {
  state: TState;
  message?: string;
  appliedAt?: string;
  triggeredAt?: string;
  error?: string;
};

export type L4PortsStatus = AgentOperationStatus<L4PortsState>;
export type CaddyBuildStatus = AgentOperationStatus<CaddyBuildState>;

export type AgentStatus = {
  agentId: string;
  version: string;
  mode: AgentMode;
  /** Compose project the agent operates on, as detected from the Caddy container's labels. */
  composeProject: string;
  l4Ports: {
    /** Ports currently published on the Caddy container, as `HOST:CONTAINER[/proto]`. */
    applied: string[];
    status: L4PortsStatus;
  };
  caddyBuild: {
    /**
     * xcaddy `--with` specs the running binary was actually built with, or null when this agent
     * has never rebuilt it — which the controller reads as the shipped image's full catalog. An
     * empty array is a different and much worse claim: "built with no plugins at all".
     */
    applied: string[] | null;
    status: CaddyBuildStatus;
  };
  analytics: {
    /** Whether the controller has given this agent somewhere to write events. */
    enabled: boolean;
    /**
     * Whether Caddy's access log exists on this host.
     *
     * Reported by the agent because only the agent can see it. The controller shows "logging is
     * off" from this: with the log on another host, checking its own filesystem would say the
     * feature is disabled on every remote deployment that has it switched on.
     */
    accessLogPresent: boolean;
  };
};

export type AgentMode = "standalone" | "managed";

// ─── Requests ────────────────────────────────────────────────────────────────

export type ApplyL4PortsRequest = {
  /** `HOST:CONTAINER` or `HOST:CONTAINER/udp`, already deduplicated and sorted by the controller. */
  ports: string[];
};

export type ApplyCaddyBuildRequest = {
  /** xcaddy `--with` module specs to compile the new image with. */
  modules: string[];
};

/** Every write returns the status the operation started in, never a bare 204. */
export type ApplyResponse<TStatus> = {
  accepted: boolean;
  status: TStatus;
};

// ─── Caddy admin proxy ───────────────────────────────────────────────────────

/**
 * A request for the agent to make against its own Caddy.
 *
 * The agent is the only thing that knows where its Caddy is, so every admin call goes through it
 * rather than the controller dialling an address of its own. Without this a paired remote agent
 * would recreate the *remote* container while the controller kept configuring a *local* Caddy.
 */
export type CaddyAdminProxyRequest = {
  /** Path under the admin API root, e.g. "/load" or "/config/". Must be absolute. */
  path: string;
  method: string;
  body?: string;
  /** Defaults to application/json; /adapt needs text/caddyfile. */
  contentType?: string;
};

/** Caddy's own answer, passed back unchanged. A non-2xx status is data here, not an error. */
export type CaddyAdminProxyResponse = {
  status: number;
  text: string;
  headers: Record<string, string>;
};

/**
 * Largest Caddy config the proxy route accepts.
 *
 * A generated document grows with the number of proxy hosts, and a deployment with hundreds of
 * them produces megabytes. Well above anything realistic, and still bounded.
 */
export const MAX_CADDY_CONFIG_BYTES = 8 * 1024 * 1024;

// ─── Fleet configuration ─────────────────────────────────────────────────────

/**
 * What an agent needs to reach the services that live with the controller.
 *
 * Pushed rather than fetched, so an agent needs no credential for the controller and the direction
 * of trust stays one-way: the controller reaches agents, never the reverse.
 */
/**
 * The MaxMind databases an agent may be given.
 *
 * Country is what the log parsers read; Caddy's geo-blocking uses Country and ASN. City is
 * included because a deployment that subscribes to it expects it present, not because anything
 * here requires it.
 */
export const GEOIP_EDITIONS = ["GeoLite2-Country", "GeoLite2-ASN", "GeoLite2-City"] as const;
export type GeoipEdition = (typeof GEOIP_EDITIONS)[number];

export type FleetConfig = {
  /**
   * Where to write analytics, or null when the deployment has none.
   *
   * The agent inserts its own events rather than shipping them to the controller: a controller on
   * another host cannot read the Caddy log file at all, and proxying every request through it
   * would put the busiest write path in the fleet through a machine that has nothing to do with it.
   */
  clickhouse: {
    url: string;
    user: string;
    password: string;
    database: string;
  } | null;

  /**
   * Where to fetch the MaxMind databases, or null when the controller has none.
   *
   * The controller holds the subscription and the files; agents reach them through it rather than
   * each host holding a licence key of its own. Pulled rather than pushed because these are tens
   * of megabytes — the only route in the protocol that runs agent-to-controller, and the reason
   * `AGENT_ID_HEADER` exists.
   *
   * `url` must be an address the agent can reach, which for a remote agent means the controller's
   * public one.
   */
  geoip: {
    url: string;
    editions: string[];
  } | null;
};

// ─── Analytics rows ──────────────────────────────────────────────────────────

/** One line of Caddy's access log, as the analytics tables store it. */
export type TrafficEventRow = {
  ts: number;
  client_ip: string;
  country_code: string | null;
  host: string;
  method: string;
  uri: string;
  status: number;
  proto: string;
  bytes_sent: number;
  user_agent: string;
  is_blocked: boolean;
};

/** One Coraza audit-log entry, as the analytics tables store it. */
export type WafEventRow = {
  ts: number;
  host: string;
  client_ip: string;
  country_code: string | null;
  rule_id: number | null;
  rule_message: string | null;
  severity: string | null;
  raw_data: string | null;
  blocked: boolean;
  method: string;
  uri: string;
};

// ─── Errors ──────────────────────────────────────────────────────────────────

export type AgentErrorBody = { error: string; code: AgentErrorCode };

export type AgentErrorCode =
  | "UNAUTHENTICATED"
  | "PAIRING_DISABLED"
  | "PAIRING_CODE_INVALID"
  | "PAIRING_CODE_EXPIRED"
  | "BAD_REQUEST"
  | "BUSY"
  | "INTERNAL";
