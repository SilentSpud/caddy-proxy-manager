/**
 * ADMIN_USERNAME / ADMIN_PASSWORD after the setup flow arrived.
 *
 * Absent credentials used to fail startup in production. They now mean "not configured yet", and
 * the app answers with first-run setup instead — so the property under test is that a production
 * instance with neither variable set starts cleanly and seeds nothing. Credentials that *are*
 * present must still be strong: a weak one silently produces a reachable admin account, which is
 * worse than no account at all.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';

const productionEnv = {
  NODE_ENV: 'production',
  NEXT_RUNTIME: 'nodejs',
  NEXT_PHASE: 'phase-production-server',
  SESSION_SECRET: 'a-sufficiently-long-production-session-secret-value',
  AUTH_DISABLE_LOCAL_USERS: undefined,
};

async function loadConfigModule(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries({ ...productionEnv, ...env })) vi.stubEnv(key, value);
  return import(`../../src/lib/config${fresh()}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('with neither variable set', () => {
  it('starts in production and seeds nothing, leaving setup to ask', async () => {
    const { config, validateProductionConfig } = await loadConfigModule({
      ADMIN_USERNAME: undefined,
      ADMIN_PASSWORD: undefined,
    });

    expect(() => validateProductionConfig()).not.toThrow();
    expect(config.adminUsername).toBeNull();
    expect(config.adminPassword).toBeNull();
  });

  it('treats blank strings the same as unset, since that is what Compose sends', async () => {
    const { config, validateProductionConfig } = await loadConfigModule({
      ADMIN_USERNAME: '',
      ADMIN_PASSWORD: '   ',
    });

    expect(() => validateProductionConfig()).not.toThrow();
    expect(config.adminUsername).toBeNull();
  });
});

describe('with credentials present', () => {
  it('accepts a strong pair', async () => {
    const { config, validateProductionConfig } = await loadConfigModule({
      ADMIN_USERNAME: 'operator',
      ADMIN_PASSWORD: 'Strong-Admin-Passw0rd!',
    });

    expect(() => validateProductionConfig()).not.toThrow();
    expect(config.adminUsername).toBe('operator');
  });

  it('still refuses a weak password rather than seeding a reachable account', async () => {
    const { validateProductionConfig } = await loadConfigModule({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
    });

    expect(() => validateProductionConfig()).toThrow(/ADMIN_PASSWORD/);
  });

  it('refuses half a pair, which is a typo rather than an intent to run setup', async () => {
    const { validateProductionConfig } = await loadConfigModule({
      ADMIN_USERNAME: 'operator',
      ADMIN_PASSWORD: undefined,
    });

    expect(() => validateProductionConfig()).toThrow(/alongside ADMIN_USERNAME/);
  });

  it('points at the setup flow when it rejects them', async () => {
    const { validateProductionConfig } = await loadConfigModule({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
    });

    expect(() => validateProductionConfig()).toThrow(/setup flow/);
  });
});

describe('outside production', () => {
  it('no longer invents admin/admin, so development sees the setup flow too', async () => {
    const { config } = await loadConfigModule({
      NODE_ENV: 'development',
      NEXT_RUNTIME: undefined,
      NEXT_PHASE: undefined,
      ADMIN_USERNAME: undefined,
      ADMIN_PASSWORD: undefined,
    });

    expect(config.adminUsername).toBeNull();
    expect(config.adminPassword).toBeNull();
  });
});
