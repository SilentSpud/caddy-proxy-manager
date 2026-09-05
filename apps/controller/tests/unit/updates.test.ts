/**
 * Release comparison and registry-path parsing.
 *
 * The comparison is the part worth pinning. A wrong answer either hides a release or invents one,
 * and the prerelease rules are the easy half to get backwards: 3.0.0-beta.2 precedes 3.0.0, so a
 * naive string or field comparison announces an "update" to the beta an operator just left.
 */
import { describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';

// lib/updates imports lib/settings for its cache, which reaches the database at module load. The
// pure helpers under test never touch it.
vi.mock('@/src/lib/settings', () => ({
  getSetting: async () => null,
  setSetting: async () => {},
}));

const { compareSemver, isNewer, newestRelease, parseRepository, parseSemver } = await import(
  '@/src/lib/updates'
);

/** The tag list ghcr.io actually returns for this project, verified against the live registry. */
const REAL_TAGS = ['3.0.0-beta.1', 'latest', 'sha-c570c7c', '3.0.0-beta.2', 'sha-cab2ee5'];

describe('release tags', () => {
  it('accepts a release and rejects the moving aliases beside it', () => {
    expect(parseSemver('3.0.0')).toMatchObject({ major: 3, minor: 0, patch: 0, prerelease: [] });
    expect(parseSemver('v3.1.4')).toMatchObject({ major: 3, minor: 1, patch: 4 });
    expect(parseSemver('3.0.0-beta.2')).toMatchObject({ prerelease: ['beta', '2'] });

    // All published by the same build, and none of them names a comparable version.
    for (const alias of ['latest', 'main', '3', '3.0', 'sha-cab2ee5', 'develop']) {
      expect(parseSemver(alias)).toBeNull();
    }
  });

  it('picks the newest release out of a real tag list', () => {
    expect(newestRelease(REAL_TAGS)).toBe('3.0.0-beta.2');
  });

  it('returns nothing when a repository has no releases yet', () => {
    expect(newestRelease(['latest', 'sha-abc1234'])).toBeNull();
    expect(newestRelease([])).toBeNull();
  });
});

describe('version precedence', () => {
  const order = (a: string, b: string) =>
    Math.sign(compareSemver(parseSemver(a)!, parseSemver(b)!));

  it('orders by major, then minor, then patch', () => {
    expect(order('4.0.0', '3.9.9')).toBe(1);
    expect(order('3.1.0', '3.0.9')).toBe(1);
    expect(order('3.0.2', '3.0.10')).toBe(-1); // numeric, not lexical
    expect(order('3.0.0', '3.0.0')).toBe(0);
  });

  it('puts a prerelease below the release it leads to', () => {
    expect(order('3.0.0-beta.2', '3.0.0')).toBe(-1);
    expect(order('3.0.0', '3.0.0-beta.2')).toBe(1);
  });

  it('orders prerelease identifiers by semver rules', () => {
    expect(order('3.0.0-beta.2', '3.0.0-beta.10')).toBe(-1); // numeric identifiers compare numerically
    expect(order('3.0.0-alpha.1', '3.0.0-beta.1')).toBe(-1);
    expect(order('3.0.0-beta', '3.0.0-beta.1')).toBe(-1); // fewer fields sorts first
    expect(order('3.0.0-1', '3.0.0-alpha')).toBe(-1); // numeric below alphanumeric
  });
});

describe('deciding whether to tell the operator', () => {
  it('reports an update only when the registry is genuinely ahead', () => {
    expect(isNewer('3.0.0', '3.0.1')).toBe(true);
    expect(isNewer('3.0.0-beta.2', '3.0.0')).toBe(true);
    expect(isNewer('3.0.0', '3.0.0')).toBe(false);
    // The running build is ahead of anything published — a dev or locally built image.
    expect(isNewer('3.1.0', '3.0.0')).toBe(false);
  });

  it('stays quiet when the comparison cannot be made', () => {
    // A wrong "yes" sends someone chasing an update that does not exist, so every unknown is a no.
    expect(isNewer('unknown', '3.0.0')).toBe(false);
    expect(isNewer('3.0.0', null)).toBe(false);
    expect(isNewer('3.0.0', 'latest')).toBe(false);
  });

  it('is quiet for this build against the registry as it stands', () => {
    // The end-to-end shape of the feature: real tags, the version this package declares, no notice.
    expect(isNewer('3.0.0-beta.2', newestRelease(REAL_TAGS))).toBe(false);
  });
});

describe('the repository setting', () => {
  it('accepts a registry path, with or without a scheme or trailing slash', () => {
    expect(parseRepository('ghcr.io/silentspud/caddy-proxy-manager')).toEqual({
      host: 'ghcr.io',
      path: 'silentspud/caddy-proxy-manager',
    });
    // The substitution the feature exists for.
    expect(parseRepository('ghcr.io/somerandomuser/caddy-proxy-manager')).toEqual({
      host: 'ghcr.io',
      path: 'somerandomuser/caddy-proxy-manager',
    });
    expect(parseRepository('https://ghcr.io/owner/name/')).toEqual({
      host: 'ghcr.io',
      path: 'owner/name',
    });
    expect(parseRepository('registry.example.com:5000/team/app')).toMatchObject({
      host: 'registry.example.com:5000',
    });
  });

  it('refuses anything that is not a registry reference', () => {
    // This becomes a URL the server fetches, so a shape it cannot vouch for is refused outright.
    for (const bad of ['', 'ghcr.io', 'file:///etc/passwd', 'ghcr.io/UPPER/case', 'a b/c']) {
      expect(parseRepository(bad)).toBeNull();
    }
  });
});
