import { randomUUID } from "node:crypto";

export type CaddyApplyErrorCode =
  | "CADDY_REJECTED"
  | "CADDY_UNREACHABLE"
  | "CADDY_REQUEST_FAILED"
  | "INSTANCE_SYNC_FAILED";

export class CaddyApplyError extends Error {
  readonly code: CaddyApplyErrorCode;

  constructor(message: string, code: CaddyApplyErrorCode) {
    super(message);
    this.name = "CaddyApplyError";
    this.code = code;
  }
}

export function safeSystemErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_-]{1,64}$/.test(code)
    ? code
    : null;
}

/** Log diagnostic metadata without exception messages, response bodies, URLs, or stacks. */
export function logCaddyApplyFailure(
  context: string,
  error?: unknown,
  metadata: Record<string, number | boolean | null> = {}
): string {
  const errorId = randomUUID();
  const code = safeSystemErrorCode(error);
  const rawType = error instanceof Error ? error.name : typeof error;
  const errorType = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawType)
    ? rawType
    : error instanceof Error ? "Error" : "unknown";
  console.error("Caddy apply failure", {
    errorId,
    context,
    errorType,
    ...(code ? { code } : {}),
    ...metadata,
  });
  return errorId;
}
