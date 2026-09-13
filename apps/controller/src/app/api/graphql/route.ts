/**
 * The GraphQL endpoint.
 *
 * One URL for the whole API, plus the agent protocol's subscription - see
 * `src/lib/graphql/agent.ts` for why the agent lives in the same schema rather than a second one.
 *
 * GraphiQL is served in development only. In production it would be an unauthenticated HTML page
 * advertising the shape of every mutation on the box. For the same reason introspection answers
 * only a caller who authenticates, which is what a real GraphQL client needs.
 */

import { createYoga } from "graphql-yoga";
import type { NextRequest } from "next/server";
import { createContext } from "@/src/lib/graphql/context";
import { authenticatedIntrospectionPlugin, maskGraphQLError } from "@/src/lib/graphql/errors";
import { schema } from "@/src/lib/graphql/schema";

type ServerContext = { request: NextRequest; rawBody: () => Promise<string> };

const yoga = createYoga<ServerContext>({
  schema,
  graphqlEndpoint: "/api/graphql",
  // Yoga would otherwise answer with its own Response type; Next needs the fetch one, which is
  // what `fetchAPI` pins.
  fetchAPI: { Response },
  graphiql: process.env.NODE_ENV === "development",
  // Same-origin only. Yoga's default reflects any Origin with credentials allowed, leaving a
  // per-field check as the only thing between another site and the reader's session.
  cors: false,
  plugins: [authenticatedIntrospectionPlugin()],
  context: ({ request, rawBody }) => createContext(request as NextRequest, rawBody),
  // Deliberate refusals go out as written, so "domain already in use" survives; anything else is
  // logged and replaced, as REST's apiErrorResponse does.
  maskedErrors: {
    maskError: maskGraphQLError,
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
