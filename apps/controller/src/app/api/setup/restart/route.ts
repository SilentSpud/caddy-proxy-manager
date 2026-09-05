import { getMigrationSource, isSetupCompleted } from "@/src/lib/setup";

/**
 * POST /api/setup/restart — stop the process so the supervisor starts it again.
 *
 * A migration writes the database underneath a process that has already read from it. Settings are
 * resolved into a cache, the enabled OAuth providers were listed at startup, the environment
 * backfill has already decided what this deployment looks like — all of it decided against the
 * empty database that existed a moment ago. Signing in against that is how an operator ends up
 * looking at a dashboard that has their proxy hosts but none of their settings, with nothing to
 * suggest a restart would fix it.
 *
 * So the process exits and comes back reading the database it now has. Nothing here talks to
 * Docker: the container's own `restart: unless-stopped` is what brings it back, which needs no
 * socket, no agent and no privilege this process does not already hold. A deployment running
 * without a supervisor does not come back — the setup screen watches for exactly that and says so,
 * rather than leaving the operator on a page that never loads.
 */

/**
 * Long enough for the response to reach the browser, short enough that the operator is not left
 * watching a modal that has not started doing anything.
 */
const EXIT_DELAY_MS = 750;

export async function POST(): Promise<Response> {
  // The window is "a migration has run and setup is not finished", which is exactly the moment the
  // restart is for. It is deliberately not narrower: an instance in this state is unauthenticated
  // by design — anyone who can reach it can complete its setup and own it outright — so being able
  // to restart it as well is not a door this opens.
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

  // Scheduled rather than immediate: an exit inside the handler closes the socket before the reply
  // is written, and a browser cannot tell that apart from the app having crashed.
  setTimeout(() => {
    console.log("Restarting after a migration, so the app runs from the database it imported");
    process.exit(0);
  }, EXIT_DELAY_MS);

  return Response.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
