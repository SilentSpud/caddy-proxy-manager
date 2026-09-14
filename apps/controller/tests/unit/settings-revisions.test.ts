/**
 * The review sheet's history names each past apply from its stored keys, in the reader's language.
 * `summary` stays in the table as it was written - the migration copies it - so these pin that the
 * keys come back alongside it, and that a row whose keys cannot be read still has something to show.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

// bun evaluates a vi.mock factory synchronously while linking, so the helpers it needs
// are imported above it rather than awaited inside it.
const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous - an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => {
  return {
    default: ctx.db,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock('../../src/lib/caddy', () => ({
  applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }),
  buildCaddyDocument: vi.fn().mockResolvedValue({}),
}));

import { applyStagedSettings, recentRevisions } from '../../src/lib/settings/apply';
import { stageWrites } from '../../src/lib/settings/staging';
import { applyCaddyConfig } from '../../src/lib/caddy';
import { DomainError } from '../../src/lib/domain-error';
import * as schema from '../../src/lib/db/schema';

beforeEach(async () => {
  await ctx.db.delete(schema.settingsRevisions);
});

async function insertRevision(summary: string, keys: string) {
  await ctx.db.insert(schema.settingsRevisions).values({
    appliedBy: null,
    appliedByName: 'Admin',
    summary,
    keys,
    outcome: 'applied',
    error: null,
    appliedAt: new Date().toISOString(),
  });
}

describe('recentRevisions', () => {
  it('returns the committed keys with the summary left as stored', async () => {
    await insertRevision('waf, geoblock', JSON.stringify(['waf', 'geoblock']));
    const [revision] = await recentRevisions(1);
    expect(revision.summary).toBe('waf, geoblock');
    expect(revision.keys).toEqual(['waf', 'geoblock']);
  });

  it('stores the English fallback for a non-Error failure, and hands back a code to render', async () => {
    await ctx.db.delete(schema.users).catch(() => {});
    await ctx.db.insert(schema.users).values({
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      role: 'admin',
      provider: 'credentials',
      subject: 'test',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await stageWrites(1, new Map([['general', JSON.stringify({ primaryDomain: 'example.test' })]]));
    vi.mocked(applyCaddyConfig).mockRejectedValueOnce('not an Error');

    const outcome = await applyStagedSettings(1, 'Test User');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBe('Failed to apply Caddy configuration');
    expect(outcome.cause).toBeInstanceOf(DomainError);
    expect((outcome.cause as DomainError).code).toBe('applyCaddyConfigFailed');

    const [revision] = await recentRevisions(1);
    expect(revision.outcome).toBe('failed');
    expect(revision.error).toBe('Failed to apply Caddy configuration');
  });

  it('yields no keys for an unreadable column, so the sheet shows the summary instead', async () => {
    await insertRevision('waf', 'not json');
    await insertRevision('geoblock', JSON.stringify({ not: 'a list' }));
    const revisions = await recentRevisions(2);
    expect(revisions.map((revision) => revision.keys)).toEqual([[], []]);
  });
});
