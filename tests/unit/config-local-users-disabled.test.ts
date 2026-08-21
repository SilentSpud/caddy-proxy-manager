/**
 * AUTH_DISABLE_LOCAL_USERS=true is the OIDC-only switch. It has to hold in
 * production without ADMIN_USERNAME/ADMIN_PASSWORD being set — the whole point
 * is that no local account exists to give credentials to — while leaving the
 * normal mode's strict validation untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type AuthConfig = {
  disableLocalUsers: boolean;
  allowSelfRegistration: boolean;
  allowOauthRegistration: boolean;
};

async function loadAuthConfig(env: Record<string, string | undefined>): Promise<AuthConfig> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { config } = await import('../../src/lib/config');
  return config.auth;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('AUTH_DISABLE_LOCAL_USERS', () => {
  it('is off unless set to exactly "true"', async () => {
    expect((await loadAuthConfig({})).disableLocalUsers).toBe(false);
    expect((await loadAuthConfig({ AUTH_DISABLE_LOCAL_USERS: 'false' })).disableLocalUsers).toBe(false);
    expect((await loadAuthConfig({ AUTH_DISABLE_LOCAL_USERS: 'TRUE' })).disableLocalUsers).toBe(false);
    expect((await loadAuthConfig({ AUTH_DISABLE_LOCAL_USERS: 'true' })).disableLocalUsers).toBe(true);
  });

  it('forces credential self-registration off, even if it was requested', async () => {
    const auth = await loadAuthConfig({
      AUTH_DISABLE_LOCAL_USERS: 'true',
      AUTH_ALLOW_SELF_REGISTRATION: 'true',
    });
    expect(auth.allowSelfRegistration).toBe(false);
  });

  it('opens OAuth provisioning by default, since the IdP is the only source of accounts', async () => {
    const auth = await loadAuthConfig({ AUTH_DISABLE_LOCAL_USERS: 'true' });
    expect(auth.allowOauthRegistration).toBe(true);
  });

  it('still honours an explicit refusal of OAuth provisioning', async () => {
    const auth = await loadAuthConfig({
      AUTH_DISABLE_LOCAL_USERS: 'true',
      AUTH_ALLOW_OAUTH_REGISTRATION: 'false',
    });
    expect(auth.allowOauthRegistration).toBe(false);
  });

  it('leaves OAuth provisioning closed by default in normal mode', async () => {
    expect((await loadAuthConfig({})).allowOauthRegistration).toBe(false);
  });
});

describe('admin credentials in OIDC-only mode', () => {
  const productionEnv = {
    NODE_ENV: 'production',
    NEXT_RUNTIME: 'nodejs',
    NEXT_PHASE: 'phase-production-server',
    SESSION_SECRET: 'a-sufficiently-long-production-session-secret-value',
  };

  async function loadConfigModule(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return import('../../src/lib/config');
  }

  it('resolves to no credentials instead of demanding them', async () => {
    const { config, validateProductionConfig } = await loadConfigModule({
      ...productionEnv,
      AUTH_DISABLE_LOCAL_USERS: 'true',
      ADMIN_USERNAME: undefined,
      ADMIN_PASSWORD: undefined,
    });

    expect(() => validateProductionConfig()).not.toThrow();
    expect(config.adminUsername).toBeNull();
    expect(config.adminPassword).toBeNull();
  });

  it('ignores credentials that would otherwise be rejected as too weak', async () => {
    const { config } = await loadConfigModule({
      ...productionEnv,
      AUTH_DISABLE_LOCAL_USERS: 'true',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
    });

    expect(config.adminPassword).toBeNull();
  });

  it('still enforces strong admin credentials when local users are enabled', async () => {
    const { validateProductionConfig } = await loadConfigModule({
      ...productionEnv,
      AUTH_DISABLE_LOCAL_USERS: undefined,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
    });

    expect(() => validateProductionConfig()).toThrow(/ADMIN_PASSWORD/);
  });
});
