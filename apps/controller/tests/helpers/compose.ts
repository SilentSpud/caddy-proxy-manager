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
