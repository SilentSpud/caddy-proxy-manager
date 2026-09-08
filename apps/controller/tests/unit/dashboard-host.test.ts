import { describe, expect, it } from 'bun:test';
import {
  DASHBOARD_HOST_ID,
  buildDashboardHostRow,
  checkDashboardDns,
} from '@/src/lib/dashboard-host';
import { validateSettingsGroup } from '@/src/lib/settings-validation';

const on = { enabled: true, domain: 'cpm.example.com', tls: false };

describe('the managed dashboard host', () => {
  it('is absent unless there is something to serve', () => {
    expect(buildDashboardHostRow(null, 'web:3000')).toBeNull();
    expect(buildDashboardHostRow({ ...on, enabled: false }, 'web:3000')).toBeNull();
    expect(buildDashboardHostRow({ ...on, domain: '   ' }, 'web:3000')).toBeNull();
    // An unknown dial address would produce a host that claims the domain and then answers with a
    // proxy error. Not claiming it at all leaves the operator a working port instead.
    expect(buildDashboardHostRow(on, null)).toBeNull();
  });

  it('points the domain at the controller', () => {
    const row = buildDashboardHostRow(on, 'web:3000');

    expect(row?.id).toBe(DASHBOARD_HOST_ID);
    expect(JSON.parse(row?.domains ?? '[]')).toEqual(['cpm.example.com']);
    expect(JSON.parse(row?.upstreams ?? '[]')).toEqual(['http://web:3000']);
    expect(row?.enabled).toBe(1);
    // The dashboard streams events and builds absolute URLs from the request host.
    expect(row?.allowWebsocket).toBe(1);
    expect(row?.preserveHostHeader).toBe(1);
  });

  it('never carries an id a stored host could also have', () => {
    // Serials start at 1, so a negative id cannot collide — and anything looking this host up by
    // id finds nothing rather than somebody else's access list or certificate.
    expect(DASHBOARD_HOST_ID).toBeLessThan(0);
  });

  it('normalises the domain it was given', () => {
    const row = buildDashboardHostRow({ ...on, domain: '  CPM.Example.COM ' }, 'web:3000');
    expect(JSON.parse(row?.domains ?? '[]')).toEqual(['cpm.example.com']);
  });

  it('ties HSTS to TLS', () => {
    // HSTS over a host that is not on HTTPS pins the browser to a scheme this host does not serve,
    // and nothing in this UI can clear that for the visitor.
    expect(buildDashboardHostRow({ ...on, tls: false }, 'web:3000')?.hstsEnabled).toBe(0);
    expect(buildDashboardHostRow({ ...on, tls: false }, 'web:3000')?.sslForced).toBe(0);

    const secure = buildDashboardHostRow({ ...on, tls: true }, 'web:3000');
    expect(secure?.hstsEnabled).toBe(1);
    expect(secure?.sslForced).toBe(1);
  });
});

describe('the dashboard DNS check', () => {
  const deps = (resolved: string[], publicIp: string | null) => ({
    resolveAddresses: async () => resolved,
    publicIp: async () => publicIp,
  });

  it('confirms a domain that resolves here', async () => {
    const result = await checkDashboardDns(
      'cpm.example.com',
      deps(['203.0.113.10'], '203.0.113.10'),
    );

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('match');
  });

  it('matches on any of the addresses the name carries', async () => {
    const result = await checkDashboardDns(
      'cpm.example.com',
      deps(['198.51.100.7', '203.0.113.10'], '203.0.113.10'),
    );

    expect(result.ok).toBe(true);
  });

  it('refuses a domain pointed somewhere else', async () => {
    const result = await checkDashboardDns(
      'cpm.example.com',
      deps(['198.51.100.7'], '203.0.113.10'),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
    // Both halves are reported: "it points at X, we are Y" is the sentence that tells an operator
    // which record to fix.
    expect(result.resolved).toEqual(['198.51.100.7']);
    expect(result.publicIp).toBe('203.0.113.10');
  });

  it('separates a name that resolves nowhere from one that cannot be compared', async () => {
    expect((await checkDashboardDns('cpm.example.com', deps([], '203.0.113.10'))).reason).toBe(
      'unresolved',
    );
    expect((await checkDashboardDns('cpm.example.com', deps(['203.0.113.10'], null))).reason).toBe(
      'noPublicIp',
    );
    expect((await checkDashboardDns('  ', deps(['203.0.113.10'], '203.0.113.10'))).reason).toBe(
      'noDomain',
    );
  });

  it('answers rather than throwing when the lookup fails', async () => {
    // Seeding a default at the end of setup and rendering a warning are both places where a slow
    // or broken resolver must not become an error the operator has to deal with.
    const result = await checkDashboardDns('cpm.example.com', {
      resolveAddresses: async () => {
        throw new Error('SERVFAIL');
      },
      publicIp: async () => '203.0.113.10',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unresolved');
  });
});

describe('dashboard settings validation', () => {
  it('accepts a complete group', () => {
    expect(
      validateSettingsGroup('dashboard', { enabled: true, domain: 'cpm.example.com', tls: false }),
    ).toEqual({ enabled: true, domain: 'cpm.example.com', tls: false });
  });

  it('requires the domain even when the host is off', () => {
    // It is what the route is rebuilt from the moment this is switched back on, so a blank one
    // would store a setting that silently produces nothing.
    expect(() =>
      validateSettingsGroup('dashboard', { enabled: false, domain: '', tls: false }),
    ).toThrow();
  });

  it('refuses unknown keys and wrong types', () => {
    expect(() =>
      validateSettingsGroup('dashboard', { enabled: true, domain: 'a.example.com', tls: 'yes' }),
    ).toThrow();
    expect(() =>
      validateSettingsGroup('dashboard', {
        enabled: true,
        domain: 'a.example.com',
        tls: false,
        upstream: 'web:3000',
      }),
    ).toThrow();
  });
});
