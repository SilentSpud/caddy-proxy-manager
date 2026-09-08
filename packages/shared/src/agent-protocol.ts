/**
 * The controller <-> agent contract.
 *
 * The agent dials the controller and holds one event stream open; the controller never dials the
 * agent. Every field either side puts on the wire is named here, because the two are built from
 * different source trees and a rename that reaches only one of them fails at runtime rather than
 * at compile time.
 *
 * Request authentication is HMAC-SHA256 over a canonical string, not a bearer token — see
 * `signatureBase`. The secret is minted by the controller at pairing and never travels with a
 * request.
 */

// ─── Authentication ──────────────────────────────────────────────────────────

/** Header carrying the request's Unix-millisecond timestamp. Part of the signed material. */
export const AGENT_TIMESTAMP_HEADER = "x-cpm-timestamp";
/** Header carrying the lowercase hex HMAC-SHA256 of `signatureBase`. */
export const AGENT_SIGNATURE_HEADER = "x-cpm-signature";
/**
 * Header naming which paired agent is calling, so the controller can pick the right secret.
 *
 * The shared secret is symmetric, so the agent signs with the same primitive the controller once
 * used and the controller verifies against the row it stored at pairing.
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

// ─── Status ──────────────────────────────────────────────────────────────────

export type L4PortsState = "idle" | "pending" | "applying" | "applied" | "failed";
export type CaddyBuildState = "idle" | "pending" | "building" | "applied" | "failed";
export type ManagedServicesState = "idle" | "pending" | "applying" | "applied" | "failed";

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
export type ManagedServicesStatus = AgentOperationStatus<ManagedServicesState>;

/**
 * The optional compose services the agent may start and stop.
 *
 * Both sit behind a compose profile, which is why they need an agent at all: a profile is decided
 * when the operator runs `docker compose up`, so nothing inside the stack can turn one on. The
 * agent runs the compose CLI, so it can — see `ManagedServicesRequest`.
 */
export const MANAGED_SERVICES = ["clickhouse", "geoipupdate"] as const;
export type ManagedServiceName = (typeof MANAGED_SERVICES)[number];

/**
 * Variables the compose file interpolates for those services, which the agent writes to a generated
 * env file and passes as an extra `--env-file`.
 *
 * An allowlist rather than a free-form map: these become lines in a file the compose CLI parses, so
 * an unconstrained key is a route to setting any variable the project reads.
 */
export const MANAGED_SERVICE_ENV_KEYS = [
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DB",
  "GEOIPUPDATE_ACCOUNT_ID",
  "GEOIPUPDATE_LICENSE_KEY",
] as const;
export type ManagedServiceEnvKey = (typeof MANAGED_SERVICE_ENV_KEYS)[number];

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
  services: {
    /**
     * What this agent last brought up or took down, or null before it has been asked.
     *
     * Recorded rather than probed: `docker compose ps` is a subprocess per service, and this status
     * is read on every render of several pages. The controller only needs to know whether its last
     * request landed, which is what this answers.
     */
    applied: Record<ManagedServiceName, boolean> | null;
    status: ManagedServicesStatus;
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

/**
 * Which optional services should be running, and what compose needs to interpolate to start them.
 *
 * `env` is sent because those services read credentials the controller now holds in its own
 * settings, while compose reads them from the host `.env` the agent cannot write. Rather than ask
 * the operator to keep the two in step, the agent writes what it is given to a generated env file
 * and hands compose an extra `--env-file`.
 */
export type ManagedServicesRequest = {
  services: Record<ManagedServiceName, boolean>;
  env: Partial<Record<ManagedServiceEnvKey, string>>;
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

// ═══ Controller-side agent API ═══════════════════════════════════════════════
//
// The agent dials the controller, never the reverse: a host behind NAT needs no inbound port, and
// the controller needs no address for it. Pairing is minted by the controller and carried to the
// agent by an operator running `cpm-agent --pair`.
//
// Only one direction actually needed inventing. The agent can always dial out, so its status and
// command results are plain POSTs; what the controller cannot do is call in, so everything it needs
// to push — desired state, and the Caddy admin calls it blocks on — goes down one long-lived
// Server-Sent Events stream the agent holds open. That keeps the whole surface inside ordinary
// route handlers, which is why dev and the compiled server behave identically.
//
// `AGENT_ROUTES` above are the agent's own, and are now local control only — nothing on the
// network calls them.

/** Path prefix for everything an agent calls on its controller. */
export const CONTROLLER_AGENT_API_PREFIX = "/api/agent/v1";

export const CONTROLLER_AGENT_ROUTES = {
  /**
   * Unauthenticated, and deliberately not GraphQL.
   *
   * Pairing runs before there is a secret, and the secret is what every signed call — including
   * every GraphQL one — depends on. A chicken-and-egg exchange does not belong behind the door it
   * is producing the key for.
   */
  pair: `${CONTROLLER_AGENT_API_PREFIX}/pair`,
  /**
   * Everything else: the event subscription, the status report and the command results.
   *
   * One endpoint, because that is how GraphQL works. The agent opens a `subscription` here and
   * holds it open — delivered as SSE, read with `fetch` rather than `EventSource` because this is
   * Bun and not a browser, so the request carries the same signature headers as every other call
   * and needs no token in a query string. Its reports go to the same URL as mutations.
   */
  graphql: "/api/graphql",
} as const;

/** The documents the agent sends. Written out so both ends can be read against one definition. */
export const AGENT_OPERATIONS = {
  events: "subscription AgentEvents { agentEvents }",
  status: "mutation AgentStatus($status: JSON!) { agentStatus(status: $status) }",
  commandResults:
    "mutation AgentCommandResults($results: [JSON!]!) { agentCommandResults(results: $results) }",
} as const;

// The MaxMind databases are not listed here: that route already ran agent-to-controller, keeps its
// pre-v1 path, and the agent is handed its full URL in `FleetConfig.geoip` rather than deriving it.

/** Header naming the agent making a signed call, so the controller can pick the right secret. */
export const CONTROLLER_AGENT_HEADER = AGENT_ID_HEADER;

/**
 * How often the controller writes a comment frame to an idle stream.
 *
 * SSE has no ping of its own, and a stream that says nothing for minutes is indistinguishable from
 * one a proxy silently dropped. Comfortably inside the 60s idle timeout most proxies default to.
 */
export const AGENT_STREAM_KEEPALIVE_MS = 20_000;

/** How long the agent waits before redialling a stream that closed. Backs off on repeated failure. */
export const AGENT_RECONNECT_MIN_MS = 1_000;
export const AGENT_RECONNECT_MAX_MS = 30_000;

/** Longest the controller waits for a command's result before failing whoever is blocked on it. */
export const AGENT_COMMAND_TIMEOUT_MS = 60_000;

/** Slow heartbeat: the agent reposts status this often even when nothing changed. */
export const AGENT_STATUS_HEARTBEAT_MS = 60_000;

/**
 * Filename of the bootstrap token the controller leaves on a shared data volume.
 *
 * Named here because both sides open the same file under different mounts — the controller writes
 * it under its data directory, the agent reads it under `DATA_DIR` — and a rename that reached only
 * one of them would silently stop the bundled stack pairing itself, with no error anywhere.
 *
 * Only meaningful for an agent sharing the controller's volume, which means the same host. A remote
 * agent has no such file and pairs with a code an operator carries.
 */
export const AGENT_BOOTSTRAP_FILE = "agent-bootstrap";

/** Shape of that token, so either side can tell one from a typed six-letter code. */
export const AGENT_BOOTSTRAP_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// ─── Pairing (controller-minted) ─────────────────────────────────────────────

export type AgentPairRequest = {
  /** The code the operator read off the controller's UI. */
  code: string;
  /** Stable id this agent will identify itself by from now on. Generated once, then persisted. */
  agentId: string;
  /** Shown in the controller's agent list so an operator can tell two hosts apart. */
  agentName?: string;
  agentVersion: string;
};

export type AgentPairResponse = {
  /** Hex-encoded shared secret. Returned exactly once, at pairing time. */
  secret: string;
  /** Stable id of the controller, echoed on every later request so a re-pair is detectable. */
  controllerId: string;
  controllerName: string;
};

// ─── Desired state ───────────────────────────────────────────────────────────

/**
 * What the agent should have, pushed whenever it changes and once when the stream opens.
 *
 * Absolute, never incremental — the agent diffs it against its own applied state and acts only on
 * a difference, which is what makes a dropped stream cost nothing but the reconnect.
 */
export type AgentDesiredState = {
  /** Ports Caddy should publish, as `HOST:CONTAINER[/proto]`. */
  l4Ports: string[];
  /** xcaddy `--with` specs Caddy's image should be built with. */
  caddyModules: string[];
  /** Which optional compose services should be running, and what compose must interpolate. */
  services: ManagedServicesRequest;
  fleetConfig: FleetConfig;
  /**
   * Whether the agent may run Caddy at all.
   *
   * False before the controller has anything to serve, which is what keeps ports 80 and 443 shut
   * on a freshly installed host rather than answering with a default page.
   */
  caddyEnabled: boolean;
};

// ─── Stream frames ───────────────────────────────────────────────────────────

/**
 * Work the controller needs done on the agent's host, now, with an answer.
 *
 * Everything else the controller sends is desired state the agent reconciles at its own pace. This
 * is the exception: a Caddy admin call has a response the controller is waiting on, and inverting
 * the dial direction is what forced it onto the stream rather than a request.
 */
export type AgentCommand = {
  /** Correlates the result. Opaque to the agent. */
  id: string;
  kind: "caddy-admin";
  request: CaddyAdminProxyRequest;
};

/** Everything the controller can push down the stream. */
export type AgentServerEvent =
  | { type: "desired-state"; state: AgentDesiredState }
  | { type: "command"; command: AgentCommand }
  /** Sent once when the stream opens, so the agent can log what it is attached to. */
  | { type: "hello"; controllerId: string; controllerName: string }
  /**
   * Nothing to say, said out loud.
   *
   * A stream that is silent for minutes is indistinguishable from one a proxy dropped without
   * telling either end. This used to be an SSE comment frame, which only worked because the
   * controller was writing the frames itself; as a GraphQL subscription the transport belongs to
   * the server library, so the keepalive has to be part of the protocol rather than under it.
   * The agent ignores it — receiving it is the entire point.
   */
  | { type: "ping" };

export type AgentCommandResult = { id: string } & (
  | { ok: true; response: CaddyAdminProxyResponse }
  | { ok: false; error: string; code: AgentErrorCode }
);

export type AgentCommandResultsRequest = { results: AgentCommandResult[] };

export type AgentStatusRequest = { status: AgentStatus };

// ─── Local control ───────────────────────────────────────────────────────────

/**
 * `cpm-agent --pair` talks to the agent already running on the host, not to the controller: the
 * running process is the one holding the socket and the database, and a second process pairing on
 * its behalf would have to hand the result over anyway.
 */
export const AGENT_LOCAL_ROUTES = {
  /** Unauthenticated liveness, for the container HEALTHCHECK. Answers in every state. */
  health: "/health",
  /** What the agent is doing: idle, pairing, paired, and why. */
  state: "/local/state",
  /** Hand a running agent its controller address and pairing code. */
  pair: "/local/pair",
} as const;

export type AgentLifecycle =
  /** No controller configured. Caddy is held down and nothing is polled. */
  | "idle"
  /** Has an address and a code, exchanging them for a secret. */
  | "pairing"
  /** Paired and polling. */
  | "paired";

export type AgentLocalState = {
  lifecycle: AgentLifecycle;
  agentId: string;
  version: string;
  /** Controller origin once known, else null. */
  controllerUrl: string | null;
  /** Whether Caddy is running, and whether the agent is currently allowed to run it. */
  caddy: { running: boolean; allowed: boolean };
  /** Why the agent is idle or last failed to pair. Operator-facing, English. */
  message: string | null;
};

export type AgentLocalPairRequest = {
  /** Controller host or origin, as typed. A bare host is assumed to be http://. */
  host: string;
  port?: number;
  code: string;
};

export type AgentLocalPairResponse = {
  ok: boolean;
  state: AgentLocalState;
  /** Set when `ok` is false. Already a sentence, and already English — this goes to a terminal. */
  error?: string;
};
