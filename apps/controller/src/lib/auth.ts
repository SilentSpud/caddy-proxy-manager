import { type NextRequest, NextResponse } from "next/server";
import { getAuth } from "./auth-server";
import { getUserById } from "./models/user";

export type Session = {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    provider?: string;
    image?: string | null;
  };
};

/**
 * The current session, or null. `auth()` reads next/headers, `auth(req)` request headers. Role is
 * fetched fresh from the DB, so a demotion takes effect immediately.
 */
export async function auth(req?: NextRequest): Promise<Session | null> {
  const hdrs = req ? req.headers : (await import("next/headers")).headers();

  // headers() in Next.js 15+ returns a Promise
  const resolvedHeaders = hdrs instanceof Promise ? await hdrs : hdrs;

  // biome-ignore lint/suspicious/noExplicitAny: shape comes from better-auth's runtime-configured instance and is narrowed by the checks below
  let betterAuthSession: any;
  try {
    betterAuthSession = await (await getAuth()).api.getSession({
      headers: resolvedHeaders,
    });
  } catch {
    return null;
  }

  if (!betterAuthSession?.user) {
    return null;
  }

  const baUser = betterAuthSession.user as {
    id: string | number;
    name?: string | null;
    email: string;
    image?: string | null;
    role?: string;
    provider?: string;
    status?: string;
    avatarUrl?: string | null;
    subject?: string;
  };
  const userId = typeof baUser.id === "string" ? Number(baUser.id) : baUser.id;

  // Always fetch role/status from the database so changes take effect immediately
  const currentUser = await getUserById(userId);
  if (currentUser?.status !== "active") {
    return null;
  }

  return {
    user: {
      id: String(currentUser.id),
      email: currentUser.email,
      name: currentUser.name,
      role: currentUser.role,
      provider: currentUser.provider || baUser.provider,
      image: currentUser.avatarUrl ?? (baUser.avatarUrl as string | null | undefined) ?? null,
    },
  };
}

/** Alias for auth() — get the current session on the server. */
export async function getSession(): Promise<Session | null> {
  return auth();
}

/**
 * The DB id of the caller's better-auth session, or null without cookie auth. Marks the "current"
 * session and excludes it from "revoke other sessions".
 */
export async function getCurrentSessionId(req?: NextRequest): Promise<number | null> {
  const hdrs = req ? req.headers : (await import("next/headers")).headers();
  const resolvedHeaders = hdrs instanceof Promise ? await hdrs : hdrs;
  try {
    const result = await (await getAuth()).api.getSession({ headers: resolvedHeaders });
    const id = result?.session?.id;
    return id != null ? Number(id) : null;
  } catch {
    return null;
  }
}

/** Require authentication. Redirects to /login if not authenticated. */
export async function requireUser(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
    throw new Error("Redirecting to login"); // TypeScript doesn't know redirect() never returns
  }
  return session;
}

/** Require admin privileges. Throws if not authenticated or not admin. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (session.user.role !== "admin") {
    throw new Error("Administrator privileges required");
  }
  return session;
}

/**
 * Defense-in-depth CSRF check: 403 when Origin is present and mismatches Host, else null.
 * Browsers always send Origin cross-origin.
 */
export function checkSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  // Mutating requests must carry Origin; browsers always send it on cross-origin POST/PUT/DELETE
  const method = request.method.toUpperCase();
  const isMutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!origin) {
    // Allow non-mutating requests without Origin (normal browser behavior)
    if (!isMutating) return null;
    // For mutating requests, require Origin header
    return NextResponse.json({ error: "Forbidden: Origin header required" }, { status: 403 });
  }

  const host = request.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return null;
  } catch {
    // unparseable origin — treat as mismatch
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
