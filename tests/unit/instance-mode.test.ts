/**
 * The master/slave role names are gone. Nothing translates them any more, which makes the
 * *rejection* the load-bearing behaviour: an unrecognized instance mode falls back to
 * "standalone", so a value that is quietly not understood turns an agent into an instance serving
 * its own configuration instead of the controller's, and a controller into one pushing to nobody.
 *
 * Stored settings are rewritten by runInstanceRoleRename() (see
 * tests/integration/instance-role-rename.test.ts). Environment variables cannot be rewritten from
 * inside the process, so they are refused at startup instead — that is what these tests pin.
 */
import { describe, expect, it } from 'bun:test';
import {
  assertNoLegacyInstanceRoleEnv,
  LEGACY_INSTANCE_MODES,
  normalizeInstanceMode,
  type InstanceMode,
} from '../../src/lib/instance-mode';

describe('normalizeInstanceMode', () => {
  it('passes the three real roles through unchanged', () => {
    expect(normalizeInstanceMode('standalone')).toBe('standalone');
    expect(normalizeInstanceMode('controller')).toBe('controller');
    expect(normalizeInstanceMode('agent')).toBe('agent');
  });

  it('does not accept the pre-rename spellings', () => {
    expect(normalizeInstanceMode('master')).toBeNull();
    expect(normalizeInstanceMode('slave')).toBeNull();
  });

  it('returns null for unrecognized values so callers keep their own fallback', () => {
    expect(normalizeInstanceMode('primary')).toBeNull();
    expect(normalizeInstanceMode('')).toBeNull();
    expect(normalizeInstanceMode(undefined)).toBeNull();
    expect(normalizeInstanceMode(null)).toBeNull();
    expect(normalizeInstanceMode(42)).toBeNull();
    expect(normalizeInstanceMode({})).toBeNull();
  });

  it('is case sensitive — env values are not normalized for case elsewhere', () => {
    expect(normalizeInstanceMode('Controller')).toBeNull();
    expect(normalizeInstanceMode('AGENT')).toBeNull();
  });

  it('never returns anything outside the three roles', () => {
    const roles: InstanceMode[] = ['standalone', 'controller', 'agent'];
    for (const input of ['standalone', 'controller', 'agent']) {
      expect(roles).toContain(normalizeInstanceMode(input) as InstanceMode);
    }
  });
});

describe('LEGACY_INSTANCE_MODES', () => {
  it('maps each old name to its replacement, for the migration and the error message', () => {
    expect(LEGACY_INSTANCE_MODES).toEqual({ master: 'controller', slave: 'agent' });
  });
});

describe('assertNoLegacyInstanceRoleEnv', () => {
  it('accepts an environment with no instance variables set', () => {
    expect(() => assertNoLegacyInstanceRoleEnv({})).not.toThrow();
  });

  it('accepts the current spellings', () => {
    expect(() =>
      assertNoLegacyInstanceRoleEnv({ INSTANCE_MODE: 'agent', INSTANCE_AGENTS: '[]' }),
    ).not.toThrow();
  });

  it.each(['master', 'slave'])('rejects INSTANCE_MODE=%s', (mode) => {
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_MODE: mode })).toThrow(/INSTANCE_MODE/);
  });

  it('names the replacement role in the error, so the fix is in the message', () => {
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_MODE: 'slave' })).toThrow(
      /INSTANCE_MODE=agent/,
    );
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_MODE: 'master' })).toThrow(
      /INSTANCE_MODE=controller/,
    );
  });

  it('rejects INSTANCE_SLAVES when INSTANCE_AGENTS is not set', () => {
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_SLAVES: '[]' })).toThrow(
      /INSTANCE_SLAVES/,
    );
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_SLAVES: '[]' })).toThrow(
      /INSTANCE_AGENTS/,
    );
  });

  it('allows a leftover INSTANCE_SLAVES when INSTANCE_AGENTS supersedes it', () => {
    // Behaviour is already correct here — INSTANCE_AGENTS is what gets read — so failing the
    // deployment over an unused line would be pure obstruction. It warns instead.
    expect(() =>
      assertNoLegacyInstanceRoleEnv({ INSTANCE_SLAVES: '[]', INSTANCE_AGENTS: '[]' }),
    ).not.toThrow();
  });

  it('ignores an empty INSTANCE_SLAVES', () => {
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_SLAVES: '' })).not.toThrow();
    expect(() => assertNoLegacyInstanceRoleEnv({ INSTANCE_SLAVES: '   ' })).not.toThrow();
  });

  it('reads process.env when no environment is passed', () => {
    const previous = process.env.INSTANCE_MODE;
    try {
      process.env.INSTANCE_MODE = 'master';
      expect(() => assertNoLegacyInstanceRoleEnv()).toThrow(/INSTANCE_MODE/);
    } finally {
      if (previous === undefined) delete process.env.INSTANCE_MODE;
      else process.env.INSTANCE_MODE = previous;
    }
  });
});
