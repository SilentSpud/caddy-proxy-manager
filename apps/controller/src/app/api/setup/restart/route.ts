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
  restartTokenMatches,
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
 * Finishing setup is the same shape: the settings, the gates and the providers were all resolved
 * against a database that had none of them. Coming back is also what applies the Caddy document,
 * which is how a dashboard host created seconds ago starts answering on its domain.
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

/** Sent by the screen that asked for the restart; the value is the single-use token it was issued. */
const RESTART_TOKEN_HEADER = "x-cpm-restart-token";

export async function POST(request: NextRequest): Promise<Response> {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  const afterSetup = await isSetupCompleted();

  // Completed setup is the one state this route stays useful in, and the narrowest: the token the
  // save issued, and nothing else. An admin session is deliberately not enough - it would leave
  // every deployment with a permanent "stop the app" endpoint, which is not what this is for.
  //
  // Checked without being spent, because the cooldown below can still refuse: a deployment that
  // migrated and then finished setup inside a minute would otherwise lose its one token to a
  // "not yet" and have no way to ask again.
  const token = request.headers.get(RESTART_TOKEN_HEADER);
  if (afterSetup) {
    if (!(await restartTokenMatches(token))) {
      const t = await getTranslations("setup");
      return Response.json({ ok: false, error: t("errors.alreadyCompleted") }, { status: 409 });
    }
  } else {
    if (!(await getMigrationSource())) {
      const t = await getTranslations("setup");
      return Response.json(
        { ok: false, error: t("migrateErrors.nothingMigrated") },
        { status: 409 },
      );
    }

    // Before anything can sign in, the instance is unauthenticated by design - whoever reaches it
    // can finish setup and own it. An import that brought accounts or an enabled provider ends
    // that, and with it an open door to stopping the process: only the browser that ran the
    // import, holding its token, or an administrator may ask.
    if (await hasAnySignIn()) {
      const permitted =
        (await consumeRestartToken(token)) || (await auth(request))?.user.role === "admin";
      if (!permitted) {
        return Response.json(
          { ok: false, error: (await getTranslations("setup"))("restartNotPermitted") },
          { status: 401 },
        );
      }
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

  // Spent now that the restart is going ahead. Losing the race means another request already has
  // it, and two processes exiting for the same token is exactly what the token prevents.
  if (afterSetup && !(await consumeRestartToken(token))) {
    const t = await getTranslations("setup");
    return Response.json({ ok: false, error: t("errors.alreadyCompleted") }, { status: 409 });
  }

  // The agents and their Caddys restart too, asked before this process schedules its own exit so
  // the frame is on the stream while there is still a stream. An agent paired against the empty
  // database, and a Caddy configured from it, are as stale as this process is; both come back to a
  // controller that answers from the database it now has.
  const why = afterSetup ? "finished its setup" : "migrated its database";
  const asked = broadcastRestart(`the controller ${why} and is restarting`);
  if (asked > 0) {
    console.log(`Asked ${asked} agent(s) to restart Caddy and themselves: the controller ${why}`);
  }

  scheduleProcessRestart(
    afterSetup
      ? "Restarting after setup, so the app runs from the configuration it just stored"
      : "Restarting after a migration, so the app runs from the database it imported",
  );

  return Response.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
