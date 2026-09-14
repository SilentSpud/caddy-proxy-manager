import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { auth, checkSameOrigin } from "@/src/lib/auth";
import { broadcastRestart } from "@/src/lib/agent/registry";
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
 *
 * Every attached agent is asked to do the same, restarting its Caddy first. That does go through
 * Docker, on the agent's side, which is the side that already has it.
 */

/** Sent by the migration screen; the value is the single-use token the migrate response issued. */
const RESTART_TOKEN_HEADER = "x-cpm-restart-token";

export async function POST(request: NextRequest): Promise<Response> {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  if (await isSetupCompleted()) {
    const t = await getTranslations("setup");
    return Response.json({ ok: false, error: t("errors.alreadyCompleted") }, { status: 409 });
  }
  if (!(await getMigrationSource())) {
    const t = await getTranslations("setup");
    return Response.json({ ok: false, error: t("migrateErrors.nothingMigrated") }, { status: 409 });
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
        { ok: false, error: (await getTranslations("setup"))("restartNotPermitted") },
        { status: 401 },
      );
    }
  }

  // Even a permitted caller gets one restart a minute, so nothing can hold the process in a loop.
  const slot = await claimRestartSlot();
  if (!slot.ok) {
    return Response.json(
      { ok: false, error: (await getTranslations("setup"))("restartTooSoon") },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(slot.retryAfterMs / 1000)) },
      },
    );
  }

  // The agents and their Caddys restart too, asked before this process schedules its own exit so
  // the frame is on the stream while there is still a stream. An agent paired against the empty
  // database, and a Caddy configured from it, are as stale as this process is; both come back to a
  // controller that answers from the imported one.
  const asked = broadcastRestart("the controller migrated its database and is restarting");
  if (asked > 0) {
    console.log(`Asked ${asked} agent(s) to restart Caddy and themselves after the migration`);
  }

  scheduleProcessRestart(
    "Restarting after a migration, so the app runs from the database it imported",
  );

  return Response.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
