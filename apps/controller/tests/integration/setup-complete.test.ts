/**
 * POST /api/setup/complete - the last step of first-run setup.
 *
 * It is a route handler rather than a server action so the page survives its own success, and what
 * it answers with is what the browser needs to finish on its own: where to go, the token that buys
 * one restart, and the domain the dashboard now answers on.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { nextIntlServerMock } from '../helpers/next-intl';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({
  db: null as unknown as TestDb,
  session: null as { user: { id: string; role: string } } | null,
}));

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous - an async one never resolves and the file hangs.
ctx.db = await createTestDb();

vi.mock('../../src/lib/db', () => ({
  default: ctx.db,
  sqlite: undefined,
  schema: schemaModule,
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null =>
    !value ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
}));

vi.mock('next-intl/server', () => nextIntlServerMock());
vi.mock('@/src/lib/auth', () => ({
  auth: async () => ctx.session,
  checkSameOrigin: () => null,
}));
// Starts and stops containers. The save is what this file is about; what it switches on is
// managed-services' own.
vi.mock('@/src/lib/settings/optional-features', () => ({
  propagateOptionalFeatureSettings: async () => {},
}));

import type { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/setup/complete/route';
import { getDashboardSettings, getGeneralSettings } from '../../src/lib/settings';
import { isSetupCompleted, recordMigrationSource } from '../../src/lib/setup';
import { settings } from '../../src/lib/db/schema';

type Body = {
  ok: boolean;
  next?: string;
  restartToken?: string;
  dashboardOrigin?: string | null;
  error?: string;
};

/** The form the settings step posts, with only the fields a test cares about spelled out. */
async function complete(fields: Record<string, string> = {}): Promise<{
  status: number;
  body: Body;
}> {
  const form = new FormData();
  form.set('defaultDomain', 'example.com');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);

  const request = new Request('http://localhost:3000/api/setup/complete', {
    method: 'POST',
    body: form,
  });
  const response = await POST(request as unknown as NextRequest);
  return { status: response.status, body: (await response.json()) as Body };
}

beforeEach(async () => {
  ctx.session = { user: { id: '1', role: 'admin' } };
  await ctx.db.delete(settings);
});

describe('POST /api/setup/complete', () => {
  it('saves the configuration, finishes setup and hands the browser its restart', async () => {
    const { status, body } = await complete({ acmeEmail: 'ops@example.com' });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.next).toBe('/');
    expect(body.restartToken).toBeTruthy();
    expect(await isSetupCompleted()).toBe(true);
    expect(await getGeneralSettings()).toMatchObject({
      defaultDomain: 'example.com',
      acmeEmail: 'ops@example.com',
    });
  });

  it('names the dashboard host it just claimed, so the browser can be sent there', async () => {
    const { body } = await complete({
      dashboardEnabled: 'on',
      dashboardDomain: 'CPM.example.com',
    });

    // HTTP: the setup save never turns TLS on, because nothing can have confirmed the domain
    // reaches here yet.
    expect(body.dashboardOrigin).toBe('http://cpm.example.com');
    expect(await getDashboardSettings()).toMatchObject({
      enabled: true,
      domain: 'cpm.example.com',
    });
  });

  it('claims nothing when the dashboard host is switched off', async () => {
    const { body } = await complete();

    expect(body.dashboardOrigin).toBeNull();
    expect(await getDashboardSettings()).toBeNull();
  });

  it('refuses a domain that is not a hostname, before anything is written', async () => {
    const { status, body } = await complete({
      dashboardEnabled: 'on',
      dashboardDomain: 'https://cpm.example.com/admin',
    });

    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(await isSetupCompleted()).toBe(false);
  });

  it('sends a migrated deployment to its summary rather than to the dashboard', async () => {
    // Its summary is behind the session it holds, and a session belongs to one address: handing it
    // to the dashboard's domain would meet a sign-in page and lose the page it came for.
    await recordMigrationSource('/data/legacy.db');

    const { body } = await complete({
      dashboardEnabled: 'on',
      dashboardDomain: 'cpm.example.com',
    });

    expect(body.next).toBe('/setup/done');
    expect(body.dashboardOrigin).toBeNull();
  });

  it('refuses without a session, and once setup is already finished', async () => {
    ctx.session = null;
    expect((await complete()).status).toBe(401);

    ctx.session = { user: { id: '1', role: 'admin' } };
    expect((await complete()).status).toBe(200);
    expect((await complete()).status).toBe(409);
  });

  it('refuses an ordinary user who was never promoted', async () => {
    ctx.session = { user: { id: '2', role: 'user' } };

    const { status } = await complete();

    expect(status).toBe(403);
    expect(await isSetupCompleted()).toBe(false);
  });

  it('refuses analytics with no ClickHouse password, which cannot start a container', async () => {
    const { status, body } = await complete({ 'config:analytics_enabled': 'on' });

    expect(status).toBe(400);
    expect(body.error).toContain('ClickHouse password');
    expect(await isSetupCompleted()).toBe(false);
  });
});
