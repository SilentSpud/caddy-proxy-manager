let counter = 0;

/**
 * A unique query-string suffix forcing the next `import()` of a module to re-evaluate it — Bun's
 * substitute for `vi.resetModules()`, since it cannot drop a module from the registry but does key
 * it by full specifier. Build the specifier in the test file, never in a helper: a dynamic import
 * resolves relative to the file that writes it.
 *
 *     const { config } = await import(`../../src/lib/config${fresh()}`);
 */
export function fresh(): string {
  return `?fresh=${++counter}`;
}
