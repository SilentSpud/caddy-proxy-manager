/**
 * What to tell a migrated deployment to do with the `.env` it still has.
 *
 * The app cannot see that file. Its environment arrives from Compose, from Swarm or Kubernetes
 * secrets, from a systemd unit — the file, where there is one, sits on the host beside
 * `docker-compose.yml` and never enters the container. So rather than rewriting it, this produces
 * the command that does: one `sed` the operator runs where the file actually is, which comments
 * out exactly the variables that moved into the database.
 *
 * Commented rather than deleted, and with a `.bak` alongside: the values are the only copy of some
 * secrets an operator has, and a cleanup step that erased them would be a poor trade for tidiness.
 *
 * The variables Compose reads are held back from that command, because removing them is a two-step
 * change it cannot make on its own. On a deployment with no agent they cannot go at all: Compose is
 * the only thing that can start the containers they provision, and it cannot read the database.
 * With an agent they can, but only alongside dropping those services from `COMPOSE_PROFILES` —
 * otherwise the operator's own `docker compose up -d` keeps recreating the container from the
 * values it just commented out. Both cases are explained where they are listed.
 */
import { SETTINGS_BY_ENV } from "../settings/registry";

export type EnvCleanup = {
  /** Migrated variables that are now dead weight in the file, in registry order. */
  comment: string[];
  /** Migrated variables Compose still reads, which have to stay whatever the database holds. */
  keep: string[];
  /** A shell command commenting out `comment` in place, or `null` when there is nothing to do. */
  command: string | null;
};

/**
 * Split the migrated variables into the ones that can go and the ones that cannot, and build the
 * command for the first group.
 *
 * `stored` is the set of environment variable names whose settings now have a value in the
 * database — anything else is either still resolving from the environment or was never a setting,
 * and in both cases the line has to stay.
 */
export function planEnvCleanup(stored: Iterable<string>): EnvCleanup {
  const migrated = new Set(stored);
  const comment: string[] = [];
  const keep: string[] = [];

  // Iterated over the registry rather than over `stored` so the order is the one the settings page
  // uses, and so a name that is not a setting at all cannot reach the generated command.
  for (const [env, definition] of SETTINGS_BY_ENV) {
    if (!migrated.has(env)) continue;
    (definition.composeReads ? keep : comment).push(env);
  }

  return { comment, keep, command: comment.length > 0 ? buildCommand(comment) : null };
}

/**
 * The `sed` itself.
 *
 * POSIX ERE and `-i.bak` with the suffix attached, which is the one spelling of in-place editing
 * that GNU sed and the BSD sed on macOS both accept. `[[:space:]]` rather than `\s` for the same
 * reason. Matching from the start of the line means an already-commented assignment is left alone,
 * so running it twice changes nothing the second time.
 */
function buildCommand(names: readonly string[]): string {
  return [
    `migrated='${names.join("|")}'`,
    `sed -i.bak -E "s/^([[:space:]]*)((export[[:space:]]+)?(\${migrated})[[:space:]]*=)/\\1# migrated to the database: \\2/" .env`,
  ].join("\n");
}
