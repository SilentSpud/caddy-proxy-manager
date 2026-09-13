import type { NextRequest } from "next/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { scheduleProcessRestart } from "@/src/lib/process-restart";
import {
  claimRestartSlot,
  consumeRestartToken,
  getMigrationSource,
  hasAnySignIn,
  isSetupCompleted,
} from "@/src/lib/setup";

/**
 * POST /api/setup/restart - stop the process so the supervisor starts it again.
 *
 * A migration writes the database underneath a process that has already read from it. Settings are
 * resolved into a cache, the enabled OAuth providers were listed at startup, the environment
 * backfill has already decided what this deployment looks like - all of it decided against the
 * empty database that existed a moment ago. Signing in against that is how an operator ends up
 * looking at a dashboard that has their proxy hosts but none of their settings, with nothing to
 * suggest a restart would fix it.
 *
 * So the process exits and comes back reading the database it now has. Nothing here talks to
 * Docker: the container's own `restart: unless-stopped` is what brings it back, which needs no
 * socket, no agent and no privilege this process does not already hold. A deployment running
 * without a supervisor does not come back - the setup screen watches for exactly that and says so,
 * rather than leaving the operator on a page that never loads.
 */

/** Sent by the migration screen; the value is the single-use token the migrate response issued. */
const RESTART_TOKEN_HEADER = "x-cpm-restart-token";

export async function POST(request: NextRequest): Promise<Response> {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  if (await isSetupCompleted()) {
    return Response.json(
      { ok: false, error: "Setup has already been completed." },
      { status: 409 },
    );
  }
  if (!(await getMigrationSource())) {
    return Response.json(
      { ok: false, error: "Nothing has been migrated on this instance." },
      { status: 409 },
    );
  }

  // Before anything can sign in, the instance is unauthenticated by design - whoever reaches it can
  // finish setup and own it. An import that brought accounts or an enabled provider ends that, and
  // with it an open door to stopping the process: only the browser that ran the import, holding
  // its token, or an administrator may ask.
  if (await hasAnySignIn()) {
    const permitted =
      (await consumeRestartToken(request.headers.get(RESTART_TOKEN_HEADER))) ||
      (await auth(request))?.user.role === "admin";
    if (!permitted) {
      return Response.json(
        { ok: false, error: "Sign in as an administrator to restart the application." },
        { status: 401 },
      );
    }
  }

  // Even a permitted caller gets one restart a minute, so nothing can hold the process in a loop.
  const slot = await claimRestartSlot();
  if (!slot.ok) {
    return Response.json(
      { ok: false, error: "A restart was requested moments ago. Wait for it to finish." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(slot.retryAfterMs / 1000)) },
      },
    );
  }

  scheduleProcessRestart(
    "Restarting after a migration, so the app runs from the database it imported",
  );

  return Response.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
