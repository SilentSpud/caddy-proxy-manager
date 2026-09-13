/**
 * Self-registration goes through Better Auth's own sign-up route, which only knows its 8-character
 * floor. The before-hook holds it to the app's password policy instead.
 */
import { describe, it, expect } from 'bun:test';
import { signUpPasswordError } from '../../src/lib/auth-signup-policy';

describe('signUpPasswordError', () => {
  it('refuses a sign-up whose password Better Auth alone would accept', () => {
    expect(signUpPasswordError('/sign-up/email', { password: 'longenough' })).not.toBeNull();
    expect(signUpPasswordError('/sign-up/email', { password: 12345678 })).not.toBeNull();
    expect(signUpPasswordError('/sign-up/email', {})).not.toBeNull();
    expect(signUpPasswordError('/sign-up/email', undefined)).not.toBeNull();
  });

  it('lets a policy-compliant sign-up through', () => {
    expect(
      signUpPasswordError('/sign-up/email', { password: 'Correct-Horse-9-Battery' }),
    ).toBeNull();
  });

  it('ignores every other route', () => {
    expect(signUpPasswordError('/sign-in/username', { password: 'x' })).toBeNull();
  });
});
