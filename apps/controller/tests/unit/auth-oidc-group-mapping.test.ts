/**
 * Wiring check for group mapping: the hooks attach only when a provider asks for it, and the
 * profile hook parks a result the sign-in picks up. Mapping rules live in oidc-groups.test.ts.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

vi.mock('../../src/lib/db', () => {
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null =>
      !value ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  };
});

vi.mock('better-auth', () => ({
  betterAuth: (options: any) => ({ options }),
}));
vi.mock('better-auth/plugins', () => ({
  genericOAuth: () => ({}),
  username: () => ({}),
}));

import { mapOAuthProvider } from '../../src/lib/auth-server';
import type { OAuthProvider } from '../../src/lib/models/oauth-providers';
import {
  clearPendingOidcSyncs,
  consumePendingOidcSync,
} from '../../src/lib/services/oidc-group-sync';

function provider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    id: 'authentik',
    name: 'Authentik',
    type: 'oidc',
    clientId: 'cid',
    clientSecret: 'secret',
    issuer: 'https://idp.example/',
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    scopes: 'openid email profile groups',
    autoLink: false,
    enabled: true,
    source: 'ui',
    groupsClaim: 'groups',
    groupPrefix: 'CPM_',
    roleMappingEnabled: false,
    adminGroup: null,
    userGroup: null,
    viewerGroup: null,
    defaultRole: 'user',
    syncGroups: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * better-auth's GenericOAuthUserInfo carries every standard OIDC field. These tests only need the
 * subject and the group claim, so the rest are filled in here rather than at each call site.
 */
function profile(claims: Record<string, unknown>) {
  return { emailVerified: false, ...claims } as Parameters<
    NonNullable<ReturnType<typeof mapOAuthProvider>['mapProfileToUser']>
  >[0];
}

beforeEach(() => {
  clearPendingOidcSyncs();
});

describe('mapOAuthProvider — group mapping hooks', () => {
  it('attaches no claim hooks for a provider that does not use groups', () => {
    const cfg = mapOAuthProvider(provider());
    expect(cfg.getUserInfo).toBeUndefined();
    // mapProfileToUser is always present — it reports emailVerified for the auto-link gate — so
    // what matters here is that it derives nothing from the group claim.
    expect(cfg.mapProfileToUser?.({ groups: ['CPM_Admin'] } as never)).toEqual({
      emailVerified: false,
    });
  });

  it('attaches them when role mapping is on', () => {
    const cfg = mapOAuthProvider(provider({ roleMappingEnabled: true }));
    expect(typeof cfg.getUserInfo).toBe('function');
    expect(typeof cfg.mapProfileToUser).toBe('function');
  });

  it('attaches them when only group sync is on', () => {
    const cfg = mapOAuthProvider(provider({ syncGroups: true }));
    expect(typeof cfg.getUserInfo).toBe('function');
  });

  it('records the mapped role for the subject in the profile', async () => {
    const cfg = mapOAuthProvider(provider({ roleMappingEnabled: true }));

    await cfg.mapProfileToUser!(
      profile({
        sub: 'user-1',
        email: 'dev@example.com',
        groups: ['CPM_Admin', 'CPM_Devs'],
      }),
    );

    const pending = consumePendingOidcSync('authentik', 'user-1');
    expect(pending).not.toBeNull();
    expect(pending!.role).toBe('admin');
    expect(pending!.providerName).toBe('Authentik');
  });

  it('records the mirrored group names when group sync is on', async () => {
    const cfg = mapOAuthProvider(provider({ roleMappingEnabled: true, syncGroups: true }));

    await cfg.mapProfileToUser!(
      profile({
        sub: 'user-1',
        email: 'dev@example.com',
        groups: ['CPM_Admin', 'CPM_Devs', 'Unrelated'],
      }),
    );

    const pending = consumePendingOidcSync('authentik', 'user-1');
    expect(pending!.localGroups).toEqual(['Devs']);
    expect(pending!.syncGroups).toBe(true);
  });

  it('never returns privileged fields to better-auth from the IdP profile', async () => {
    const cfg = mapOAuthProvider(provider({ roleMappingEnabled: true }));

    const mapped = await cfg.mapProfileToUser!(
      profile({
        sub: 'user-1',
        email: 'evil@example.com',
        role: 'admin',
        status: 'active',
        groups: [],
      }),
    );

    expect(mapped).toEqual({});
  });

  it('records the role from custom group names configured without a prefix', async () => {
    const cfg = mapOAuthProvider(
      provider({
        roleMappingEnabled: true,
        groupPrefix: null,
        adminGroup: 'platform-owners, sre-oncall',
        userGroup: 'staff',
        viewerGroup: 'auditors',
      }),
    );

    await cfg.mapProfileToUser!(
      profile({
        sub: 'user-3',
        email: 'sre@example.com',
        groups: ['sre-oncall'],
      }),
    );

    expect(consumePendingOidcSync('authentik', 'user-3')!.role).toBe('admin');
  });

  it('records the default role for a user in none of the role groups', async () => {
    const cfg = mapOAuthProvider(provider({ roleMappingEnabled: true, defaultRole: 'viewer' }));

    await cfg.mapProfileToUser!(
      profile({ sub: 'user-2', email: 'x@example.com', groups: ['Marketing'] }),
    );

    expect(consumePendingOidcSync('authentik', 'user-2')!.role).toBe('viewer');
  });

  it('parks nothing when the profile has no subject to key on', async () => {
    const cfg = mapOAuthProvider(provider({ roleMappingEnabled: true }));

    await cfg.mapProfileToUser!(profile({ email: 'x@example.com', groups: ['CPM_Admin'] }));

    expect(consumePendingOidcSync('authentik', 'undefined')).toBeNull();
  });
});
