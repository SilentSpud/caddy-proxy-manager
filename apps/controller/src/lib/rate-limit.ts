type RateLimitEntry = {
  attempts: number;
  firstAttemptTimestamp: number;
  blockedUntil?: number;
};

type RateLimitOutcome = {
  blocked: boolean;
  retryAfterMs?: number;
};

const ATTEMPTS = new Map<string, RateLimitEntry>();

/**
 * Read per call rather than at module load: the three values are settings now, so an operator can
 * change the throttle without a restart. The settings module caches, so this is a map lookup after
 * the first read.
 *
 * Imported lazily for the same reason the config module always was — a static import would read
 * process.env before a test's hoisted block could set it.
 */
async function limits(): Promise<{ maxAttempts: number; windowMs: number; blockMs: number }> {
  const [registry, { getSetting }] = await Promise.all([
    import("./settings/registry"),
    import("./settings/resolve"),
  ]);
  const [maxAttempts, windowMs, blockMs] = await Promise.all([
    getSetting(registry.loginMaxAttempts),
    getSetting(registry.loginWindowMs),
    getSetting(registry.loginBlockMs),
  ]);
  return { maxAttempts, windowMs, blockMs };
}

function getEntry(key: string, now: number, windowMs: number): RateLimitEntry | undefined {
  const entry = ATTEMPTS.get(key);
  if (!entry) {
    return undefined;
  }

  // Unblock if the penalty period has elapsed.
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    ATTEMPTS.delete(key);
    return undefined;
  }

  // Reset the window once the observation window expires.
  if (!entry.blockedUntil && entry.firstAttemptTimestamp + windowMs <= now) {
    ATTEMPTS.delete(key);
    return undefined;
  }

  return entry;
}

export async function isRateLimited(key: string): Promise<RateLimitOutcome> {
  const now = Date.now();
  const { windowMs } = await limits();
  const entry = getEntry(key, now, windowMs);
  if (!entry) {
    return { blocked: false };
  }

  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { blocked: true, retryAfterMs: entry.blockedUntil - now };
  }

  return { blocked: false };
}

export async function registerFailedAttempt(key: string): Promise<RateLimitOutcome> {
  const now = Date.now();
  const { maxAttempts, windowMs, blockMs } = await limits();
  const existing = getEntry(key, now, windowMs);

  if (!existing) {
    ATTEMPTS.set(key, {
      attempts: 1,
      firstAttemptTimestamp: now,
    });
    return { blocked: false };
  }

  if (existing.blockedUntil && existing.blockedUntil > now) {
    return { blocked: true, retryAfterMs: existing.blockedUntil - now };
  }

  existing.attempts += 1;

  if (existing.attempts >= maxAttempts) {
    existing.attempts = 0;
    existing.firstAttemptTimestamp = now;
    existing.blockedUntil = now + blockMs;
    return { blocked: true, retryAfterMs: blockMs };
  }

  return { blocked: false };
}

export function resetAttempts(key: string): void {
  ATTEMPTS.delete(key);
}
