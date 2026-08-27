let counter = 0;

/**
 * A unique query-string suffix that forces the next `import()` of a module to
 * re-evaluate it from scratch.
 *
 * Vitest offered `vi.resetModules()`, which emptied the module registry so the
 * next import re-ran the module body — the way a test reads a module that
 * snapshots `process.env` at import time under several different environments.
 * Bun has no way to drop a module from its registry, but it keys the registry
 * by the full specifier, so a distinct query string is a distinct module.
 *
 * Build the specifier in the test file itself, never in a helper: a dynamic
 * import resolves relative to the file that writes it.
 *
 *     const { config } = await import(`../../src/lib/config${fresh()}`);
 *
 * Each call returns a suffix that has never been used before in this process,
 * so a caller never has to track its own counter.
 */
export function fresh(): string {
  return `?fresh=${++counter}`;
}
