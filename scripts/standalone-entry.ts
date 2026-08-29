/**
 * Entry point for the compiled server binary. `vinext build` emits its own
 * dist/standalone/server.js, but that cannot be the compile entry: it locates the build output
 * with `import.meta.dirname`, which `bun build --compile` freezes to the build machine's path.
 * This resolves the same directory from `process.execPath` instead. The application bundle stays
 * outside the compiled graph — vinext imports it from disk at runtime (see docker/web/Dockerfile).
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
 * `--healthcheck` mode for the container HEALTHCHECK. The runtime image has no shell HTTP client
 * and no Bun CLI, so the binary probes itself rather than adding curl.
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
