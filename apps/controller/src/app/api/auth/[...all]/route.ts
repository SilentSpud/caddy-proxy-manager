import { getAuth } from "@/src/lib/auth-server";
import { toNextJsHandler } from "better-auth/next-js";
import { getTranslations } from "next-intl/server";
import { CLIENT_IP_HEADER, getClientIp } from "@/src/lib/client-ip";
import {
  accountKey,
  accountRetryAfterMs,
  registerAccountFailure,
  resetAccountFailures,
} from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

const PASSWORD_SIGN_IN_PATHS = new Set(["/api/auth/sign-in/username", "/api/auth/sign-in/email"]);

/** better-auth keys its rate limiter on CLIENT_IP_HEADER alone, so a client-sent copy is replaced. */
async function withClientIp(request: Request): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = await getClientIp(request.headers);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  // Rebuilt from the URL: Bun's `new Request(request, { headers })` keeps a header the init omits.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    signal: request.signal,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

async function signInAccount(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { username?: unknown; email?: unknown };
    const name = typeof body.username === "string" ? body.username : body.email;
    return typeof name === "string" && name.trim() ? accountKey(name) : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  return toNextJsHandler(await getAuth()).GET(await withClientIp(request));
}

export async function POST(request: Request) {
  const forwarded = await withClientIp(request);
  if (!PASSWORD_SIGN_IN_PATHS.has(new URL(request.url).pathname)) {
    return toNextJsHandler(await getAuth()).POST(forwarded);
  }

  // Shares its counter with the forward-auth portal, whatever address the guesses come from.
  const account = await signInAccount(forwarded.clone());
  const retryAfterMs = account ? accountRetryAfterMs(account) : 0;
  if (retryAfterMs > 0) {
    const t = await getTranslations("auth.apiErrors");
    return Response.json(
      { code: "TOO_MANY_REQUESTS", message: t("tooManyLoginAttempts") },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const response = await toNextJsHandler(await getAuth()).POST(forwarded);
  if (account) {
    if (response.status === 401) registerAccountFailure(account);
    else if (response.ok) resetAccountFailures(account);
  }
  return response;
}
