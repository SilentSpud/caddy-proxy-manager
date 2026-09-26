/**
 * The controller's API routes, answered in the browser for whichever demo needs them.
 *
 * The components call the global `fetch` for `/api/...` paths the documentation site does not
 * have, so without this each such call is a 404 in the reader's console. `fetch` is wrapped once,
 * at import rather than in an effect: a child's effect runs before its parent's, so a component
 * fetching on mount would otherwise go out before the demo around it had installed anything. Only
 * same-origin requests a handler claims are answered; everything else reaches the network.
 */

/** Answers a request, or returns null to leave it to the next handler and then the network. */
export type ApiHandler = (url: URL, init: RequestInit | undefined) => Promise<Response | null>;

const handlers = new Set<ApiHandler>();

if (typeof window !== "undefined") {
  const realFetch = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin === location.origin) {
      for (const handler of handlers) {
        const answer = await handler(url, init);
        if (answer) return answer;
      }
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

/** Answer requests with `handler` until the returned function is called. */
export function serveApi(handler: ApiHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** A JSON response, as the route handlers send one. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
