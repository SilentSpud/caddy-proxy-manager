let counter = 0;

/**
 * A unique query-string suffix forcing the next `import()` to re-evaluate a module — Bun's
 * substitute for `vi.resetModules()`, since it keys the registry by full specifier. Build the
 * specifier in the test file, never a helper: a dynamic import resolves relative to its writer.
 *
 *     const { config } = await import(`../../src/lib/config${fresh()}`);
 */
export function fresh(): string {
  return `?fresh=${++counter}`;
}
