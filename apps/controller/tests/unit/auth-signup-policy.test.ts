/**
 * Self-registration goes through Better Auth's own sign-up route, which only knows its 8-character
 * floor. The before-hook holds it to the app's password policy instead, worded from the catalog.
 */
import { describe, it, expect } from 'bun:test';
import { signUpPasswordError } from '../../src/lib/auth-signup-policy';
import { testTranslator } from '../helpers/next-intl';

const t = testTranslator();

describe('signUpPasswordError', () => {
  it('refuses a sign-up whose password Better Auth alone would accept', () => {
    expect(signUpPasswordError('/sign-up/email', { password: 'longenough' }, t)).not.toBeNull();
    expect(signUpPasswordError('/sign-up/email', { password: 12345678 }, t)).not.toBeNull();
    expect(signUpPasswordError('/sign-up/email', {}, t)).not.toBeNull();
    expect(signUpPasswordError('/sign-up/email', undefined, t)).not.toBeNull();
  });

  it('words the refusal from the message catalog', () => {
    const message = signUpPasswordError('/sign-up/email', { password: 'longenough' }, t);
    expect(message).toStartWith('Password ');
    expect(message).toContain('must include at least one number');
  });

  it('lets a policy-compliant sign-up through', () => {
    expect(
      signUpPasswordError('/sign-up/email', { password: 'Correct-Horse-9-Battery' }, t),
    ).toBeNull();
  });

  it('ignores every other route', () => {
    expect(signUpPasswordError('/sign-in/username', { password: 'x' }, t)).toBeNull();
  });
});
