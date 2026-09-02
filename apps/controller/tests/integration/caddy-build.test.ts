/**
 * Module selection, the compose override it produces, and the gate it feeds: *desired* modules
 * (what the admin selected) vs *applied* (what the binary was built with). Generation uses the
 * intersection — Caddy rejects a whole document naming a module it lacks.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  const { mkdirSync: mkdir } = require('node:fs');
  const { join: joinPath } = require('node:path');
  const { tmpdir } = require('node:os');
  const dir = joinPath(tmpdir(), `caddy-build-test-${Date.now()}`);
  mkdir(dir, { recursive: true });
  // caddy-build.ts resolves its data directory at module load, so this has to
  // be set before the import below.
  process.env.L4_PORTS_DIR = dir;
  return { db: null as unknown as TestDb, tmpDir: dir };
});

const { createTestDb } = await import('../helpers/db');
const schemaModule = await import('../../src/lib/db/schema');

// Hoisted out of the factory below: createTestDb is async, and a Bun mock factory must be
// synchronous — an async one never resolves and the file hangs.
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

const {
  applyCaddyBuild,
  defaultModuleSpecs,
  generateCaddyBuildOverride,
  getAppliedModuleSpecs,
  getCaddyBuildDiff,
  getCaddyBuildStatus,
  getCaddyModuleAvailability,
  getModuleGateState,
  isDnsProviderUsable,
  isFeatureUsable,
  parseModuleSpecList,
  resolveEnabledModuleIds,
  resolveModuleSpecs,
  sanitizeCaddyBuildSettings,
} = await import(`../../src/lib/caddy-build${fresh()}`);
import { CADDY_MODULES, dnsModuleId } from '../../src/lib/caddy-modules';
import { saveCaddyBuildSettings } from '../../src/lib/settings';
import { installFakeCaddy, type FakeCaddy } from '../helpers/caddy-admin';
import * as schema from '../../src/lib/db/schema';

const OVERRIDE_PATH = join(ctx.tmpDir, 'docker-compose.caddy-build.yml');
const TRIGGER_PATH = join(ctx.tmpDir, 'caddy-build.trigger');
const STATUS_PATH = join(ctx.tmpDir, 'caddy-build.status');
const APPLIED_PATH = join(ctx.tmpDir, 'caddy-build.applied.json');

const L4 = 'github.com/mholt/caddy-l4';
const CORAZA = 'github.com/corazawaf/coraza-caddy/v2';
const BLOCKER = 'github.com/fuomag9/caddy-blocker-plugin';
const CLOUDFLARE = 'github.com/caddy-dns/cloudflare';

/**
 * Pretend a rebuild already completed with these modules. Writes the *applied record* — what the
 * agent produces only after a successful build — not the compose override.
 */
function setAppliedModules(specs: string[]) {
  writeFileSync(APPLIED_PATH, JSON.stringify({ modules: specs.join(' ') }), 'utf-8');
}

beforeEach(async () => {
  for (const path of [OVERRIDE_PATH, TRIGGER_PATH, STATUS_PATH, APPLIED_PATH]) {
    rmSync(path, { force: true });
  }
  mkdirSync(ctx.tmpDir, { recursive: true });
  await ctx.db.delete(schema.settings);
});

describe('selection resolution', () => {
  it('treats an unknown module id as enabled', async () => {
    // A module added to the catalog after an operator last saved must appear
    // on, matching the image they are already running.
    const ids = resolveEnabledModuleIds({ modules: { 'caddy-l4': true }, customModules: [] });
    expect(ids).toEqual(CADDY_MODULES.map((m) => m.id));
  });

  it('drops only the modules explicitly set to false', () => {
    const specs = resolveModuleSpecs({ modules: { 'caddy-l4': false }, customModules: [] });
    expect(specs).not.toContain(L4);
    expect(specs).toContain(CORAZA);
  });

  it('includes enabled custom modules with their version', () => {
    const specs = resolveModuleSpecs({
      modules: {},
      customModules: [
        { modulePath: 'github.com/o/pinned', version: 'v1.2.3', enabled: true },
        { modulePath: 'github.com/o/off', enabled: false },
      ],
    });
    expect(specs).toContain('github.com/o/pinned@v1.2.3');
    expect(specs).not.toContain('github.com/o/off');
  });

  it('silently skips a stored custom module that no longer validates', () => {
    // Validation happens on save, but a hand-edited settings row or an older
    // release's data must not be able to inject a shell fragment into the build.
    const specs = resolveModuleSpecs({
      modules: {},
      customModules: [{ modulePath: 'github.com/o/r; rm -rf /', enabled: true }],
    });
    expect(specs.join(' ')).not.toContain('rm -rf');
  });

  it('produces a stable order regardless of toggle order', () => {
    const a = resolveModuleSpecs({
      modules: { 'caddy-l4': true, 'coraza-waf': true },
      customModules: [],
    });
    const b = resolveModuleSpecs({
      modules: { 'coraza-waf': true, 'caddy-l4': true },
      customModules: [],
    });
    expect(a).toEqual(b);
  });
});

describe('applied module specs', () => {
  it('reports the full catalog when no rebuild has happened', () => {
    // No applied record means the container is still the shipped image, which is built with
    // everything. Returning an empty list here would make config generation drop every handler.
    expect(getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());
  });

  it('reads back exactly what the applied record holds', () => {
    setAppliedModules([L4, CORAZA]);
    expect(getAppliedModuleSpecs()).toEqual([CORAZA, L4].sort());
  });

  it('ignores the compose override entirely', () => {
    // The override is the build's *input*, written before anything is compiled. Reading it as the
    // applied set is exactly the bug this split fixes, so a stray override must not move the answer.
    writeFileSync(OVERRIDE_PATH, generateCaddyBuildOverride([L4]), 'utf-8');
    expect(getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());
  });

  it('parses a whitespace-separated build arg', () => {
    expect(parseModuleSpecList(`  ${L4}   ${CORAZA}\n`)).toEqual([CORAZA, L4].sort());
  });
});

describe("the agent's applied record", () => {
  it('parses the exact JSON shape entrypoint.sh writes', () => {
    // Verified by running the real script: byte-for-byte what write_applied_modules produces,
    // including the two-space indent from its heredoc and the trailing newline. The app and the
    // agent are separate programs in separate containers, so nothing else checks this seam.
    const fromAgent = [
      '{',
      '  "modules": "github.com/mholt/caddy-l4 github.com/o/x@v1.2.3",',
      '  "appliedAt": "2026-08-25T00:33:17Z"',
      '}',
      '',
    ].join('\n');
    writeFileSync(APPLIED_PATH, fromAgent, 'utf-8');

    expect(getAppliedModuleSpecs()).toEqual(['github.com/mholt/caddy-l4', 'github.com/o/x@v1.2.3']);
  });

  it('falls back to the full catalog when the record is absent or unreadable', () => {
    // Absent means no rebuild has happened, so the container is still the shipped image. Claiming
    // an empty module set would drop every plugin-backed handler on a perfectly healthy install.
    expect(getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());

    writeFileSync(APPLIED_PATH, '{"modules": ', 'utf-8');
    expect(getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());

    writeFileSync(APPLIED_PATH, '{"modules": ["not", "a", "string"]}', 'utf-8');
    expect(getAppliedModuleSpecs()).toEqual(defaultModuleSpecs());
  });
});

describe('diff', () => {
  it('reports no rebuild needed for a default install', async () => {
    const diff = await getCaddyBuildDiff();
    expect(diff.needsRebuild).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('names what a rebuild would add and remove', async () => {
    setAppliedModules([L4, CORAZA]);
    await saveCaddyBuildSettings({
      modules: Object.fromEntries(CADDY_MODULES.map((m) => [m.id, m.id === 'caddy-l4'])),
      customModules: [{ modulePath: 'github.com/o/new', enabled: true }],
    });

    const diff = await getCaddyBuildDiff();
    expect(diff.needsRebuild).toBe(true);
    expect(diff.added).toEqual(['github.com/o/new']);
    expect(diff.removed).toEqual([CORAZA]);
  });
});

describe('feature gating', () => {
  it('allows a feature only when it is both selected and compiled in', async () => {
    setAppliedModules([L4, BLOCKER]);
    await saveCaddyBuildSettings({
      modules: Object.fromEntries(
        CADDY_MODULES.map((m) => [m.id, m.id === 'caddy-l4' || m.id === 'coraza-waf']),
      ),
      customModules: [],
    });

    const availability = await getCaddyModuleAvailability();
    // Selected and built: usable.
    expect(isFeatureUsable(availability, 'l4')).toBe(true);
    // Selected but not built yet — emitting it would fail the whole config.
    expect(isFeatureUsable(availability, 'waf')).toBe(false);
    // Built but deselected — the admin is on their way to removing it.
    expect(isFeatureUsable(availability, 'geoblock')).toBe(false);
  });

  it('treats DNS-01 per provider, not as one flag', async () => {
    setAppliedModules([CLOUDFLARE]);
    await saveCaddyBuildSettings({
      modules: Object.fromEntries(
        CADDY_MODULES.map((m) => [m.id, m.id === dnsModuleId('cloudflare')]),
      ),
      customModules: [],
    });

    const availability = await getCaddyModuleAvailability();
    expect(isDnsProviderUsable(availability, 'cloudflare')).toBe(true);
    expect(isDnsProviderUsable(availability, 'route53')).toBe(false);
    expect(isDnsProviderUsable(availability, 'not-a-provider')).toBe(false);
  });

  it('ignores the @version suffix when matching a custom module path', async () => {
    setAppliedModules([`${L4}@v0.0.1`]);
    const availability = await getCaddyModuleAvailability();
    expect(availability.appliedPaths.has(L4)).toBe(true);
  });
});

describe('module gate state for the UI', () => {
  it('gates on the selection, not on the built image', async () => {
    // Following the applied set would leave a freshly enabled feature greyed out after being
    // switched on, which reads as broken. pendingRebuild is what says "saved, not live yet".
    setAppliedModules([L4]);
    await saveCaddyBuildSettings({ modules: {}, customModules: [] });

    const gate = await getModuleGateState();
    expect(gate.features.waf).toBe(true);
    expect(gate.pendingRebuild).toBe(true);
    expect(gate.moduleNames.waf).toBe('Coraza WAF');
    expect(gate.enabledModuleIds).toContain(dnsModuleId('cloudflare'));
  });

  it('reports a feature as off once its module is deselected', async () => {
    await saveCaddyBuildSettings({ modules: { 'coraza-waf': false }, customModules: [] });
    const gate = await getModuleGateState();
    expect(gate.features.waf).toBe(false);
    expect(gate.features.geoblock).toBe(true);
  });
});

describe('sanitizeCaddyBuildSettings', () => {
  it('drops module ids that are not in the catalog', () => {
    const result = sanitizeCaddyBuildSettings({
      modules: { 'caddy-l4': false, 'not-a-module': false },
      customModules: [],
    });
    expect(result.modules).toEqual({ 'caddy-l4': false });
  });

  it('normalizes custom module paths', () => {
    const result = sanitizeCaddyBuildSettings({
      customModules: [{ modulePath: ' https://github.com/o/r/ ', version: ' v1 ', enabled: true }],
    });
    expect(result.customModules).toEqual([
      { modulePath: 'github.com/o/r', version: 'v1', enabled: true },
    ]);
  });

  it('rejects an invalid custom module rather than dropping it', () => {
    // Dropping it silently would let a typo look like a successful save and
    // leave the operator waiting for a plugin that was never requested.
    expect(() =>
      sanitizeCaddyBuildSettings({ customModules: [{ modulePath: 'nope', enabled: true }] }),
    ).toThrow(/host and a path/);
  });

  it('rejects a duplicate custom module path', () => {
    expect(() =>
      sanitizeCaddyBuildSettings({
        customModules: [
          { modulePath: 'github.com/o/r', enabled: true },
          { modulePath: 'https://github.com/o/r', enabled: true },
        ],
      }),
    ).toThrow(/Duplicate/);
  });
});

describe('applyCaddyBuild', () => {
  it('regenerates the config before signalling the rebuild', async () => {
    // Caddy runs with --resume, so the recreated container reloads the last autosaved config. If
    // that still names a module the new binary does not have, Caddy refuses to load it and the
    // proxy stays down — with no way in, because the admin API never comes up either. The apply
    // has to happen before the trigger is written, not after.
    const caddy: FakeCaddy = installFakeCaddy();
    await saveCaddyBuildSettings({ modules: { 'coraza-waf': false }, customModules: [] });

    await applyCaddyBuild();

    expect(caddy.loads.length).toBeGreaterThan(0);
    // And the trigger only exists once that apply has happened.
    expect(existsSync(TRIGGER_PATH)).toBe(true);
  });

  it('does not signal a rebuild when the config apply fails', async () => {
    // Writing the trigger anyway would hand the agent a rebuild whose new
    // binary is guaranteed not to match the config Caddy will resume from.
    const caddy: FakeCaddy = installFakeCaddy();
    caddy.failWith(500, 'nope');
    await saveCaddyBuildSettings({ modules: {}, customModules: [] });

    await expect(applyCaddyBuild()).rejects.toThrow();
    expect(existsSync(TRIGGER_PATH)).toBe(false);
  });

  it('writes an override and a trigger the agent can act on', async () => {
    await saveCaddyBuildSettings({ modules: { 'caddy-l4': false }, customModules: [] });

    const status = await applyCaddyBuild();
    expect(status.state).toBe('pending');
    expect(existsSync(OVERRIDE_PATH)).toBe(true);
    expect(existsSync(TRIGGER_PATH)).toBe(true);
    // The override carries the desired list into the build.
    expect(readFileSync(OVERRIDE_PATH, 'utf-8')).toContain('CADDY_MODULES:');
  });

  it('does not claim the new modules are applied until the build succeeds', async () => {
    // Requesting a rebuild changes nothing about the binary that is running. Treating the request
    // as already landed is how the applied set gets poisoned: config generation would emit handlers
    // for a module the live binary lacks, and Caddy rejects such a document wholesale.
    setAppliedModules([L4, CORAZA]);
    await saveCaddyBuildSettings({
      modules: Object.fromEntries(CADDY_MODULES.map((m) => [m.id, true])),
      customModules: [],
    });

    await applyCaddyBuild();

    // Still the old binary's module set, and the diff still says a rebuild is
    // outstanding — it only settles once the agent records success.
    expect(getAppliedModuleSpecs()).toEqual([CORAZA, L4].sort());
    expect((await getCaddyBuildDiff()).needsRebuild).toBe(true);
  });

  it('leaves the applied set untouched when a build never completes', async () => {
    // A failed xcaddy compile is routine. The override stays on disk either way, so if that file
    // were the applied record the wrong answer would persist across restarts.
    setAppliedModules([L4]);
    await saveCaddyBuildSettings({
      modules: Object.fromEntries(CADDY_MODULES.map((m) => [m.id, true])),
      customModules: [],
    });

    await applyCaddyBuild(); // agent never reports success

    expect(getAppliedModuleSpecs()).toEqual([L4]);
    expect(isFeatureUsable(await getCaddyModuleAvailability(), 'waf')).toBe(false);
  });

  it('reports the new set once the agent records a successful build', async () => {
    setAppliedModules([L4]);
    await saveCaddyBuildSettings({ modules: {}, customModules: [] });
    await applyCaddyBuild();

    // What the agent does after build + up + healthy.
    setAppliedModules(defaultModuleSpecs());

    expect((await getCaddyBuildDiff()).needsRebuild).toBe(false);
    expect(isFeatureUsable(await getCaddyModuleAvailability(), 'waf')).toBe(true);
  });

  it('refuses to trigger a build with an invalid custom module', async () => {
    // Otherwise the failure surfaces minutes later as an opaque compile error.
    await saveCaddyBuildSettings({
      modules: {},
      customModules: [{ modulePath: 'github.com/o/r && evil', enabled: true }],
    });
    await expect(applyCaddyBuild()).rejects.toThrow(/Invalid module path/);
    expect(existsSync(TRIGGER_PATH)).toBe(false);
  });
});

describe('build status', () => {
  it('is idle before the agent has written anything', () => {
    expect(getCaddyBuildStatus()).toEqual({ state: 'idle' });
  });

  it('reads what the agent wrote', () => {
    writeFileSync(
      STATUS_PATH,
      JSON.stringify({ state: 'building', message: 'compiling' }),
      'utf-8',
    );
    expect(getCaddyBuildStatus()).toMatchObject({ state: 'building', message: 'compiling' });
  });

  it('falls back to idle rather than throwing on a truncated status file', () => {
    // The agent writes this file while the web container may be reading it.
    writeFileSync(STATUS_PATH, '{"state": "buil', 'utf-8');
    expect(getCaddyBuildStatus()).toEqual({ state: 'idle' });
  });
});
