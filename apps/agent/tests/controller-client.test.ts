/**
 * What the agent makes of a GraphQL answer.
 *
 * GraphQL replies 200 with an `errors` array where REST replied with a status code, and the rest
 * of the agent still reasons in status codes — the lifecycle drops to idle on a 401 and retries on
 * anything else. So the translation between the two is load-bearing, and wrong in either direction
 * is bad: a 401 flattened to 400 loops forever against a secret that will never be accepted, and
 * anything else raised to 401 throws away a working pairing over a transient fault.
 *
 * These drive the client against a stub controller rather than a live one. What is being pinned is
 * the meaning the agent takes from a reply, which does not need a socket to exercise.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { ControllerClient, ControllerRejected } from "../src/controller-client";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** Answer every request with one GraphQL payload. */
function respondWith(payload: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function client() {
  return new ControllerClient("http://controller:3000", "agent-1");
}

const STATUS = {
  agentId: "agent-1",
  version: "test",
  mode: "standalone",
  composeProject: "cpm",
  l4Ports: { applied: [], status: { state: "idle" } },
  caddyBuild: { applied: null, status: { state: "idle" } },
  services: { applied: null, status: { state: "idle" } },
  analytics: { enabled: false, accessLogPresent: false },
} as never;

describe("a GraphQL refusal keeps the meaning the lifecycle acts on", () => {
  it("surfaces an unknown agent as 401, so the lifecycle can stop retrying", async () => {
    // The one code that ends the loop. Everything else is a reason to try again later.
    respondWith({
      errors: [{ message: "Unknown agent", extensions: { code: "AGENT_UNAUTHORIZED" } }],
    });

    const error = await client()
      .postStatus("secret", STATUS)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ControllerRejected);
    expect((error as ControllerRejected).status).toBe(401);
    expect((error as ControllerRejected).message).toBe("Unknown agent");
  });

  it("keeps a not-connected refusal retryable", async () => {
    // The controller restarted and has no subscription for this agent yet. Reconnecting fixes it;
    // unpairing would be a catastrophic overreaction.
    respondWith({
      errors: [
        { message: "That agent is not connected.", extensions: { code: "AGENT_NOT_CONNECTED" } },
      ],
    });

    const error = await client()
      .postStatus("secret", STATUS)
      .catch((e: unknown) => e);

    expect((error as ControllerRejected).status).toBe(409);
  });

  it("treats an untagged error as retryable rather than as a lost pairing", async () => {
    // A fault the controller did not anticipate is not evidence that the secret is dead.
    respondWith({ errors: [{ message: "boom" }] });

    const error = await client()
      .postStatus("secret", STATUS)
      .catch((e: unknown) => e);

    expect((error as ControllerRejected).status).toBe(400);
  });

  it("does not treat a successful reply as a refusal", async () => {
    respondWith({ data: { agentStatus: true } });

    await expect(client().postStatus("secret", STATUS)).resolves.toBeUndefined();
  });
});

describe("command results are not capped at a status-sized body", () => {
  it("sends a result far larger than a status without complaint", async () => {
    // A Caddy config readback is measured in megabytes. The controller used to cap this endpoint
    // separately from the status one; folding them into a single GraphQL endpoint is what made it
    // possible to lose that, so the size the agent will send is pinned here.
    let sentBytes = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentBytes = String(init?.body ?? "").length;
      return new Response(JSON.stringify({ data: { agentCommandResults: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await client().postResults("secret", [
      {
        id: "agent-1:1",
        ok: true,
        response: { status: 200, body: "x".repeat(2 * 1024 * 1024), headers: {} },
      },
    ] as never);

    expect(sentBytes).toBeGreaterThan(1024 * 1024);
  });

  it("sends nothing at all when there are no results", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await client().postResults("secret", []);

    expect(called).toBe(false);
  });
});
