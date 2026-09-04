import { type Mock, vi as bunVi } from "bun:test";

/**
 * The `vi` object the suite imports, in place of Vitest's. Bun's `bun:test` alias covers
 * fn/spyOn/mock/timers but not `mocked`, `hoisted`, `stubEnv` or `unstubAllEnvs`, and its type
 * cannot be merged declaratively — hence a wrapper. `resetModules` and `doMock` are deliberately
 * absent: Bun cannot drop a module from the registry, so a no-op would leave tests asserting
 * against a cached one.
 */

/** Env vars stubbed since the last unstubAllEnvs(), with their prior values. */
const stubbedEnv = new Map<string, string | undefined>();

function mocked<T extends (...args: never[]) => unknown>(item: T): Mock<T>;
function mocked<T>(item: T): T;
/**
 * Identity at runtime, a cast for the type checker. Bun replaces the module's live bindings in
 * place, so the value already *is* the mock and only the static type needs help.
 */
function mocked(item: unknown): unknown {
  return item;
}

/**
 * Runs `factory` immediately and returns its value. Bun does not hoist `vi.mock`, so the only rule
 * left is to declare this above the `vi.mock` that uses it.
 */
function hoisted<T>(factory: () => T): T {
  return factory();
}

/**
 * Sets an environment variable for the duration of the test file, remembering what was there
 * before. Passing `undefined` unsets the variable, matching Vitest.
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

/**
 * Polls `check` until it stops throwing (and stops returning a rejected promise), matching
 * Vitest's `vi.waitFor`. Bun has no equivalent, and a fixed sleep would either be flaky or slow.
 */
async function waitFor<T>(
  check: () => T | Promise<T>,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const { timeout = 1000, interval = 10 } = options;
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export const vi = {
  ...bunVi,
  mocked,
  hoisted,
  stubEnv,
  unstubAllEnvs,
  waitFor,
};
