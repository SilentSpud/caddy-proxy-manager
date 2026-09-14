/**
 * The sign-in screen shows Better Auth's refusals from `auth.errors`, looked up by code. The English
 * there is Better Auth's own wording, so an English reader sees what they always did; these hold
 * the two together, since an upgrade that rewords a message would otherwise drift silently.
 */
import { describe, expect, it } from 'bun:test';
import { USERNAME_ERROR_CODES } from 'better-auth/plugins/username';
import messages from '../../messages/en.json';
import { SIGN_IN_ERROR_KEYS, signInErrorMessage } from '@/src/lib/sign-in-error';

const errors = messages.auth.errors as Record<string, string | undefined>;
const t = (key: string) => key;

describe('signInErrorMessage', () => {
  it('maps each code it knows to its message', () => {
    for (const [code, key] of Object.entries(SIGN_IN_ERROR_KEYS)) {
      expect(signInErrorMessage({ status: 401, code }, t)).toBe(key);
    }
  });

  it('recognises the rate limiter by status, since its answer carries no code', () => {
    expect(signInErrorMessage({ status: 429 }, t)).toBe('tooManyRequests');
  });

  it('never falls through to raw text for a code it does not know', () => {
    expect(signInErrorMessage({ status: 500, code: 'FAILED_TO_CREATE_SESSION' }, t)).toBe(
      'unknown',
    );
    expect(signInErrorMessage({ status: 400 }, t)).toBe('unknown');
    expect(signInErrorMessage({ code: 'toString' }, t)).toBe('unknown');
  });
});

describe('auth.errors messages', () => {
  it("keeps Better Auth's English for every code", () => {
    const codes = USERNAME_ERROR_CODES as Record<string, { message: string } | undefined>;
    const drifted = Object.entries(SIGN_IN_ERROR_KEYS)
      .filter(([code, key]) => errors[key] !== codes[code]?.message)
      .map(([code]) => code);
    expect(drifted).toEqual([]);
  });

  it("keeps the rate limiter's English", () => {
    // better-auth/dist/api/rate-limiter answers with this literal; it is not exported.
    expect(errors.tooManyRequests).toBe('Too many requests. Please try again later.');
  });

  it('has no message nothing maps to', () => {
    const used = new Set<string>([
      ...Object.values(SIGN_IN_ERROR_KEYS),
      'tooManyRequests',
      'unknown',
    ]);
    expect(Object.keys(errors).filter((key) => !used.has(key))).toEqual([]);
  });
});
