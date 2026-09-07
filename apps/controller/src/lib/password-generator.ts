/**
 * Generating a password the app itself chooses — a ClickHouse password, a PKCS#12 export password,
 * the credential an administrator hands to a new user.
 *
 * Dependency-free and `crypto.getRandomValues`-only, so it runs unchanged in a client component and
 * in a test. `Math.random` is never acceptable here: it is seeded predictably and its output is
 * recoverable from a handful of samples.
 */
import { MIN_PASSWORD_LENGTH, isPasswordAcceptable } from "./password-policy";

/**
 * Ambiguous glyphs are left out — I, l, 1, O, 0 — because these are read off a screen and typed
 * somewhere else, and a password nobody can transcribe gets replaced by a weak one. The symbols are
 * the punctuation that survives a shell, a YAML file and a connection string without quoting.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%&*-_=+";

/** Default length: comfortably past the policy minimum, still short enough to read aloud. */
export const GENERATED_PASSWORD_LENGTH = 24;

/**
 * A uniformly random string over ALPHABET.
 *
 * The modulo is rejection-sampled rather than taken directly: 2^32 is not a multiple of the
 * alphabet size, so `value % length` on the raw draw would make the first few characters very
 * slightly likelier than the last few. The bias is small, but discarding the short tail costs
 * nothing and removes the need to argue about how small.
 */
function randomString(length: number): string {
  // The largest multiple of the alphabet size that fits in a uint32; draws at or above it are
  // discarded rather than folded, which is what would reintroduce the bias.
  const ceiling = Math.floor(0x1_0000_0000 / ALPHABET.length) * ALPHABET.length;
  const out: string[] = [];
  const draws = new Uint32Array(length * 2);

  while (out.length < length) {
    crypto.getRandomValues(draws);
    for (const draw of draws) {
      if (out.length === length) break;
      if (draw < ceiling) out.push(ALPHABET[draw % ALPHABET.length]);
    }
  }

  return out.join("");
}

/**
 * A password that satisfies {@link isPasswordAcceptable}.
 *
 * Acceptability is reached by discarding candidates rather than by composing one character per
 * required class. Composing would bias the result — a fixed digit position is a position an
 * attacker does not have to guess — and, worse, it would silently stop matching the policy the day
 * a rule is added. Rejection stays correct because it asks the policy itself.
 *
 * At the default length a candidate is rejected roughly once in a thousand, so the loop is not a
 * practical cost. It still terminates: a length that could never satisfy the policy throws rather
 * than spinning or quietly returning something weaker.
 */
export function generatePassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  if (length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `generatePassword: ${length} is below the policy minimum of ${MIN_PASSWORD_LENGTH}`,
    );
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = randomString(length);
    if (isPasswordAcceptable(candidate)) return candidate;
  }

  // Unreachable for any alphabet that covers every required class, which this one does. Loud,
  // because the alternative is handing back a password the form will reject.
  throw new Error("generatePassword: exhausted attempts without meeting the password policy");
}
