/**
 * The agent's half of the schema.
 *
 * An agent is not a user. It authenticates by signing its request with the secret agreed at
 * pairing - `x-cpm-agent`, `x-cpm-timestamp`, `x-cpm-signature` over the body - and it holds one
 * subscription open for as long as it runs. Everything the controller pushes travels down that
 * subscription; everything the agent reports comes back as a mutation.
 *
 * **Why it lives in the same schema as the operator API.** Two schemas would mean two endpoints,
 * two servers and two sets of transport decisions, for a difference that is entirely about which
 * credential arrives. The gate is per field instead: `agentEvents`, `agentStatus` and
 * `agentCommandResults` require a signed agent and reject a Bearer token, and every other field
 * requires a user and rejects a signature. Nothing is reachable by both.
 *
 * **Pairing is deliberately still REST.** It runs before there is a secret to sign with, so it
 * cannot use this path - the exchange is what produces the credential everything here depends on.
 */

import {
  MAX_CADDY_CONFIG_BYTES,
  type AgentCommandResult,
  type AgentServerEvent,
  type AgentStatus,
} from "@cpm/shared";
import { attach, isConnected, recordStatus, settleResults } from "../agent/registry";
import { buildDesiredState } from "../agent/desired-state";
import { verifyAgentRequest } from "../agent/verify";
import { getControllerId, recordAgentContact } from "../models/agents";
import { getSetting } from "../settings";
import type { GraphQLContext } from "./context";
import { GraphQLError } from "graphql";

/**
 * How large a signed agent request may be, per operation.
 *
 * These were two routes with two different caps, and collapsing them into one endpoint lost that:
 * a status is one small object, but a command result carries a Caddy admin response, which for a
 * config readback is measured in megabytes. One shared 64KiB ceiling would have rejected valid
 * results before they were even verified.
 */
const MAX_STATUS_BYTES = 64 * 1024;

export type VerifiedAgent = { id: number; agentId: string; name: string };

/**
 * The agent behind this request, or a refusal.
 *
 * The body is read from a clone. Yoga has already consumed the original to parse the document, and
 * the signature covers the bytes the agent sent - verifying anything else would be verifying a
 * re-serialisation that may differ in key order or spacing from what was signed.
 */
export async function requireAgent(
  context: GraphQLContext,
  maxBytes: number,
): Promise<VerifiedAgent> {
  const raw = await context.rawBody();
  if (raw.length > maxBytes) {
    throw new GraphQLError("That request is too large.", {
      extensions: { code: "PAYLOAD_TOO_LARGE" },
    });
  }

  const verified = await verifyAgentRequest(context.request, raw);
  if (!verified.ok) {
    throw new GraphQLError(verified.error, { extensions: { code: "AGENT_UNAUTHORIZED" } });
  }
  return { id: verified.agent.id, agentId: verified.agent.agentId, name: verified.agent.name };
}

export const agentResolvers = {
  Subscription: {
    agentEvents: {
      subscribe: async (_: unknown, __: unknown, context: GraphQLContext) => {
        // The document is all that is sent to open one; the payloads travel the other way.
        const agent = await requireAgent(context, MAX_STATUS_BYTES);

        const controllerName =
          (await getSetting<string>("branding_title").catch(() => null)) || "Caddy Proxy Manager";

        const { events } = attach({
          agentId: agent.agentId,
          agentRowId: agent.id,
          name: agent.name,
          controllerId: await getControllerId(),
          controllerName,
          // Built for this agent: the ports its own hosts need, and its own module selection.
          initialState: await buildDesiredState(agent.id),
        });

        // Wrapped so each value arrives under the field name the document asked for.
        return (async function* () {
          for await (const event of events) {
            yield { agentEvents: event };
          }
        })();
      },
      resolve: (payload: { agentEvents: AgentServerEvent }) => payload.agentEvents,
    },
  },

  Mutation: {
    agentStatus: async (
      _: unknown,
      args: { status: AgentStatus },
      context: GraphQLContext,
    ): Promise<boolean> => {
      const agent = await requireAgent(context, MAX_STATUS_BYTES);

      // Refused rather than accepted: a status from an agent with no open subscription describes a
      // host the controller cannot reach, and recording it would make the dashboard claim
      // otherwise.
      if (!isConnected(agent.agentId)) {
        throw new GraphQLError("That agent is not connected.", {
          extensions: { code: "AGENT_NOT_CONNECTED" },
        });
      }

      recordStatus(agent.agentId, args.status);
      await recordAgentContact(agent.id, { ok: true });
      return true;
    },

    agentCommandResults: async (
      _: unknown,
      args: { results: AgentCommandResult[] },
      context: GraphQLContext,
    ): Promise<boolean> => {
      // The ceiling a Caddy config readback needs, which is what these results carry.
      const agent = await requireAgent(context, MAX_CADDY_CONFIG_BYTES);

      settleResults(agent.agentId, args.results);
      return true;
    },
  },
};
