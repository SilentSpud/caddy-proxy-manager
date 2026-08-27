/**
 * Bun is the only supported runtime for this application.
 *
 * The database layer imports `bun:sqlite`, a Bun built-in with no Node.js
 * equivalent, and the Docker image starts the server with `bun server.js`.
 * Under Node.js the process instead dies while linking the module graph, on an
 * unsupported `bun:` URL scheme deep inside an import chain — which reads as a
 * packaging bug rather than the wrong interpreter. Say so plainly instead, and
 * say what to run.
 */

/** `{runtime}` is filled in by describeRuntime() at the point of failure. */
export const BUN_REQUIRED_MESSAGE = [
  "Caddy Proxy Manager requires the Bun runtime, but this process is running under {runtime}.",
  "",
  "Start it with Bun instead:",
  "  bun server.js   (production / standalone build)",
  "  bun run dev     (development)",
  "",
  "Install Bun from https://bun.sh, or use the published Docker image, which already runs Bun.",
].join("\n");

/** Names the current runtime for the error message. */
export function describeRuntime(): string {
  return process.versions.node ? `Node.js ${process.versions.node}` : "an unknown runtime";
}

/**
 * Aborts unless the process is running under Bun.
 *
 * This covers the paths where application code gets to run at all — `vinext
 * dev`, and any entry that reaches the instrumentation hook. The standalone
 * build fails earlier than this, while its module graph is still linking, so
 * scripts/inject-runtime-guard.mjs plants an equivalent check at the top of the
 * generated dist/standalone/server.js as part of `bun run build`.
 *
 * `exit` is injected so the check can be tested without killing the test
 * runner; production callers use the default.
 */
export function assertBunRuntime(exit: (code: number) => never = process.exit): void {
  if (process.versions.bun) {
    return;
  }
  console.error(BUN_REQUIRED_MESSAGE.replace("{runtime}", describeRuntime()));
  exit(1);
}
