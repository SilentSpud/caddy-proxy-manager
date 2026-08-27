/**
 * Entry point for the compiled, distributable server binary.
 *
 * `vinext build` also emits its own `dist/standalone/server.js`, but that file
 * cannot be the compile entry: it locates the build output with
 * `import.meta.dirname`, and `bun build --compile` freezes that to the directory
 * the entry was compiled *from*. The binary would then look for `dist/` at the
 * build machine's path — which happens to work when the build and runtime
 * directories coincide, and silently breaks the moment they do not. This entry
 * resolves the same directory from `process.execPath`, which a compiled binary
 * reports as its own location on disk at runtime.
 *
 * The application bundle is not part of the compiled graph: vinext imports it
 * from disk at runtime (see docker/web/Dockerfile for what the image must
 * therefore ship alongside the binary).
 */
import { dirname, join } from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

/** Directory holding the build output (`dist/`) and its runtime dependencies. */
function resolveAppRoot(): string {
  return process.env.CPM_APP_ROOT?.trim() || dirname(process.execPath);
}

/**
 * `--healthcheck` mode, used by the container HEALTHCHECK.
 *
 * The runtime image has no shell HTTP client and no Bun CLI, so the binary
 * probes itself rather than adding curl (or a `node -e` line, which only ever
 * worked because `node` is a symlink to `bun` in the oven/bun images).
 */
function runHealthCheck(): void {
  const url = process.env.CPM_HEALTHCHECK_URL ?? `http://127.0.0.1:${port}/api/health`;
  fetch(url, { signal: AbortSignal.timeout(5_000) })
    .then((response) => process.exit(response.ok ? 0 : 1))
    .catch(() => process.exit(1));
}

if (process.argv.includes("--healthcheck")) {
  runHealthCheck();
} else {
  startProdServer({ port, host, outDir: join(resolveAppRoot(), "dist") }).catch((error) => {
    console.error("[cpm] Failed to start the server");
    console.error(error);
    process.exit(1);
  });
}
