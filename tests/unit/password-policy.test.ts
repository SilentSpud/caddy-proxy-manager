/**
 * The password rule is now defined once and enforced in four places (admin env
 * validation, change-password, the forced-reset screen, and .p12 export). These
 * tests pin the rule itself; the callers are covered where they are used.
 */
import { describe, it, expect } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  passwordPolicyFailures,
  passwordPolicyError,
} from '@/src/lib/password-policy';

const VALID = 'CorrectHorse1!';

describe('passwordPolicyFailures', () => {
  it('accepts a password meeting every requirement', () => {
    expect(passwordPolicyFailures(VALID)).toEqual([]);
  });

  it.each([
    ['Sh0rt!', 'must be at least 12 characters long'],
    ['alllowercase1!', 'must include both uppercase and lowercase letters'],
    ['ALLUPPERCASE1!', 'must include both uppercase and lowercase letters'],
    ['NoDigitsHere!!', 'must include at least one number'],
    ['NoSpecialChar1', 'must include at least one special character'],
  ])('rejects %j', (password, expected) => {
    expect(passwordPolicyFailures(password)).toContain(expected);
  });

  it('reports every failure at once rather than one per attempt', () => {
    // A user retyping a password should learn all of what is wrong in one go.
    expect(passwordPolicyFailures('short')).toHaveLength(4);
  });

  it('counts the boundary correctly', () => {
    const atLimit = `Aa1!${'x'.repeat(MIN_PASSWORD_LENGTH - 4)}`;
    expect(atLimit).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(passwordPolicyFailures(atLimit)).toEqual([]);
    expect(passwordPolicyFailures(atLimit.slice(0, -1))).toContain(
      `must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );
  });

  it('treats any non-alphanumeric as special, including a space', () => {
    expect(passwordPolicyFailures('Correct Horse1')).toEqual([]);
  });

  it('accepts long passphrases without an upper bound', () => {
    expect(passwordPolicyFailures(`Aa1!${'x'.repeat(500)}`)).toEqual([]);
  });
});

describe('passwordPolicyError', () => {
  it('returns null for an acceptable password', () => {
    expect(passwordPolicyError(VALID)).toBeNull();
  });

  it('prefixes the subject so each caller can name its own field', () => {
    expect(passwordPolicyError('short', 'Export password')).toMatch(/^Export password must be/);
    expect(passwordPolicyError('short', 'ADMIN_PASSWORD')).toMatch(/^ADMIN_PASSWORD must be/);
    expect(passwordPolicyError('short')).toMatch(/^Password must be/);
  });

  it('joins multiple failures into one sentence', () => {
    const message = passwordPolicyError('short');
    expect(message).toContain('at least');
    expect(message).toContain('number');
    expect(message).toContain('special character');
  });

  it('rejects an empty password', () => {
    expect(passwordPolicyError('')).not.toBeNull();
  });
});

describe('PASSWORD_POLICY_HINT', () => {
  it('describes the rule it is shown next to', () => {
    // The hint is the only thing a user reads before typing, so it should not
    // drift from the length actually enforced.
    expect(PASSWORD_POLICY_HINT).toContain(String(MIN_PASSWORD_LENGTH));
  });
});
