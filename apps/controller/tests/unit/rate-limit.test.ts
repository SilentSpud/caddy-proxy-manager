import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';

// Reset the module between tests so the in-memory Map is cleared
let registerFailedAttempt: typeof import('@/src/lib/rate-limit').registerFailedAttempt;
let isRateLimited: typeof import('@/src/lib/rate-limit').isRateLimited;
let resetAttempts: typeof import('@/src/lib/rate-limit').resetAttempts;

beforeEach(async () => {
  const mod = await import(`@/src/lib/rate-limit${fresh()}`);
  registerFailedAttempt = mod.registerFailedAttempt;
  isRateLimited = mod.isRateLimited;
  resetAttempts = mod.resetAttempts;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rate-limit', () => {
  const KEY = 'test-ip-1';

  it('first attempt is not blocked', async () => {
    const result = await registerFailedAttempt(KEY);
    expect(result.blocked).toBe(false);
  });

  it('4 failed attempts are not blocked (below threshold of 5)', async () => {
    for (let i = 0; i < 4; i++) {
      const result = await registerFailedAttempt(KEY);
      expect(result.blocked).toBe(false);
    }
  });

  it('5th failed attempt triggers block', async () => {
    for (let i = 0; i < 4; i++) {
      await registerFailedAttempt(KEY);
    }
    const result = await registerFailedAttempt(KEY);
    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isRateLimited returns blocked after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      await registerFailedAttempt(KEY);
    }
    const result = await isRateLimited(KEY);
    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isRateLimited returns not blocked for unknown key', async () => {
    const result = await isRateLimited('unknown-key-xyz');
    expect(result.blocked).toBe(false);
  });

  it('blocked entry unblocks after blockedUntil passes', async () => {
    // Trigger block
    for (let i = 0; i < 5; i++) {
      await registerFailedAttempt(KEY);
    }

    // Mock Date.now to be far in the future (past block window)
    const future = Date.now() + 16 * 60 * 1000; // 16 minutes
    vi.spyOn(Date, 'now').mockReturnValue(future);

    const result = await isRateLimited(KEY);
    expect(result.blocked).toBe(false);
  });

  it('window expires without max attempts resets attempts', async () => {
    // Make a few attempts
    for (let i = 0; i < 3; i++) {
      await registerFailedAttempt(KEY);
    }

    // Jump past the window (default 5 minutes)
    const future = Date.now() + 6 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(future);

    // Now should be treated as first attempt
    const result = await registerFailedAttempt(KEY);
    expect(result.blocked).toBe(false);
  });

  it('resetAttempts immediately unblocks a key', async () => {
    for (let i = 0; i < 5; i++) {
      await registerFailedAttempt(KEY);
    }
    expect((await isRateLimited(KEY)).blocked).toBe(true);

    resetAttempts(KEY);
    expect((await isRateLimited(KEY)).blocked).toBe(false);
  });

  it('different keys do not interfere', async () => {
    const KEY_A = 'ip-a';
    const KEY_B = 'ip-b';

    for (let i = 0; i < 5; i++) {
      await registerFailedAttempt(KEY_A);
    }

    expect((await isRateLimited(KEY_A)).blocked).toBe(true);
    expect((await isRateLimited(KEY_B)).blocked).toBe(false);
  });
});
