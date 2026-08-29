/**
 * Fixture seeding for the e2e suite. The web image is a compiled binary with no Bun CLI —
 * deliberately, so the suite runs the image that ships — so seeding happens in the throwaway
 * `db-seed` container, which mounts the same volume and opens the same SQLite file.
 */
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = ['compose', '-f', 'docker-compose.yml', '-f', 'tests/docker-compose.test.yml'];

/** Database path as seen from inside db-seed, whose working_dir is /app. */
const DB = './data/caddy-proxy-manager.db';

/**
 * Run a Bun script against the application database and return its stdout. `--rm` so containers
 * don't accumulate, `--no-deps` so seeding never starts the stack, `-T` because there is no TTY.
 */
export function runSeedScript(script: string): string {
  return execFileSync(
    'docker',
    [...COMPOSE_ARGS, 'run', '--rm', '--no-deps', '-T', 'db-seed', '-e', script],
    { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' },
  );
}

/**
 * Create the user, or reset one to a known role, password and active state. Writes both a `users`
 * row and a `credential` account row — Better Auth reads the account, the dashboard the user.
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
 * Issue a Bearer API token for a user and return the raw value. Only the SHA-256 hash is stored,
 * matching what the application does, so the caller gets the one and only copy of the plaintext.
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
 * Rewrite a user's password hash to bcrypt. Legacy-gate fixtures cannot be made through the UI, so
 * the old state is planted in both the `users` row and the `credential` account row.
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
