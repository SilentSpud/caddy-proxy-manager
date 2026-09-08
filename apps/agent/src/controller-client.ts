/**
 * The agent's side of the wire: everything it says to its controller, and the one stream it listens
 * on.
 *
 * The agent dials, always. That is the whole point of the inversion — a host behind NAT needs no
 * inbound port and the controller needs no address for it — and it is why this file exists at all,
 * where the same traffic used to arrive as inbound requests to `server.ts`.
 *
 * Requests are signed with the same HMAC primitive the controller used to sign its own, over the
 * same canonical string. The secret never travels with a request, so it cannot be lifted from a
 * proxy log between the agent and its controller.
 */

import { createHmac } from "node:crypto";
import {
  AGENT_ID_HEADER,
  AGENT_SIGNATURE_HEADER,
  AGENT_TIMESTAMP_HEADER,
  type AgentCommandResult,
  type AgentPairRequest,
  type AgentPairResponse,
  type AgentServerEvent,
  type AgentStatus,
  AGENT_OPERATIONS,
  CONTROLLER_AGENT_ROUTES,
  signatureBase,
} from "@cpm/shared";

/** Pairing crosses a network an operator just typed an address for, so it fails fast on a typo. */
const PAIR_TIMEOUT_MS = 15_000;

/** Status and command results are small; neither should wait on a stalled connection for long. */
const POST_TIMEOUT_MS = 15_000;

/**
 * Hex SHA-256 of a request body — of the empty string when there is none.
 *
 * Part of the signature base, so the signature covers the body without the signer having to buffer
 * it twice. Lived in `auth.ts` until the agent stopped verifying anything and only signs.
 */
async function sha256Hex(body: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body);
  return hasher.digest("hex");
}

export class ControllerUnreachable extends Error {
  constructor(url: string, cause: unknown) {
    super(`Could not reach the controller at ${url}: ${describe(cause)}`);
    this.name = "ControllerUnreachable";
  }
}

/**
 * The controller answered, and said no.
 *
 * Separate from `ControllerUnreachable` because the two mean opposite things to the caller: a
 * refused call with 401 invalidates the stored secret, while an unreachable controller is a network
 * blip the agent should keep retrying through without discarding anything.
 */
export class ControllerRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ControllerRejected";
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** The error body the controller sends, when it sends one. A plain 500 has no JSON at all. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // Not JSON. The status line is all there is to report.
  }
  return fallback;
}

export class ControllerClient {
  constructor(
    private readonly url: string,
    private readonly agentId: string,
  ) {}

  get controllerUrl(): string {
    return this.url;
  }

  /**
   * Exchange a one-time code for the shared secret.
   *
   * Unsigned, and the only unsigned call the agent makes: there is nothing to sign with yet. The
   * code is what stands in for the secret, which is why it is short-lived and burned on use.
   */
  async pair(request: AgentPairRequest): Promise<AgentPairResponse> {
    const response = await this.send(
      CONTROLLER_AGENT_ROUTES.pair,
      "POST",
      JSON.stringify(request),
      PAIR_TIMEOUT_MS,
      null,
    );
    if (!response.ok) {
      throw new ControllerRejected(
        response.status,
        await errorMessage(
          response,
          `The controller refused the pairing code (${response.status}).`,
        ),
      );
    }
    return (await response.json()) as AgentPairResponse;
  }

  /**
   * Run one GraphQL operation and return its data, or throw what the controller said.
   *
   * GraphQL answers 200 with an `errors` array where REST answered a status code, so a caller that
   * only checked `response.ok` would treat "that agent is not connected" as success. The status is
   * still checked first — an unauthenticated request never reaches the resolver — and then the
   * body.
   */
  private async operation<T>(
    secret: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });
    const response = await this.send(
      CONTROLLER_AGENT_ROUTES.graphql,
      "POST",
      body,
      POST_TIMEOUT_MS,
      secret,
    );

    if (!response.ok) {
      throw new ControllerRejected(
        response.status,
        await errorMessage(response, `The controller refused the request (${response.status}).`),
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: T;
      errors?: GraphQLErrorShape[];
    } | null;

    const failure = payload?.errors?.[0];
    if (failure) {
      // GraphQL answers 200 with an errors array where REST answered a status code, and the
      // lifecycle upstream keys on that code: only a 401 means the controller has forgotten this
      // agent, which is what stops it retrying a secret that will never be accepted again.
      // Flattening every refusal to one code would leave an unpaired agent looping forever.
      throw new ControllerRejected(statusForError(failure), failure.message ?? "Request refused.");
    }
    if (!payload?.data) {
      throw new ControllerRejected(response.status, "The controller returned no data.");
    }
    return payload.data;
  }

  /** Report what this agent currently has applied. */
  async postStatus(secret: string, status: AgentStatus): Promise<void> {
    await this.operation(secret, AGENT_OPERATIONS.status, { status });
  }

  /**
   * Hand back the results of commands the subscription issued.
   *
   * Its own request rather than a message on the subscription, because a subscription only runs
   * one way: SSE has no client-to-server channel, which is exactly the trade that keeps this side
   * of the conversation in ordinary mutations.
   */
  async postResults(secret: string, results: AgentCommandResult[]): Promise<void> {
    if (results.length === 0) return;
    await this.operation(secret, AGENT_OPERATIONS.commandResults, { results });
  }

  /**
   * Open the event subscription and yield events until it ends or `signal` aborts.
   *
   * No overall timeout: this request is meant to stay open for as long as the agent runs. Liveness
   * is the protocol's `ping` event instead — a subscription that has said nothing at all is the one
   * case a timeout could not tell apart from a healthy idle fleet.
   */
  async *events(secret: string, signal: AbortSignal): AsyncGenerator<AgentServerEvent> {
    const response = await this.send(
      CONTROLLER_AGENT_ROUTES.graphql,
      "POST",
      JSON.stringify({ query: AGENT_OPERATIONS.events }),
      null,
      secret,
      signal,
      { accept: "text/event-stream" },
    );

    if (!response.ok) {
      throw new ControllerRejected(
        response.status,
        await errorMessage(response, `The controller refused the stream (${response.status}).`),
      );
    }
    if (!response.body) {
      throw new ControllerRejected(response.status, "The controller's event stream had no body.");
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += value;

        // Frames are separated by a blank line. A partial frame stays in the buffer until the rest
        // of it arrives, which for a config push large enough to span TCP segments is the norm.
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = parseFrame(frame);
          if (event) yield event;
          split = buffer.indexOf("\n\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => {
        // The stream is being torn down either way; a cancel that fails changes nothing.
      });
    }
  }

  /**
   * Sign and send. `secret` null means an unsigned call, which only pairing is.
   *
   * The signature covers method, path, timestamp and a hash of the body — the same base string the
   * controller verifies — so a captured request cannot be replayed against a different endpoint,
   * and goes stale within `AGENT_CLOCK_SKEW_MS` regardless.
   */
  private async send(
    path: string,
    method: string,
    body: string,
    timeoutMs: number | null,
    secret: string | null,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      [AGENT_ID_HEADER]: this.agentId,
      ...extraHeaders,
    };
    if (method !== "GET") headers["content-type"] = "application/json";

    if (secret) {
      const timestamp = Date.now();
      headers[AGENT_TIMESTAMP_HEADER] = String(timestamp);
      headers[AGENT_SIGNATURE_HEADER] = createHmac("sha256", secret)
        .update(signatureBase(method, path, timestamp, await sha256Hex(body)))
        .digest("hex");
    }

    try {
      return await fetch(`${this.url}${path}`, {
        method,
        headers,
        ...(method === "GET" ? {} : { body }),
        signal: signal ?? (timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs)),
      });
    } catch (cause) {
      throw new ControllerUnreachable(this.url, cause);
    }
  }
}

type GraphQLErrorShape = { message?: string; extensions?: { code?: unknown } };

/**
 * The status code a GraphQL error stands for.
 *
 * The controller tags its refusals with `extensions.code`, and this is where those become the
 * codes the rest of the agent already reasons about. 401 is the one that matters: the lifecycle
 * treats it as "the controller has forgotten this agent" and drops to idle, where every other code
 * means retry. Getting this wrong in either direction is bad — a mapped-down 401 loops forever
 * against a secret that will never work, and a mapped-up anything-else throws away a pairing over
 * a transient fault.
 *
 * An untagged error is a fault the controller did not anticipate, which is a retry rather than a
 * reason to unpair.
 */
function statusForError(error: GraphQLErrorShape): number {
  switch (error.extensions?.code) {
    case "AGENT_UNAUTHORIZED":
      return 401;
    case "AGENT_NOT_CONNECTED":
      return 409;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    default:
      return 400;
  }
}

/**
 * One SSE frame to an event, or null for anything that carries no payload.
 *
 * Keepalives are comment lines (`:`), which is the whole reason they are cheap: they hold the
 * connection open through a proxy's idle timeout without the agent having to interpret them.
 */
function parseFrame(frame: string): AgentServerEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (data.length === 0) return null;

  let payload: { data?: { agentEvents?: AgentServerEvent }; errors?: GraphQLErrorShape[] };
  try {
    payload = JSON.parse(data);
  } catch {
    // A frame the controller wrote badly must not take the subscription down; the next one may
    // be fine.
    return null;
  }

  // A subscription delivers execution results, so each frame is `{"data":{"agentEvents":…}}`
  // rather than the event itself. An `errors` frame is a resolver that failed mid-stream: nothing
  // to act on, and the subscription carries on — the controller closes it if it is really over.
  if (payload.errors?.length) {
    const failure = payload.errors[0] ?? {};
    // A refusal can arrive inside a frame rather than as a status, and it means the same thing:
    // if the controller has forgotten this agent, sitting in the read loop would retry a secret
    // that will never be accepted. Thrown so the lifecycle sees it, exactly as it would from a
    // mutation.
    if (statusForError(failure) === 401) {
      throw new ControllerRejected(401, failure.message ?? "The controller refused the stream.");
    }
    console.warn(
      "[controller] The event subscription reported an error:",
      failure.message ?? "unknown",
    );
    return null;
  }
  return payload.data?.agentEvents ?? null;
}
