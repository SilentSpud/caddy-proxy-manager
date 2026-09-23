/**
 * Integration: src/lib/models/waf-presets.ts against a real database - validation, the in-use
 * guard on delete, and the Caddy re-apply an edit to a selected preset triggers.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { createTestDb, currentDb, type TestDb } from '../helpers/db';
import { proxyHosts, users } from '../../src/lib/db/schema';

let db: TestDb;
let globalWaf: { preset_ids?: number[] } | null = null;

vi.mock('../../src/lib/db', () => ({
  default: currentDb(() => db),
  nowIso: () => new Date().toISOString(),
  toIso: (v: string | null) => v,
}));
vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));
const applyCaddyConfig = vi.fn(async () => {});
vi.mock('../../src/lib/caddy', () => ({ applyCaddyConfig }));
vi.mock('../../src/lib/settings', () => ({
  getWafSettings: async () => globalWaf,
  getDashboardSettings: async () => null,
}));

import {
  assertWafPresetIdsExist,
  createWafPreset,
  deleteWafPreset,
  getWafPresetUsage,
  listWafPresets,
  updateWafPreset,
} from '../../src/lib/models/waf-presets';

const RULE = 'SecRule ARGS "@rx x" "id:9700,phase:1,pass,nolog,ctl:ruleRemoveById=942100"';

let userId: number;

beforeEach(async () => {
  db = await createTestDb();
  vi.clearAllMocks();
  globalWaf = null;
  const now = new Date().toISOString();
  const [user] = await db
    .insert(users)
    .values({
      email: 'admin@test',
      name: 'Admin',
      role: 'admin',
      provider: 'credentials',
      subject: 'admin@test',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  userId = user.id;
});

async function seedHost(name: string, presetIds: number[]) {
  const now = new Date().toISOString();
  await db.insert(proxyHosts).values({
    name,
    domains: JSON.stringify([`${name}.test`]),
    upstreams: JSON.stringify(['app:80']),
    meta: JSON.stringify({ waf: { enabled: true, preset_ids: presetIds } }),
    createdAt: now,
    updatedAt: now,
  });
}

describe('createWafPreset', () => {
  it('stores a trimmed preset and lists it by name', async () => {
    await createWafPreset({ name: ' Nextcloud ', directives: `\n${RULE}\n` }, userId);
    await createWafPreset({ name: 'Immich', description: 'uploads', directives: RULE }, userId);
    const presets = await listWafPresets();
    expect(presets.map((p) => p.name)).toEqual(['Immich', 'Nextcloud']);
    expect(presets[1].directives).toBe(RULE);
    expect(presets[0].description).toBe('uploads');
  });

  it('stores the CRLF a browser form submits as LF', async () => {
    const multiLine = 'SecRule ARGS "@rx x" \\\r\n    "id:9701,phase:1,pass,nolog"';
    const preset = await createWafPreset({ name: 'Form', directives: multiLine }, userId);
    expect(preset.directives).toBe(multiLine.replace('\r\n', '\n'));
  });

  it('refuses a name another preset has, ignoring case', async () => {
    await createWafPreset({ name: 'Nextcloud', directives: RULE }, userId);
    await expect(createWafPreset({ name: 'nextcloud', directives: RULE }, userId)).rejects.toThrow(
      'already exists',
    );
  });

  it('refuses directives the allowlist would drop, naming them', async () => {
    await expect(
      createWafPreset({ name: 'Bad', directives: `${RULE}\nSecRuleEngine Off` }, userId),
    ).rejects.toThrow('SecRuleEngine Off');
  });

  it('refuses an empty preset', async () => {
    await expect(createWafPreset({ name: 'Empty', directives: '  ' }, userId)).rejects.toThrow(
      'at least one directive',
    );
  });
});

describe('updateWafPreset', () => {
  it('re-applies Caddy only when a selected preset changes its directives', async () => {
    const preset = await createWafPreset({ name: 'A', directives: RULE }, userId);
    await updateWafPreset(preset.id, { directives: RULE.replace('9700', '9701') }, userId);
    expect(applyCaddyConfig).not.toHaveBeenCalled();

    await seedHost('app', [preset.id]);
    await updateWafPreset(preset.id, { description: 'renamed nothing' }, userId);
    expect(applyCaddyConfig).not.toHaveBeenCalled();
    await updateWafPreset(preset.id, { directives: RULE }, userId);
    expect(applyCaddyConfig).toHaveBeenCalledTimes(1);
  });

  it('allows keeping its own name', async () => {
    const preset = await createWafPreset({ name: 'A', directives: RULE }, userId);
    const updated = await updateWafPreset(preset.id, { name: 'a' }, userId);
    expect(updated.name).toBe('a');
  });
});

describe('deleteWafPreset', () => {
  it('refuses while a host selects it, naming the host', async () => {
    const preset = await createWafPreset({ name: 'A', directives: RULE }, userId);
    await seedHost('files', [preset.id]);
    await expect(deleteWafPreset(preset.id, userId)).rejects.toThrow('files');
  });

  it('refuses while the global settings select it', async () => {
    const preset = await createWafPreset({ name: 'A', directives: RULE }, userId);
    globalWaf = { preset_ids: [preset.id] };
    await expect(deleteWafPreset(preset.id, userId)).rejects.toThrow('global WAF settings');
  });

  it('deletes an unused preset', async () => {
    const preset = await createWafPreset({ name: 'A', directives: RULE }, userId);
    await deleteWafPreset(preset.id, userId);
    expect(await listWafPresets()).toEqual([]);
  });
});

describe('getWafPresetUsage / assertWafPresetIdsExist', () => {
  it('reports global and per-host selections', async () => {
    const a = await createWafPreset({ name: 'A', directives: RULE }, userId);
    const b = await createWafPreset({ name: 'B', directives: RULE }, userId);
    globalWaf = { preset_ids: [a.id] };
    await seedHost('one', [a.id, b.id]);
    const usage = await getWafPresetUsage();
    expect(usage.get(a.id)).toEqual({
      global: true,
      hosts: [expect.objectContaining({ name: 'one' })],
    });
    expect(usage.get(b.id)?.global).toBe(false);
  });

  it('names ids that match no preset', async () => {
    const a = await createWafPreset({ name: 'A', directives: RULE }, userId);
    await assertWafPresetIdsExist([a.id]);
    await expect(assertWafPresetIdsExist([a.id, 4242])).rejects.toThrow('4242');
  });
});
