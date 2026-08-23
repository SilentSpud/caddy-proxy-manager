/**
 * The rule in src/lib/account-issuer.ts mirrors better-auth's own account
 * namespacing so the rows CPM writes directly match the ones better-auth writes
 * for the same identity.
 *
 * Drift here does not fail loudly: nothing throws, the account row simply stops
 * resolving at sign-in and the user is locked out. So the mirror is pinned
 * against better-auth's exported helpers rather than against copied literals —
 * if upstream changes the scheme, this test breaks instead of production.
 */
import { describe, it, expect } from 'vitest';
import { createLocalAccountIssuer, createOAuthAccountIssuer } from '@better-auth/core/db';
import { accountIssuerFor, CREDENTIAL_ISSUER } from '@/src/lib/account-issuer';

describe('accountIssuerFor', () => {
  it('matches better-auth for password accounts', () => {
    expect(CREDENTIAL_ISSUER).toBe(createLocalAccountIssuer('credential'));
    expect(accountIssuerFor('credential')).toBe(createLocalAccountIssuer('credential'));
  });

  it('matches better-auth for an OAuth provider with no issuer of its own', () => {
    expect(accountIssuerFor('dex')).toBe(createOAuthAccountIssuer('dex'));
    expect(accountIssuerFor('authentik-QXV0aG')).toBe(createOAuthAccountIssuer('authentik-QXV0aG'));
  });

  it('encodes a provider id the same way better-auth does', () => {
    // Provider ids are slugs or UUIDs in practice, so this never bites — but the
    // two implementations must not disagree if one ever isn't.
    expect(accountIssuerFor('a b/c')).toBe(createOAuthAccountIssuer('a b/c'));
  });

  it('uses the provider issuer verbatim when one is configured', () => {
    // Verbatim including the trailing slash: mapOAuthProvider passes the stored
    // value through to better-auth as accountIssuer without normalising it, so
    // the backfilled row has to match it character for character.
    expect(accountIssuerFor('authentik', 'https://idp.example/')).toBe('https://idp.example/');
  });

  it('falls back to the local namespace when the issuer is absent or blank', () => {
    expect(accountIssuerFor('dex', null)).toBe(createOAuthAccountIssuer('dex'));
    expect(accountIssuerFor('dex', undefined)).toBe(createOAuthAccountIssuer('dex'));
    expect(accountIssuerFor('dex', '')).toBe(createOAuthAccountIssuer('dex'));
  });

  it('keeps password accounts local even if an issuer is supplied', () => {
    expect(accountIssuerFor('credential', 'https://idp.example/')).toBe(CREDENTIAL_ISSUER);
  });
});
