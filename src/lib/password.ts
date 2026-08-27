/**
 * Password hashing on Bun's native implementations.
 *
 * Two algorithms live here on purpose:
 *
 * - **User passwords use argon2id.** It is memory-hard, and unlike bcrypt it
 *   consumes the whole password rather than the first 72 bytes, so a long
 *   passphrase actually counts for something.
 * - **Access list passwords must stay bcrypt.** Those hashes are handed to
 *   Caddy's `http_basic` provider, which verifies them itself — Caddy only
 *   understands bcrypt, so anything else silently rejects the correct password.
 *
 * Neither blocks the event loop. The bcryptjs this replaced was pure JS and held
 * the loop for the entire hash (~170ms at cost 12, zero ticks), so concurrent
 * sign-ins serialized the whole server.
 *
 * `verifyPassword` detects the algorithm from the stored hash, so bcrypt rows
 * written before the argon2id switch keep working with no migration.
 */

/** bcrypt hashes only the first 72 bytes of a password; the rest is discarded. */
const BCRYPT_MAX_BYTES = 72;

/** Matches the bcrypt prefixes: $2a$ (legacy), $2b$ (current), $2y$ (PHP). */
const BCRYPT_PREFIX = /^\$2[aby]\$/;

export const DEFAULT_BCRYPT_COST = 12;

/**
 * bcryptjs silently truncated at the 72-byte limit while Bun.password hashes the
 * full input, so without this a password longer than 72 bytes would stop matching
 * the hash bcryptjs stored for it. The cut is by bytes rather than characters
 * because that is the unit bcrypt counts.
 *
 * Only ever applied to bcrypt: argon2id has no such limit, and clamping there
 * would throw away real password material.
 */
function clampToBcryptLimit(password: string): string | Uint8Array {
  const bytes = Buffer.from(password, "utf8");
  return bytes.byteLength <= BCRYPT_MAX_BYTES ? password : bytes.subarray(0, BCRYPT_MAX_BYTES);
}

/** True for a bcrypt hash — i.e. one written before the argon2id switch. */
export function isLegacyPasswordHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && BCRYPT_PREFIX.test(hash);
}

/**
 * Hashes a user password with argon2id, at Bun's defaults (m=64MiB, t=2, p=1),
 * which already exceed OWASP's floor of m=19MiB.
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

/**
 * Hashes with bcrypt. Only for hashes something outside this app verifies —
 * today that means Caddy basicauth. User passwords want {@link hashPassword}.
 */
export async function hashBcrypt(
  password: string,
  cost: number = DEFAULT_BCRYPT_COST,
): Promise<string> {
  return Bun.password.hash(clampToBcryptLimit(password), { algorithm: "bcrypt", cost });
}

/** Verifies against argon2id or bcrypt, returning false — never throwing — for an unusable hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    // Clamp only for bcrypt, to match how the hash was produced.
    const candidate = isLegacyPasswordHash(hash) ? clampToBcryptLimit(password) : password;
    return await Bun.password.verify(candidate, hash);
  } catch {
    // Bun.password.verify throws on a malformed hash where bcryptjs returned
    // false. A corrupt or truncated stored hash must read as "wrong password"
    // rather than a 500, or a single bad row turns into an outage.
    return false;
  }
}
