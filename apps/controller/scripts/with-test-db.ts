/**
 * Runs a command with TEST_POSTGRES_URL pointing at a PostgreSQL the suite may do anything to.
 *
 *   bun scripts/with-test-db.ts bun test tests/unit
 *
 * The controller dropped SQLite, so there is no in-process database left to test against and the
 * suite needs a real server. Starting one here rather than asking for it keeps `bun run test`
 * working on a fresh clone — the same bargain the e2e suite already makes, and Docker is already
 * required for that.
 *
 * An externally supplied TEST_POSTGRES_URL wins and nothing is started: that is how CI runs, where
 * the server is a service container, and how a developer points the suite at their own.
 */
import { SQL } from "bun";

const IMAGE = "postgres:17-alpine";
const CONTAINER = `cpm-test-db-${process.pid}`;
const PASSWORD = "cpm-test";
const READY_TIMEOUT_MS = 60_000;

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: bun scripts/with-test-db.ts <command> [args...]");
  process.exit(2);
}

async function docker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Port 0 lets the OS pick, so concurrent runs (a watch session beside a one-off) never collide.
 * Docker reports the real port back through `port`.
 */
async function startContainer(): Promise<string> {
  const run = await docker([
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER,
    "-e",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "-e",
    "POSTGRES_USER=cpm",
    "-e",
    "POSTGRES_DB=cpm_test",
    "-p",
    "0:5432",
    "--tmpfs",
    "/var/lib/postgresql/data",
    IMAGE,
    // Bun runs test files in parallel processes, and each one that imports src/lib/db opens a
    // pool of its own on top of the per-test connections. The default of 100 is exhausted well
    // before the suite finishes; this is a throwaway server, so the ceiling can be generous.
    "-c",
    "max_connections=1000",
    // Durability buys nothing for a database that is deleted when the run ends, and fsync is the
    // single largest cost in schema setup and teardown.
    "-c",
    "fsync=off",
    "-c",
    "full_page_writes=off",
    "-c",
    "synchronous_commit=off",
  ]);
  if (run.code !== 0) {
    throw new Error(`Could not start ${IMAGE}: ${run.stderr || run.stdout}`);
  }

  const port = await docker(["port", CONTAINER, "5432/tcp"]);
  if (port.code !== 0) {
    throw new Error(`Could not read the container's port: ${port.stderr || port.stdout}`);
  }
  // "0.0.0.0:49154", and on some daemons an IPv6 line follows.
  const mapped = port.stdout.split("\n")[0]?.trim().split(":").pop();
  if (!mapped) {
    throw new Error(`Could not parse the container's port from: ${port.stdout}`);
  }
  return mapped;
}

/** Returns the server's max_connections, which is also proof the -c flags reached postgres. */
async function waitUntilReady(url: string): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const probe = new SQL({ url, max: 1 });
    try {
      const [row] = await probe.unsafe("SHOW max_connections");
      await probe.close();
      return String((row as { max_connections: string }).max_connections);
    } catch (error) {
      lastError = error;
      await probe.close().catch(() => {});
      await Bun.sleep(250);
    }
  }
  throw new Error(`PostgreSQL was not ready within ${READY_TIMEOUT_MS}ms: ${lastError}`);
}

let started = false;

async function stopContainer(): Promise<void> {
  if (!started) return;
  started = false;
  await docker(["rm", "-f", CONTAINER]);
}

let url = process.env.TEST_POSTGRES_URL;

if (url) {
  console.log("[test-db] using TEST_POSTGRES_URL from the environment");
} else {
  const port = await startContainer();
  started = true;
  url = `postgres://cpm:${PASSWORD}@127.0.0.1:${port}/cpm_test`;
  // Ctrl-C during a watch session would otherwise leave the container running. `--rm` only covers
  // the container exiting on its own.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stopContainer().finally(() => process.exit(130));
    });
  }
  const limit = await waitUntilReady(url);
  console.log(`[test-db] ${IMAGE} on 127.0.0.1:${port}, max_connections=${limit}`);
}

const child = Bun.spawn(command, {
  env: { ...process.env, TEST_POSTGRES_URL: url },
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const code = await child.exited;
await stopContainer();
process.exit(code);
