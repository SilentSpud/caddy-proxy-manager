/**
 * The GraphQL endpoint.
 *
 * One URL for the whole API, plus the agent protocol's subscription - see
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

type ServerContext = { request: NextRequest; rawBody: () => Promise<string> };

const yoga = createYoga<ServerContext>({
  schema,
  graphqlEndpoint: "/api/graphql",
  // Yoga would otherwise answer with its own Response type; Next needs the fetch one, which is
  // what `fetchAPI` pins.
  fetchAPI: { Response },
  graphiql: process.env.NODE_ENV === "development",
  context: ({ request, rawBody }) => createContext(request as NextRequest, rawBody),
  // Errors are already shaped by the model layer and `api-errors`. Yoga masking them would turn a
  // "domain already in use" into "Unexpected error", which is worse than useless to a client.
  maskedErrors: {
    maskError: (error) => error as Error,
  },
});

/**
 * Capture the body before Yoga touches it.
 *
 * The agent signs the bytes it sent, so verifying its signature needs those bytes - and a clone
 * can only be taken while the body is still untouched. Yoga reads it to parse the document, and a
 * clone attempted after that throws "Body is disturbed or locked" from inside the resolver, where
 * it surfaces as a failed subscription rather than as an obvious error.
 *
 * Memoised and lazy: the promise is created here, but the read only happens if a resolver asks,
 * which is only ever the agent's fields.
 */
function bodyReader(request: NextRequest): () => Promise<string> {
  const clone = request.clone();
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= clone.text().catch(() => "");
    return pending;
  };
}

async function handle(request: NextRequest) {
  return await yoga.handleRequest(request, { request, rawBody: bodyReader(request) });
}

export async function GET(request: NextRequest) {
  return await handle(request);
}

export async function POST(request: NextRequest) {
  return await handle(request);
}

export async function OPTIONS(request: NextRequest) {
  return await handle(request);
}
