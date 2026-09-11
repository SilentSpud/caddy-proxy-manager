/**
 * The settings home's tile statuses. These are the claims the "needs attention" band makes, so
 * each one is pinned to the condition that justifies it - a tile that cries wolf is worse than no
 * tile, and a silent one hides a misconfiguration that looks fine on every individual page.
 */
import { describe, it, expect } from 'bun:test';
import { needsAttention, sectionHealth, type HealthInput } from '../../src/lib/settings/health';

/**
 * A GeoipView, defaulted to a healthy deployment.
 *
 * One builder rather than a literal per case: the view grows fields (the update check added three),
 * and eight copies would mean eight edits every time - which is how fixtures drift from the type.
 */
function geoipView(overrides: Partial<HealthInput['geoip']> = {}): HealthInput['geoip'] {
  return {
    enabled: false,
    inferred: false,
    source: 'default',
    accountId: '',
    hasLicenseKey: false,
    installedEditions: [],
    databaseAgeDays: null,
    lastCheckedAt: new Date().toISOString(),
    checkError: null,
    editionsBehind: [],
    ...overrides,
  };
}

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    dnsProvider: { providers: { cloudflare: {} }, default: 'cloudflare' },
    acmeConfigured: false,
    certificateCount: 12,
    trustedProxies: { ranges: ['10.0.0.0/8'] },
    defaultResponse: { mode: 'abort' } as HealthInput['defaultResponse'],
    geoBlock: null,
    geoip: geoipView({ enabled: false, installedEditions: [], databaseAgeDays: null }),
    analytics: {
      enabled: false,
      inferred: false,
      source: 'default',
      url: '',
      user: '',
      database: '',
      retentionDays: 30,
      hasPassword: false,
    },
    metrics: { enabled: false },
    caddyBuild: null,
    oauthProviderCount: 0,
    agentsConnected: 1,
    agentsPaired: 1,
    stagedKeys: new Set<string>(),
    ...overrides,
  };
}

function find(sections: ReturnType<typeof sectionHealth>, id: string) {
  const section = sections.find((entry) => entry.id === id);
  if (!section) throw new Error(`no section ${id}`);
  return section;
}

describe('sectionHealth', () => {
  it('reports a healthy deployment with nothing needing attention', () => {
    expect(needsAttention(sectionHealth(input()))).toHaveLength(0);
  });

  it('flags geo-block running without a GeoIP database', () => {
    const sections = sectionHealth(
      input({
        geoBlock: { enabled: true, block_countries: ['CN'] } as HealthInput['geoBlock'],
        geoip: geoipView({ enabled: true, installedEditions: [], databaseAgeDays: null }),
      }),
    );

    expect(find(sections, 'geoblock').status).toBe('attention');
    expect(find(sections, 'geoip').status).toBe('attention');
    expect(needsAttention(sections).length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag geo-block once a database is installed', () => {
    const sections = sectionHealth(
      input({
        geoBlock: { enabled: true, block_countries: ['CN'] } as HealthInput['geoBlock'],
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 2,
        }),
      }),
    );

    expect(find(sections, 'geoblock').status).toBe('ok');
    expect(find(sections, 'geoip').status).toBe('ok');
  });

  it('flags geo-block with no trusted proxy ranges, where every client IP is the proxy', () => {
    const sections = sectionHealth(
      input({
        geoBlock: { enabled: true, block_countries: ['CN'] } as HealthInput['geoBlock'],
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 2,
        }),
        trustedProxies: { ranges: [] },
      }),
    );

    const proxies = find(sections, 'trusted-proxies');
    expect(proxies.status).toBe('attention');
    expect(proxies.detail).toContain('real client IP');
  });

  it('leaves trusted proxies alone when geo-block is off', () => {
    const sections = sectionHealth(input({ trustedProxies: { ranges: [] }, geoBlock: null }));

    // Unset, not broken: plenty of deployments have no proxy in front of them.
    expect(find(sections, 'trusted-proxies').status).toBe('unset');
  });

  it('does not cry stale on age alone, because MaxMind may simply not have published', () => {
    // The whole reason the update check exists: an old file is only a fault if something newer
    // was available and was not fetched.
    const sections = sectionHealth(
      input({
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 41,
          editionsBehind: [],
        }),
      }),
    );

    const geoip = find(sections, 'geoip');
    expect(geoip.status).toBe('ok');
    expect(geoip.value).toContain('41 days old');
  });

  it('flags a database MaxMind has already superseded', () => {
    const sections = sectionHealth(
      input({
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country', 'GeoLite2-ASN'],
          databaseAgeDays: 9,
          editionsBehind: ['GeoLite2-Country'],
        }),
      }),
    );

    const geoip = find(sections, 'geoip');
    expect(geoip.status).toBe('attention');
    expect(geoip.value).toBe('1 of 2 databases out of date');
    expect(geoip.detail).toContain('geoipupdate is not fetching');
  });

  it('flags an update check that has not run for a day', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const sections = sectionHealth(
      input({
        now,
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 1,
          lastCheckedAt: new Date(now - 30 * 60 * 60 * 1000).toISOString(),
        }),
      }),
    );

    const geoip = find(sections, 'geoip');
    expect(geoip.status).toBe('attention');
    expect(geoip.detail).toContain('not been asked for updates recently');
  });

  it('reports why the last update check failed', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const sections = sectionHealth(
      input({
        now,
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 1,
          lastCheckedAt: new Date(now - 30 * 60 * 60 * 1000).toISOString(),
          checkError: 'MaxMind rejected the account ID or licence key',
        }),
      }),
    );

    expect(find(sections, 'geoip').detail).toContain('rejected the account ID');
  });

  it('treats a check that has never run as stalled', () => {
    const sections = sectionHealth(
      input({
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 1,
          lastCheckedAt: null,
        }),
      }),
    );

    expect(find(sections, 'geoip').status).toBe('attention');
  });

  it('tolerates a database a few days old, since GeoLite2 ships twice a week', () => {
    const sections = sectionHealth(
      input({
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 4,
        }),
      }),
    );

    expect(find(sections, 'geoip').status).toBe('ok');
  });

  it('flags geo-block matching against a superseded database, not just a missing one', () => {
    const sections = sectionHealth(
      input({
        geoBlock: { enabled: true, block_countries: ['CN'] } as HealthInput['geoBlock'],
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 60,
          editionsBehind: ['GeoLite2-Country'],
        }),
      }),
    );

    const geoblock = find(sections, 'geoblock');
    expect(geoblock.status).toBe('attention');
    expect(geoblock.detail).toContain('wrong country');
  });

  it('says "updated today" rather than "0 days old"', () => {
    const sections = sectionHealth(
      input({
        geoip: geoipView({
          enabled: true,
          installedEditions: ['GeoLite2-Country'],
          databaseAgeDays: 0,
        }),
      }),
    );

    expect(find(sections, 'geoip').value).toContain('updated today');
  });

  it('flags a paired agent that is not connected', () => {
    const sections = sectionHealth(input({ agentsPaired: 2, agentsConnected: 0 }));

    expect(find(sections, 'agent').status).toBe('attention');
    expect(find(sections, 'agent').detail).toContain('cannot reach Caddy');
  });

  it('treats no agent at all as unset rather than broken', () => {
    const sections = sectionHealth(input({ agentsPaired: 0, agentsConnected: 0 }));

    expect(find(sections, 'agent').status).toBe('unset');
    expect(needsAttention(sections)).toHaveLength(0);
  });

  it('marks an env-managed setting as such rather than as a fault', () => {
    const sections = sectionHealth(
      input({
        analytics: {
          enabled: true,
          inferred: false,
          source: 'environment',
          url: 'http://ch',
          user: 'u',
          database: 'd',
          retentionDays: 30,
          hasPassword: true,
        },
      }),
    );

    const analytics = find(sections, 'analytics');
    expect(analytics.status).toBe('env');
    expect(needsAttention(sections)).toHaveLength(0);
  });

  it('reports a missing DNS provider as unset with a reason', () => {
    const sections = sectionHealth(input({ dnsProvider: { providers: {}, default: null } }));

    const dns = find(sections, 'dns-providers');
    expect(dns.status).toBe('unset');
    expect(dns.detail).toContain('Wildcard');
  });

  it('marks the tile whose storage key an operator has staged', () => {
    const sections = sectionHealth(input({ stagedKeys: new Set(['trusted_proxies']) }));

    expect(find(sections, 'trusted-proxies').staged).toBe(true);
    expect(find(sections, 'acme').staged).toBe(false);
  });

  it('counts a staged legacy cloudflare blob against the DNS providers tile', () => {
    // Two keys feed one section; missing the second would leave a staged edit with no tile.
    const sections = sectionHealth(input({ stagedKeys: new Set(['cloudflare']) }));

    expect(find(sections, 'dns-providers').staged).toBe(true);
  });

  it('describes a stock Caddy build without inventing a plugin count', () => {
    expect(find(sectionHealth(input()), 'caddy-build').value).toBe('Stock build');
  });

  it('counts custom and disabled modules from the record shape', () => {
    const sections = sectionHealth(
      input({
        caddyBuild: {
          modules: { 'caddy-dns/cloudflare': true, 'caddy-l4': false },
          customModules: [{ id: 'x', repo: 'example.com/x' }] as never,
        },
      }),
    );

    expect(find(sections, 'caddy-build').value).toBe('1 custom, 1 disabled');
  });
});
