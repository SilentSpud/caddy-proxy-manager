/**
 * Password hashing on Bun's native implementations.
 *
 * User passwords use argon2id: memory-hard, and it consumes the whole password rather than
 * bcrypt's first 72 bytes. Access list passwords must stay bcrypt — Caddy's `http_basic` verifies
 * those itself and understands nothing else. Neither blocks the event loop, unlike the pure-JS
 * bcryptjs this replaced (~170ms per hash, serializing sign-ins). `verifyPassword` detects the
 * algorithm from the stored hash, so pre-argon2id rows keep working with no migration.
 */

/** bcrypt hashes only the first 72 bytes of a password; the rest is discarded. */
const BCRYPT_MAX_BYTES = 72;

/** Matches the bcrypt prefixes: $2a$ (legacy), $2b$ (current), $2y$ (PHP). */
const BCRYPT_PREFIX = /^\$2[aby]\$/;

export const DEFAULT_BCRYPT_COST = 12;

/**
 * bcryptjs silently truncated at 72 bytes while Bun.password hashes the full input, so without
 * this a longer password would stop matching its stored hash. By bytes, the unit bcrypt counts,
 * and only for bcrypt — clamping argon2id would throw away real password material.
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
 * Hashes a user password with argon2id at Bun's defaults (m=64MiB, t=2, p=1), which already
 * exceed OWASP's floor of m=19MiB.
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

/**
 * Hashes with bcrypt. Only for hashes something outside this app verifies — today, Caddy
 * basicauth. User passwords want {@link hashPassword}.
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
    // Bun.password.verify throws on a malformed hash where bcryptjs returned false. A corrupt or
    // truncated stored hash must read as "wrong password" rather than a 500, or a single bad row
    // turns into an outage.
    return false;
  }
}
