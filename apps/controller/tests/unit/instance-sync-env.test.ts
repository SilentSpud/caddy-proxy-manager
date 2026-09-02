/**
 * The pure environment-variable readers exported by src/lib/instance-sync.ts — no DB or network,
 * just process.env parsing and validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import {
  getEnvAgentInstances,
  getSyncIntervalMs,
  isHttpSyncAllowed,
  isInstanceModeFromEnv,
  isSyncTokenFromEnv,
  getAgentControllerToken,
  setAgentControllerToken,
} from '../../src/lib/instance-sync';

const KEYS = [
  'INSTANCE_AGENTS',
  // No longer read, but assertNoLegacyInstanceRoleEnv rejects it, so leaking it between tests
  // would fail unrelated cases.
  'INSTANCE_SLAVES',
  'INSTANCE_SYNC_INTERVAL',
  'INSTANCE_SYNC_ALLOW_HTTP',
  'INSTANCE_MODE',
  'INSTANCE_SYNC_TOKEN',
] as const;

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

// ---------------------------------------------------------------------------
// getEnvAgentInstances
// ---------------------------------------------------------------------------

describe('getEnvAgentInstances', () => {
  it('returns empty array when env var is not set', () => {
    expect(getEnvAgentInstances()).toEqual([]);
  });

  it('does not read the pre-rename INSTANCE_SLAVES', () => {
    // The fallback is gone. A deployment that still sets only the old name is caught at startup by
    // assertNoLegacyInstanceRoleEnv rather than silently coming up with no agents.
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'legacy', url: 'https://legacy.example.com', token: 'a'.repeat(32) },
    ]);
    expect(getEnvAgentInstances()).toEqual([]);
  });

  it('reads INSTANCE_AGENTS and ignores INSTANCE_SLAVES when both are set', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      { name: 'current', url: 'https://current.example.com', token: 'b'.repeat(32) },
    ]);
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'legacy', url: 'https://legacy.example.com', token: 'a'.repeat(32) },
    ]);
    const parsed = getEnvAgentInstances();
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe('current');
  });

  it('returns empty array for empty string', () => {
    process.env.INSTANCE_AGENTS = '';
    expect(getEnvAgentInstances()).toEqual([]);
  });

  it('parses a valid single agent entry', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      { name: 'agent1', url: 'https://agent.example.com', token: 'a'.repeat(32) },
    ]);
    const result = getEnvAgentInstances();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'agent1',
      url: 'https://agent.example.com',
      token: 'a'.repeat(32),
    });
  });

  it('parses multiple agent entries', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      { name: 'agent1', url: 'https://agent1.example.com', token: 'a'.repeat(32) },
      { name: 'agent2', url: 'https://agent2.example.com', token: 'b'.repeat(32) },
    ]);
    expect(getEnvAgentInstances()).toHaveLength(2);
  });

  it('filters out agent entries with weak sync tokens', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      { name: 'weak', url: 'https://weak.example.com', token: 'too-short' },
      { name: 'strong', url: 'https://strong.example.com', token: 'a'.repeat(32) },
    ]);
    expect(getEnvAgentInstances().map((instance) => instance.name)).toEqual(['strong']);
  });

  it('returns empty array for non-array JSON', () => {
    process.env.INSTANCE_AGENTS = '{"name":"agent1"}'; // object, not array
    expect(getEnvAgentInstances()).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    const secret = 'malformed-env-token-secret-sentinel';
    process.env.INSTANCE_AGENTS = `[{"token":"${secret}"}`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(getEnvAgentInstances()).toEqual([]);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(secret);
    expect(warnSpy).toHaveBeenCalledWith('Failed to parse INSTANCE_AGENTS environment variable');

    warnSpy.mockRestore();
  });

  it('filters out entries missing required fields', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      { name: 'agent1', url: 'https://agent1.example.com', token: 'a'.repeat(32) }, // valid
      { name: 'agent2', url: 'https://agent2.example.com' }, // missing token
      { name: 'agent3', token: 'tok3' }, // missing url
      { url: 'https://agent4.example.com', token: 'tok4' }, // missing name
    ]);
    const result = getEnvAgentInstances();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('agent1');
  });

  it('filters out entries with empty string fields', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      { name: '', url: 'https://agent.example.com', token: 'tok' }, // empty name
    ]);
    expect(getEnvAgentInstances()).toEqual([]);
  });

  it('filters out non-object entries', () => {
    process.env.INSTANCE_AGENTS = JSON.stringify([
      42,
      null,
      'string',
      { name: 'ok', url: 'https://ok.com', token: 'a'.repeat(32) },
    ]);
    const result = getEnvAgentInstances();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// getSyncIntervalMs
// ---------------------------------------------------------------------------

describe('getSyncIntervalMs', () => {
  it('returns 0 when env var is not set (disabled)', () => {
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('converts seconds to milliseconds', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '60';
    expect(getSyncIntervalMs()).toBe(60_000);
  });

  it('enforces minimum of 30 seconds', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '10';
    expect(getSyncIntervalMs()).toBe(30_000); // clamped to 30s
  });

  it('exactly 30 seconds is allowed', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '30';
    expect(getSyncIntervalMs()).toBe(30_000);
  });

  it('returns 0 for "0"', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '0';
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('returns 0 for negative value', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '-60';
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    process.env.INSTANCE_SYNC_INTERVAL = 'abc';
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('handles large interval correctly', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '3600'; // 1 hour
    expect(getSyncIntervalMs()).toBe(3_600_000);
  });
});

// ---------------------------------------------------------------------------
// isHttpSyncAllowed
// ---------------------------------------------------------------------------

describe('isHttpSyncAllowed', () => {
  it('returns false when env var is not set', () => {
    expect(isHttpSyncAllowed()).toBe(false);
  });

  it('returns true for "true"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = 'true';
    expect(isHttpSyncAllowed()).toBe(true);
  });

  it('returns true for "1"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = '1';
    expect(isHttpSyncAllowed()).toBe(true);
  });

  it('returns false for "false"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = 'false';
    expect(isHttpSyncAllowed()).toBe(false);
  });

  it('returns false for "yes"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = 'yes';
    expect(isHttpSyncAllowed()).toBe(false);
  });

  it('returns false for empty string', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = '';
    expect(isHttpSyncAllowed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInstanceModeFromEnv
// ---------------------------------------------------------------------------

describe('isInstanceModeFromEnv legacy values', () => {
  it('no longer recognizes the pre-rename spellings', () => {
    // Treating these as configured would be the silent failure: getInstanceMode() would return
    // "standalone" while isInstanceModeFromEnv() claimed the mode was pinned by the environment.
    process.env.INSTANCE_MODE = 'master';
    expect(isInstanceModeFromEnv()).toBe(false);
    process.env.INSTANCE_MODE = 'slave';
    expect(isInstanceModeFromEnv()).toBe(false);
  });

  it('rejects an unrecognized mode', () => {
    process.env.INSTANCE_MODE = 'primary';
    expect(isInstanceModeFromEnv()).toBe(false);
  });
});

describe('isInstanceModeFromEnv', () => {
  it('returns false when env var is not set', () => {
    expect(isInstanceModeFromEnv()).toBe(false);
  });

  it('returns true for "controller"', () => {
    process.env.INSTANCE_MODE = 'controller';
    expect(isInstanceModeFromEnv()).toBe(true);
  });

  it('returns true for "agent"', () => {
    process.env.INSTANCE_MODE = 'agent';
    expect(isInstanceModeFromEnv()).toBe(true);
  });

  it('returns true for "standalone"', () => {
    process.env.INSTANCE_MODE = 'standalone';
    expect(isInstanceModeFromEnv()).toBe(true);
  });

  it('returns false for invalid mode', () => {
    process.env.INSTANCE_MODE = 'invalid';
    expect(isInstanceModeFromEnv()).toBe(false);
  });

  it('returns false for empty string', () => {
    process.env.INSTANCE_MODE = '';
    expect(isInstanceModeFromEnv()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSyncTokenFromEnv
// ---------------------------------------------------------------------------

describe('isSyncTokenFromEnv', () => {
  it('returns false when env var is not set', () => {
    expect(isSyncTokenFromEnv()).toBe(false);
  });

  it('returns true when token is configured in the environment', () => {
    process.env.INSTANCE_SYNC_TOKEN = 'a'.repeat(32);
    expect(isSyncTokenFromEnv()).toBe(true);
  });

  it('returns false for empty string token', () => {
    process.env.INSTANCE_SYNC_TOKEN = '';
    expect(isSyncTokenFromEnv()).toBe(false);
  });

  it('treats an invalid non-empty value as configured so it cannot silently fall back to the database', () => {
    process.env.INSTANCE_SYNC_TOKEN = '   ';
    expect(isSyncTokenFromEnv()).toBe(true);
  });
});

describe('sync token enforcement', () => {
  it('does not accept a weak environment token for sync authentication', async () => {
    process.env.INSTANCE_SYNC_TOKEN = 'weak-token';
    await expect(getAgentControllerToken()).rejects.toThrow(/INSTANCE_SYNC_TOKEN.*at least 32/);
  });

  it('rejects weak tokens at the persistence boundary', async () => {
    await expect(setAgentControllerToken('weak-token')).rejects.toThrow(/at least 32/);
  });
});
