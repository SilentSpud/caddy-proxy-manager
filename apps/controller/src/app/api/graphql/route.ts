/**
 * The GraphQL endpoint.
 *
 * One URL for the whole API, plus the agent protocol's subscription — see
 * `src/lib/graphql/agent.ts` for why the agent lives in the same schema rather than a second one.
 *
 * GraphiQL is served in development only. In production it would be an unauthenticated HTML page
 * advertising the shape of every mutation on the box; the schema is still introspectable by an
 * authenticated client, which is what a real GraphQL client needs.
 */

import { createYoga } from "graphql-yoga";
import type { NextRequest } from "next/server";
import { createContext } from "@/src/lib/graphql/context";
import { schema } from "@/src/lib/graphql/schema";

const yoga = createYoga<{ request: NextRequest }>({
  schema,
  graphqlEndpoint: "/api/graphql",
  // Yoga would otherwise answer with its own Response type; Next needs the fetch one, which is
  // what `fetchAPI` pins.
  fetchAPI: { Response },
  graphiql: process.env.NODE_ENV === "development",
  context: ({ request }) => createContext(request as NextRequest),
  // Errors are already shaped by the model layer and `api-errors`. Yoga masking them would turn a
  // "domain already in use" into "Unexpected error", which is worse than useless to a client.
  maskedErrors: {
    maskError: (error) => error as Error,
  },
});

export async function GET(request: NextRequest) {
  return await yoga.handleRequest(request, { request });
}

export async function POST(request: NextRequest) {
  return await yoga.handleRequest(request, { request });
}

export async function OPTIONS(request: NextRequest) {
  return await yoga.handleRequest(request, { request });
}
