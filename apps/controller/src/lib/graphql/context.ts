/**
 * Who is asking, resolved once per GraphQL request.
 *
 * The same two credentials `/api/v1/` accepts: a Bearer API token, or the dashboard session. Both
 * go through `authenticateApiRequest`, so a token's role means exactly what it means over REST and
 * there is no second answer to keep in step.
 *
 * **CSRF is the one place GraphQL cannot copy REST.** The REST helper only same-origin-checks a
 * session request when the method mutates, which works because REST puts the verb in the method.
 * Every GraphQL request is a POST, and whether it mutates is inside the document — so a session
 * request is checked unconditionally. A cross-origin page can still send a Bearer token it already
 * has, which is not CSRF; what it must not do is ride the reader's cookie.
 */

import type { NextRequest } from "next/server";
import { type ApiAuthResult, ApiAuthError, authenticateApiRequest } from "../api-auth";
import { checkSameOrigin } from "../auth";
import { type Access, accessFor } from "../permissions";

export type GraphQLContext = {
  /** Null until something asks. Authentication failures are per-field, not per-request. */
  viewer: () => Promise<ApiAuthResult>;
  /** The grant-aware view of the same viewer, for the resources grants apply to. */
  access: () => Promise<Access>;
  /**
   * The request body exactly as it arrived, for the agent's signature check.
   *
   * Captured by the route *before* the GraphQL server reads the request, not here. A clone has to
   * be taken while the body is still untouched: asking for one afterwards throws "Body is
   * disturbed or locked", which is a resolver-time failure that no test driving the schema
   * directly can reproduce. Re-serialising the parsed document would not do either — the signature
   * covers the bytes the agent sent, and a round trip can change key order or spacing.
   */
  rawBody: () => Promise<string>;
  request: NextRequest;
};

/**
 * Build the context.
 *
 * Authentication is a thunk rather than eager work: it is a token lookup or a session read, and a
 * request that turns out to be malformed should not pay for it. Both thunks memoise, so a document
 * touching twenty fields authenticates once.
 */
export function createContext(
  request: NextRequest,
  rawBody: () => Promise<string>,
): GraphQLContext {
  let viewerPromise: Promise<ApiAuthResult> | null = null;
  let accessPromise: Promise<Access> | null = null;

  const viewer = () => {
    viewerPromise ??= (async () => {
      const result = await authenticateApiRequest(request);
      if (result.authMethod === "session" && checkSameOrigin(request)) {
        throw new ApiAuthError("Forbidden", 403);
      }
      return result;
    })();
    return viewerPromise;
  };

  const access = () => {
    accessPromise ??= (async () => {
      const result = await viewer();
      return await accessFor(result.userId, result.role);
    })();
    return accessPromise;
  };

  return { viewer, access, rawBody, request };
}

/** Resolve the viewer, or fail the field. */
export async function requireUser(context: GraphQLContext): Promise<ApiAuthResult> {
  return await context.viewer();
}

/**
 * Resolve the viewer and insist on an administrator.
 *
 * The same bar `/api/v1/` sets: management is admin-only, and a group grant delegates the dashboard
 * rather than the API. An operator's token therefore reaches exactly what a user's does, which is
 * the rule the REST layer already documents.
 */
export async function requireAdmin(context: GraphQLContext): Promise<ApiAuthResult> {
  const result = await context.viewer();
  if (result.role !== "admin") {
    throw new ApiAuthError("Administrator privileges required", 403);
  }
  return result;
}
