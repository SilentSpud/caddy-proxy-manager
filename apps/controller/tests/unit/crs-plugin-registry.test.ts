/**
 * src/lib/crs-plugins/registry.ts against a fake GitHub: reading the registry, resolving a
 * release, and refusing a plugin that could not load in Caddy before anything is stored.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  fetchCrsPluginRelease,
  fetchCrsRegistry,
  parseCrsRegistry,
  resetCrsRegistryCache,
  resolveCrsPluginVersion,
} from '../../src/lib/crs-plugins/registry';
import { DomainError } from '../../src/lib/domain-error';
import { FAKE_BOT, REGISTRY, WORDPRESS, fakeGithub } from '../helpers/fake-github';

const WORDPRESS_REPO = 'coreruleset/wordpress-rule-exclusions-plugin';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof DomainError ? error.code : String(error);
  }
  return undefined;
}

beforeEach(() => resetCrsRegistryCache());

describe('parseCrsRegistry', () => {
  it('keeps installable entries, sorted, and drops private or malformed ones', () => {
    const entries = parseCrsRegistry({
      plugins: [
        ...REGISTRY.plugins,
        { name: 'no-range', repository: 'https://github.com/a/b', type: 'official' },
        {
          name: 'elsewhere',
          repository: 'https://gitlab.com/a/b',
          type: 'official',
          status: 'tested',
          rule_id_range: { start: 9530000, end: 9530999 },
        },
      ],
    });
    expect(entries.map((entry) => entry.name)).toEqual(['fake-bot', 'wordpress-rule-exclusions']);
    expect(entries[1]).toMatchObject({
      ruleIdStart: 9507000,
      ruleIdEnd: 9507999,
      type: 'official',
    });
  });

  it('marks plugins known not to install, and only those', () => {
    const entries = parseCrsRegistry(REGISTRY);
    expect(entries.find((entry) => entry.name === 'fake-bot')?.unsupported).toBe('files');
    expect(
      entries.find((entry) => entry.name === 'wordpress-rule-exclusions')?.unsupported,
    ).toBeNull();
  });

  it('reads nothing out of a document that is not a registry', () => {
    expect(parseCrsRegistry(null)).toEqual([]);
    expect(parseCrsRegistry({ plugins: 'x' })).toEqual([]);
  });
});

describe('fetchCrsRegistry', () => {
  it('caches the listing rather than asking GitHub on every page load', async () => {
    const github = fakeGithub({});
    await fetchCrsRegistry(github.fetcher);
    await fetchCrsRegistry(github.fetcher);
    expect(github.requested).toHaveLength(1);
  });

  it('names a rate limit, which is the likely failure unauthenticated', async () => {
    const github = fakeGithub({});
    github.status.rateLimited = true;
    expect(await codeOf(fetchCrsRegistry(github.fetcher))).toBe('crsPluginRateLimited');
  });
});

describe('resolveCrsPluginVersion', () => {
  it('pins to the latest release tag', async () => {
    const github = fakeGithub({ [WORDPRESS_REPO]: WORDPRESS });
    expect(
      await resolveCrsPluginVersion(
        { repository: `https://github.com/${WORDPRESS_REPO}` },
        github.fetcher,
      ),
    ).toBe('v1.2.0');
  });

  it("falls back to the default branch's commit for a plugin that never tagged one", async () => {
    const sha = 'a'.repeat(40);
    const github = fakeGithub({ 'x/y-plugin': { release: null, head: sha, files: {} } });
    expect(
      await resolveCrsPluginVersion(
        { repository: 'https://github.com/x/y-plugin' },
        github.fetcher,
      ),
    ).toBe(sha);
  });
});

describe('fetchCrsPluginRelease', () => {
  const [wordpress, fakeBot] = [REGISTRY.plugins[0], REGISTRY.plugins[1]].map(
    (raw) => parseCrsRegistry({ plugins: [raw] })[0],
  );

  it('reads the three files and the descriptor, from the repository alone', async () => {
    const github = fakeGithub({ [WORDPRESS_REPO]: WORDPRESS });
    const release = await fetchCrsPluginRelease(wordpress, 'v1.2.0', github.fetcher);
    expect(release.version).toBe('v1.2.0');
    expect(release.description).toBe('CRS rule exclusions for WordPress');
    expect(release.configRules).toBe('# enabled by default');
    expect(release.beforeRules).toContain('id:9507100');
    expect(release.afterRules).toBe('');
    // The listing's download_url points elsewhere; files come from the repository it listed.
    expect(github.requested.some((url) => url.includes('evil.example'))).toBe(false);
  });

  it('refuses a plugin that needs a Lua script, naming the line', async () => {
    const github = fakeGithub({ 'coreruleset/fake-bot-plugin': FAKE_BOT });
    let caught: unknown;
    try {
      await fetchCrsPluginRelease(fakeBot, 'v1.1.0', github.fetcher);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('crsPluginRejected');
    expect((caught as DomainError).message).toContain('@inspectFile fake-bot.lua');
  });

  it('refuses a plugin whose descriptor excludes Coraza', async () => {
    const github = fakeGithub({
      [WORDPRESS_REPO]: {
        ...WORDPRESS,
        descriptor: 'plugin:\n  description: x\ncompatibility:\n  engines:\n    - modsecurity2\n',
      },
    });
    expect(await codeOf(fetchCrsPluginRelease(wordpress, 'v1.2.0', github.fetcher))).toBe(
      'crsPluginEngineIncompatible',
    );
  });

  it('refuses a repository without a plugins folder', async () => {
    const github = fakeGithub({ [WORDPRESS_REPO]: { release: 'v9', files: {} } });
    expect(await codeOf(fetchCrsPluginRelease(wordpress, 'v9', github.fetcher))).toBe(
      'crsPluginNoRuleFiles',
    );
  });
});
