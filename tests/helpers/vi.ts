import { type Mock, vi as bunVi } from 'bun:test';

/**
 * The `vi` object the suite imports, in place of Vitest's.
 *
 * Bun ships a `vi` alias in `bun:test` covering fn/spyOn/mock/timers and the
 * reset helpers, but not `mocked`, `hoisted`, `stubEnv` or `unstubAllEnvs`.
 * Bun's own `vi` is declared as an anonymous object type on a `const`, so those
 * cannot be merged into it declaratively — hence a wrapper rather than a
 * mutation of the imported object.
 *
 * `mock` is passed through by reference and keeps resolving specifiers relative
 * to the file that calls it, not to this one, so `vi.mock('../../src/lib/db')`
 * from a test means the same module it did under Vitest.
 *
 * Deliberately absent: `resetModules` and `doMock`. Bun has no way to drop a
 * module from the registry, so a silent no-op would leave the affected tests
 * asserting against a module cached from their first import. The four suites
 * that relied on module resets read their environment through an injectable
 * seam instead — see tests/unit/config-app-name.test.ts.
 */

/** Env vars stubbed since the last unstubAllEnvs(), with their prior values. */
const stubbedEnv = new Map<string, string | undefined>();

function mocked<T extends (...args: never[]) => unknown>(item: T): Mock<T>;
function mocked<T>(item: T): T;
/**
 * Identity at runtime, a cast for the type checker.
 *
 * Under Vitest this narrowed a statically-typed import to its mocked shape.
 * Bun replaces the module's live bindings in place, so the value already *is*
 * the mock; only the static type needs help.
 */
function mocked(item: unknown): unknown {
  return item;
}

/**
 * Runs `factory` immediately and returns its value.
 *
 * Vitest hoisted `vi.mock` calls above the import block, so anything a mock
 * factory closed over had to be hoisted with it. Bun does not hoist: a
 * `vi.mock` call runs where it is written, and it rewrites the live bindings of
 * a module that has already been imported. So the factory just runs in place,
 * and the only rule left is the ordinary one — declare it above the `vi.mock`
 * that uses it.
 */
function hoisted<T>(factory: () => T): T {
  return factory();
}

/**
 * Sets an environment variable for the duration of the test file, remembering
 * what was there before. Passing `undefined` unsets the variable, matching
 * Vitest.
 */
function stubEnv(name: string, value: string | undefined): void {
  if (!stubbedEnv.has(name)) stubbedEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Restores every variable touched by stubEnv() to its pre-stub value. */
function unstubAllEnvs(): void {
  for (const [name, previous] of stubbedEnv) {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  stubbedEnv.clear();
}

export const vi = {
  ...bunVi,
  mocked,
  hoisted,
  stubEnv,
  unstubAllEnvs,
};
