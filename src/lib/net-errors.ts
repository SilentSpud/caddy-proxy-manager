/**
 * Recognising "the other end was not reachable" across runtimes.
 *
 * Bun 1.4 changed what `fetch()` rejects with: a network failure is now a
 * `TypeError` carrying the error code directly on `.code`, with no `.cause` at
 * all. Before, the code lived on `.cause.code` in the Node shape, so a check
 * written as `err.cause.code === "ECONNREFUSED"` silently stopped matching —
 * the code is still there, one level up and under a different name.
 *
 * The names differ too. A refused TCP connection reports `ConnectionRefused`
 * under Bun and `ECONNREFUSED` under Node; DNS failures report `ENOTFOUND` in
 * both. Rather than pick one, match the union, and walk `.cause` anyway for
 * errors that libraries wrap (the ClickHouse client is one).
 *
 * The message is matched as well as the code, because a wrapper often keeps
 * only the text: the ClickHouse client rejects with a bare object whose cause
 * carries the original message and no code at all.
 */

/** Codes meaning "could not open a connection to the host". */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED", // Node, and Bun for some socket paths
  "ConnectionRefused", // Bun's fetch()
  "FailedToOpenSocket", // Bun, connection could not be established at all
  "ENOTFOUND", // DNS lookup failed
  "EAI_AGAIN", // DNS lookup failed, temporarily
  "ECONNRESET", // peer closed mid-handshake
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

/**
 * Message fragments the runtimes use when no code survives the wrapping.
 *
 * Kept narrow enough that an application-level failure — a bad query, a 500
 * from the server — cannot match one by accident.
 */
const CONNECTION_ERROR_MESSAGES = [
  "ECONNREFUSED",
  "FailedToOpenSocket",
  "ENOTFOUND",
  "Unable to connect", // Bun 1.4: "Unable to connect. Is the computer able to access the url?"
  "Was there a typo in the url or port?", // Bun, older phrasing
];

/** Reads an error's `code`, whatever its declared type. */
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * True when `error` — or anything it wraps — is a failure to reach the host.
 *
 * `depth` bounds the `.cause` walk so a self-referential or deeply nested chain
 * cannot spin.
 */
export function isConnectionError(error: unknown, depth = 4): boolean {
  if (!error || typeof error !== "object" || depth < 0) return false;

  const code = errorCode(error);
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;

  if (error instanceof Error && CONNECTION_ERROR_MESSAGES.some((m) => error.message.includes(m))) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error && isConnectionError(cause, depth - 1)) return true;

  return false;
}
