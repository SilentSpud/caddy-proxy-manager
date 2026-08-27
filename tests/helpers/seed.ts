/**
 * Fixture seeding for the end-to-end suite.
 *
 * The web image ships as a compiled binary (`bun build --compile`) on a base
 * with no Bun CLI, no package manager and no interpreter, so there is nothing in
 * it to execute an ad-hoc script with — which is the point: the suite runs the
 * same image that ships rather than a variant carrying extra tooling.
 *
 * Seeding therefore runs in the `db-seed` service (tests/docker-compose.test.yml),
 * a throwaway `oven/bun:1-slim` container that mounts the same data volume. The
 * scripts are unchanged in substance from when they ran via
 * `docker compose exec web bun -e` — same SQL, same bcrypt via Bun.password, and
 * the same relative database path, since db-seed mounts the volume at the same
 * place. Writing from a second process is not new either: `bun -e` inside the web
 * container was already a separate process from the server, and the writes still
 * take `PRAGMA busy_timeout` against the running server's connection.
 */
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = ['compose', '-f', 'docker-compose.yml', '-f', 'tests/docker-compose.test.yml'];

/** Database path as seen from inside db-seed, whose working_dir is /app. */
const DB = './data/caddy-proxy-manager.db';

/**
 * Run a Bun script against the application database and return its stdout.
 *
 * `--rm` so containers do not accumulate over a run, `--no-deps` so seeding
 * never starts the rest of the stack, and `-T` because Playwright's runner has
 * no TTY and the callers below read stdout.
 */
export function runSeedScript(script: string): string {
  return execFileSync(
    'docker',
    [...COMPOSE_ARGS, 'run', '--rm', '--no-deps', '-T', 'db-seed', '-e', script],
    { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' },
  );
}

/**
 * Create the user, or bring an existing one back to a known state: given role,
 * given password, active.
 *
 * Both a `users` row and a matching `credential` account row are written —
 * Better Auth authenticates against the account, while the dashboard reads the
 * user, and a fixture with only one of the two fails in ways that look like
 * application bugs.
 */
export function ensureTestUser(username: string, password: string, role: string): void {
  runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    db.run("PRAGMA busy_timeout = 5000");
    const email = ${JSON.stringify(`${username}@localhost`)};
    const hash = await Bun.password.hash(${JSON.stringify(password)}, { algorithm: "argon2id" });
    const now = new Date().toISOString();
    const existing = db.query("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      db.run("UPDATE users SET passwordHash = ?, role = ?, status = 'active', updatedAt = ? WHERE email = ?",
        [hash, ${JSON.stringify(role)}, now, email]);
      const acc = db.query("SELECT id FROM accounts WHERE userId = ? AND providerId = 'credential'").get(existing.id);
      if (acc) {
        db.run("UPDATE accounts SET password = ?, updatedAt = ? WHERE id = ?", [hash, now, acc.id]);
      } else {
        db.run("INSERT INTO accounts (userId, accountId, providerId, issuer, password, createdAt, updatedAt) VALUES (?, ?, 'credential', 'local:credential', ?, ?, ?)",
          [existing.id, String(existing.id), hash, now, now]);
      }
    } else {
      db.run(
        "INSERT INTO users (email, name, passwordHash, role, provider, subject, username, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'credentials', ?, ?, 'active', ?, ?)",
        [email, ${JSON.stringify(username)}, hash, ${JSON.stringify(role)}, ${JSON.stringify(username)}, ${JSON.stringify(username)}, now, now]
      );
      const user = db.query("SELECT id FROM users WHERE email = ?").get(email);
      db.run("INSERT INTO accounts (userId, accountId, providerId, issuer, password, createdAt, updatedAt) VALUES (?, ?, 'credential', 'local:credential', ?, ?, ?)",
        [user.id, String(user.id), hash, now, now]);
    }
  `);
}

/** Flip a user between active and disabled. */
export function setUserStatus(email: string, status: 'active' | 'disabled'): void {
  runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    db.run("PRAGMA busy_timeout = 5000");
    db.run("UPDATE users SET status = ?, updatedAt = ? WHERE email = ?",
      [${JSON.stringify(status)}, new Date().toISOString(), ${JSON.stringify(email)}]);
  `);
}

/**
 * Issue a Bearer API token for a user and return the raw value.
 *
 * Only the SHA-256 hash is stored, matching what the application does, so the
 * caller gets the one and only copy of the plaintext.
 */
export function createApiToken(email: string, name: string, token: string): string {
  runSeedScript(`
    import { Database } from "bun:sqlite";
    import { createHash } from "node:crypto";
    const db = new Database(${JSON.stringify(DB)});
    db.run("PRAGMA busy_timeout = 5000");
    const user = db.query("SELECT id FROM users WHERE email = ?").get(${JSON.stringify(email)});
    if (!user) { console.error("User not found: " + ${JSON.stringify(email)}); process.exit(1); }
    const hash = createHash("sha256").update(${JSON.stringify(token)}).digest("hex");
    db.run("INSERT INTO api_tokens (name, tokenHash, createdBy, createdAt) VALUES (?, ?, ?, ?)",
      [${JSON.stringify(name)}, hash, user.id, new Date().toISOString()]);
  `);
  return token;
}

export type SeededUserRecord = {
  email: string;
  provider: string | null;
  subject: string | null;
  username: string | null;
  displayUsername: string | null;
  accountProviderId: string | null;
  accountId: string | null;
  accountHasPassword: boolean;
  role: string;
};

/** Read a user and its credential account back, for assertions about signup. */
export function getUserRecord(email: string): SeededUserRecord {
  const output = runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    const user = db.query(
      "SELECT id, email, provider, subject, username, displayUsername, role FROM users WHERE email = ?"
    ).get(${JSON.stringify(email)});
    if (!user) {
      console.error("User not found");
      process.exit(1);
    }
    const account = db.query(
      "SELECT providerId, accountId, password FROM accounts WHERE userId = ? AND providerId = 'credential'"
    ).get(user.id);
    console.log(JSON.stringify({
      email: user.email,
      provider: user.provider,
      subject: user.subject,
      username: user.username,
      displayUsername: user.displayUsername,
      accountProviderId: account?.providerId ?? null,
      accountId: account?.accountId ?? null,
      accountHasPassword: !!account?.password,
      role: user.role,
    }));
  `).trim();

  // `docker compose run` can interleave its own progress lines with the
  // container's stdout, so take the JSON object rather than the whole stream.
  const json = output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1);
  return JSON.parse(json) as SeededUserRecord;
}

/**
 * Rewrite an existing user's password hash to bcrypt, the algorithm this app
 * used before argon2id.
 *
 * Fixtures for the legacy-password gate cannot be produced through the UI —
 * every path there now writes argon2id — so the "old" state has to be planted
 * directly. Both the `users` row and the `credential` account row are rewritten,
 * because Better Auth authenticates against the account while the gate reads the
 * user, and updating one without the other tests nothing real.
 */
export function downgradeUserToBcrypt(email: string, password: string): void {
  runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    db.run("PRAGMA busy_timeout = 5000");
    const hash = await Bun.password.hash(${JSON.stringify(password)}, { algorithm: "bcrypt", cost: 10 });
    const now = new Date().toISOString();
    const user = db.query("SELECT id FROM users WHERE email = ?").get(${JSON.stringify(email)});
    if (!user) {
      console.error("User not found");
      process.exit(1);
    }
    db.run("UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?", [hash, now, user.id]);
    db.run("UPDATE accounts SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'",
      [hash, now, user.id]);
  `);
}

/** The algorithm prefix of a user's stored hash, e.g. "$argon2id" or "$2b". */
export function getUserHashAlgorithm(email: string): string {
  return runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    const user = db.query("SELECT passwordHash FROM users WHERE email = ?").get(${JSON.stringify(email)});
    console.log((user?.passwordHash ?? "").split("$").slice(0, 2).join("$"));
  `).trim();
}

/** Write a settings row directly, for policies with no seeding API of their own. */
export function setSettingRow(key: string, value: unknown): void {
  runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    db.run("PRAGMA busy_timeout = 5000");
    db.run(
      "INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
      [${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}, new Date().toISOString()]
    );
  `);
}

/** Remove a settings row, restoring the built-in default. */
export function clearSettingRow(key: string): void {
  runSeedScript(`
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(DB)});
    db.run("PRAGMA busy_timeout = 5000");
    db.run("DELETE FROM settings WHERE key = ?", [${JSON.stringify(key)}]);
  `);
}
