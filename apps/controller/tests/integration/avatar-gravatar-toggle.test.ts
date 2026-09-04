/**
 * Gravatar fallback has two controls: AVATAR_GRAVATAR and a Settings toggle. The env var wins;
 * otherwise the toggle decides, default on. It is a synced setting, so an agent inherits its controller.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous — an async one never resolves and the file hangs. Creating it once here also
// subsumes the memoisation the factory used to do, so a re-run never discards the setting saved a
// moment earlier — the env-overrides-toggle cases depend on it surviving.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => {
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null =>
      !value ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  };
});

import { settings } from '../../src/lib/db/schema';
// Static import so the db mock factory has run before the first beforeEach;
// every other reference to the module is dynamic, to pick up stubbed env.
import '../../src/lib/settings';

/**
 * Applies the env stubs and re-points config at a freshly evaluated copy. config snapshots
 * process.env on first evaluation, and a query suffix does not propagate to importers, so the plain
 * specifier is mocked to point at the fresh copy.
 */
async function load(env: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const config = await import(`../../src/lib/config${fresh()}`);
  vi.mock('../../src/lib/config', () => ({ ...config }));
  return import('../../src/lib/settings');
}

beforeEach(async () => {
  await ctx.db.delete(settings);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isGravatarEnabled', () => {
  it('defaults to enabled on an untouched instance', async () => {
    const { isGravatarEnabled } = await load();
    expect(await isGravatarEnabled()).toBe(true);
  });

  it('follows the stored toggle when the environment stays out of it', async () => {
    const { saveAvatarSettings, isGravatarEnabled } = await load();

    await saveAvatarSettings({ gravatarEnabled: false });
    expect(await isGravatarEnabled()).toBe(false);

    await saveAvatarSettings({ gravatarEnabled: true });
    expect(await isGravatarEnabled()).toBe(true);
  });

  it('lets AVATAR_GRAVATAR=false override a toggle left enabled', async () => {
    const { saveAvatarSettings } = await load();
    await saveAvatarSettings({ gravatarEnabled: true });

    const { isGravatarEnabled } = await load({ AVATAR_GRAVATAR: 'false' });
    expect(await isGravatarEnabled()).toBe(false);
  });

  it('lets AVATAR_GRAVATAR=true override a toggle left disabled', async () => {
    const { saveAvatarSettings } = await load();
    await saveAvatarSettings({ gravatarEnabled: false });

    const { isGravatarEnabled } = await load({ AVATAR_GRAVATAR: 'true' });
    expect(await isGravatarEnabled()).toBe(true);
  });

  it('accepts the usual spellings of off', async () => {
    for (const value of ['false', 'FALSE', '0', 'no', ' False ']) {
      const { isGravatarEnabled } = await load({ AVATAR_GRAVATAR: value });
      expect(await isGravatarEnabled(), `AVATAR_GRAVATAR=${value}`).toBe(false);
    }
  });

  it('treats an empty variable as unset, leaving the toggle in charge', async () => {
    const { saveAvatarSettings } = await load();
    await saveAvatarSettings({ gravatarEnabled: false });

    const { isGravatarEnabled } = await load({ AVATAR_GRAVATAR: '' });
    expect(await isGravatarEnabled()).toBe(false);
  });
});

describe('resolveAvatar honours the decision', () => {
  const user = { name: 'Ada', email: 'ada@example.com', avatarUrl: null };

  it('offers a Gravatar when enabled', async () => {
    const { resolveAvatar } = await import('../../src/lib/avatar');
    expect(resolveAvatar(user, 72, { gravatar: true }).gravatarUrl).toContain('gravatar.com');
  });

  it('produces no Gravatar URL at all when disabled', async () => {
    const { resolveAvatar } = await import('../../src/lib/avatar');
    const resolved = resolveAvatar(user, 72, { gravatar: false });
    // Nothing to request means the browser never contacts gravatar.com.
    expect(resolved.gravatarUrl).toBeNull();
    expect(resolved.initial).toBe('A');
  });

  it('still shows a user their own icon when Gravatar is off', async () => {
    const { resolveAvatar } = await import('../../src/lib/avatar');
    const resolved = resolveAvatar({ ...user, avatarUrl: 'data:image/png;base64,AAAA' }, 72, {
      gravatar: false,
    });
    expect(resolved.imageUrl).toBe('data:image/png;base64,AAAA');
    expect(resolved.gravatarUrl).toBeNull();
  });
});
