/**
 * Entry point for the compiled server binary. `vinext build` emits its own
 * dist/standalone/server.js, but that cannot be the compile entry: it locates the build output with
 * `import.meta.dirname`, which `bun build --compile` freezes to the build machine's path. This uses
 * `process.execPath` instead. The app bundle stays outside the compiled graph, read from disk.
 */
import { dirname, join } from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
// `::` rather than `0.0.0.0`: a dual-stack socket accepts IPv4 too, so this binds both families,
// while 0.0.0.0 binds only one and leaves an IPv6-only client with nothing to connect to.
const host = process.env.HOST ?? "::";

/** Directory holding the build output (`dist/`) and its runtime dependencies. */
function resolveAppRoot(): string {
  return process.env.CPM_APP_ROOT?.trim() || dirname(process.execPath);
}

/** `--healthcheck` for the container HEALTHCHECK — no curl in the image, so it self-probes. */
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
