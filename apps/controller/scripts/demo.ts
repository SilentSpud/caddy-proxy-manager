/**
 * A demo instance with no containers at all: DEMO_MODE on, a SQLite file for the database.
 *
 *   bun run demo                        # dev server on :3020, seeded on first start
 *   bun run demo --reset                # start over from a freshly seeded database
 *   bun run demo --reset-every 6        # and again every six hours, for a public demo
 *   bun run demo --prod                 # build once, then serve the production build
 *
 * Signs in as admin / admin (ADMIN_USERNAME / ADMIN_PASSWORD override it). Demo mode keeps that
 * account from being disabled, demoted or given a new password, so no visitor can lock out the next.
 * Everything else the environment sets is passed through, so CLICKHOUSE_PASSWORD still works.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const args = yargs(hideBin(process.argv))
  .scriptName("demo")
  .option("port", { type: "number", default: 3020 })
  .option("reset", { type: "boolean", default: false, describe: "Delete and reseed the database" })
  .option("reset-every", { type: "number", describe: "Hours between automatic resets" })
  .option("seed", { type: "boolean", default: true, describe: "Seed a new database (--no-seed)" })
  .option("prod", { type: "boolean", default: false, describe: "Serve a production build" })
  .option("data-dir", { type: "string", describe: "Where the database lives" })
  .strict()
  .help()
  .parseSync();

const controllerDir = resolve(import.meta.dir, "..");
// Under the gitignored data/, and a directory down so the legacy-database scan of ./data skips it.
const dataDir = resolve(args["data-dir"] ?? join(controllerDir, "data", "demo"));
const dbFile = join(dataDir, "cpm.db");
mkdirSync(dataDir, { recursive: true });

/** Kept beside the database so sessions survive a restart, but never shared between demos. */
function sessionSecret(): string {
  const file = join(dataDir, "session-secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

const env: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: args.prod ? "production" : "development",
  DEMO_MODE: "true",
  DATABASE_URL: `file:${dbFile}`,
  SESSION_SECRET: process.env.SESSION_SECRET || sessionSecret(),
  PORT: String(args.port),
  BASE_URL: process.env.BASE_URL || `http://localhost:${args.port}`,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin",
  // Every visitor shares one account, so a lockout would lock out the demo.
  AUTH_RATE_LIMIT_ENABLED: "false",
  UPDATE_CHECK_ENABLED: "false",
};

function deleteDatabase(): void {
  // analytics.db is the demo's traffic (src/lib/clickhouse/sqlite-store.ts), which resets with it.
  for (const file of [dbFile, join(dataDir, "analytics.db")]) {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
  }
}

async function run(command: string[]): Promise<void> {
  const code = await Bun.spawn(command, {
    cwd: controllerDir,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;
  if (code !== 0) throw new Error(`${command.join(" ")} exited with ${code}`);
}

async function prepareDatabase(fresh: boolean): Promise<void> {
  const isNew = fresh || !existsSync(dbFile);
  if (fresh) deleteDatabase();
  // Seeding migrates the new file and creates the admin, so the server starts on a finished one.
  if (isNew && args.seed) await run([process.execPath, "scripts/seed-demo.ts"]);
}

const vinext = join(controllerDir, "node_modules", "vinext", "dist", "cli.js");
let server: ReturnType<typeof Bun.spawn> | null = null;

function startServer(): void {
  // vinext itself rather than `bun run dev`, so stopping it for a reset stops the server and not
  // only a wrapper around it.
  server = Bun.spawn(
    [process.execPath, vinext, args.prod ? "start" : "dev", "--port", String(args.port)],
    { cwd: controllerDir, env, stdio: ["inherit", "inherit", "inherit"] },
  );
}

async function stopServer(): Promise<void> {
  if (!server) return;
  const stopping = server;
  server = null;
  stopping.kill();
  await stopping.exited;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void stopServer().finally(() => process.exit(0));
  });
}

console.log(`[demo] ${dbFile}`);
await prepareDatabase(args.reset);
if (args.prod) await run([process.execPath, vinext, "build"]);
startServer();

if (args["reset-every"]) {
  const every = args["reset-every"] * 60 * 60 * 1000;
  setInterval(async () => {
    console.log("[demo] resetting");
    await stopServer();
    // The server is down while this runs, so nothing holds the file open.
    await prepareDatabase(true);
    startServer();
  }, every);
} else {
  const code = await server!.exited;
  process.exit(code ?? 0);
}
