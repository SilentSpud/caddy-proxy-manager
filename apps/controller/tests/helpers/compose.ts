/**
 * The single definition of how the end-to-end stack is addressed on the docker CLI.
 *
 * This lived as six copies — two global setups, two teardowns, container-health.spec.ts and
 * seed.ts — and they drifted the moment one of them changed: adding `--env-file` to four left the
 * other two still reading whatever .env the developer happened to have.
 *
 * `--env-file` REPLACES the repo-root .env rather than layering onto it, so the suite behaves the
 * same with or without one, and the same on CI, which has none. tests/e2e.env carries the two
 * variables docker-compose.yml refuses to interpolate without; the values services actually run
 * with come from tests/docker-compose.test.yml.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every docker command runs from here, not from process.cwd(). Compose resolves the relative paths
 * inside a compose file against the *project directory* — the directory of the first `-f` file —
 * so build contexts, bind mounts and `--env-file` all stay anchored to the repo root even though
 * the suite itself now lives under apps/controller.
 */
export const COMPOSE_CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const BASE_ARGS = [
  'compose',
  '--env-file',
  'apps/controller/tests/e2e.env',
  '-f',
  'docker-compose.yml',
  '-f',
  'apps/controller/tests/docker-compose.test.yml',
];

/**
 * One more `-f` when E2E_COMPOSE_EXTRA_FILE names it. CI points this at
 * tests/docker-compose.ci.yml to attach the GitHub Actions layer cache, which cannot simply live
 * in the test override: `type=gha` needs credentials only a runner has, so a developer running the
 * suite would fail on it. Unset everywhere else, which leaves the stack exactly as it was.
 */
const EXTRA_FILE = process.env.E2E_COMPOSE_EXTRA_FILE;

export const COMPOSE_ARGS = EXTRA_FILE ? [...BASE_ARGS, '-f', EXTRA_FILE] : BASE_ARGS;

/**
 * The environment every compose invocation needs, whatever else the caller adds.
 *
 * `caddy` sits behind a profile in docker-compose.yml so a plain `docker compose up` does not
 * start it — an unpaired host must not answer 80 and 443 with a default page. The e2e stack does
 * want it, and more than wants it: `web-registration-enabled` declares `depends_on: caddy`, and
 * compose rejects the *entire project* as invalid when a dependency names a service no active
 * profile defines. So this is not a convenience, it is what makes the project parse at all —
 * without it every command here fails with "depends on undefined service", `down` included.
 *
 * Threaded through this helper rather than set at six call sites for the reason in the file
 * header: they drift. Two of them deliberately run without the clickhouse profile, so what is
 * merged is the union of what the caller asked for and what the project cannot do without.
 */
export function composeEnv(
  // Not NodeJS.ProcessEnv: Bun's typings make NODE_ENV required on it, so every caller would have
  // to restate a variable none of them care about.
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const requested = (extra.COMPOSE_PROFILES ?? '')
    .split(',')
    .map((profile) => profile.trim())
    .filter(Boolean);
  return {
    ...process.env,
    ...extra,
    COMPOSE_PROFILES: [...new Set(['caddy', ...requested])].join(','),
  };
}
