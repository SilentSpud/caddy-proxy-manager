import { describe, expect, it } from 'bun:test';
import {
  DASHBOARD_HOST_ID,
  buildDashboardHostRow,
  checkDashboardDns,
} from '@/src/lib/dashboard-host';
import { createProbeNonce, probeSignatureMatches, signProbe } from '@/src/lib/reachability-probe';
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

describe('the dashboard reachability check', () => {
  const deps = (resolved: string[], reached: boolean) => ({
    resolveAddresses: async () => resolved,
    probe: async () => reached,
  });

  it('confirms a domain that arrives here', async () => {
    const result = await checkDashboardDns('cpm.example.com', deps(['203.0.113.10'], true));

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('reached');
  });

  it('trusts the probe over the record', async () => {
    // The record is only a diagnostic. A name that resolves to nothing this resolver can see but
    // still reaches us — split DNS, a hosts entry, a search domain — has answered the question.
    const result = await checkDashboardDns('cpm.example.com', deps([], true));

    expect(result.ok).toBe(true);
  });

  it('refuses a domain that resolves but does not reach here', async () => {
    const result = await checkDashboardDns('cpm.example.com', deps(['198.51.100.7'], false));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('otherServer');
    // Reported so the operator can see where it currently points.
    expect(result.resolved).toEqual(['198.51.100.7']);
  });

  it('separates a name that resolves nowhere from one pointed elsewhere', async () => {
    expect((await checkDashboardDns('cpm.example.com', deps([], false))).reason).toBe('unresolved');
    expect((await checkDashboardDns('  ', deps(['203.0.113.10'], true))).reason).toBe('noDomain');
  });

  it('answers rather than throwing when the lookup fails', async () => {
    // Rendering a warning is not a place to handle an exception, and a broken resolver must not
    // become an error the operator has to deal with.
    const result = await checkDashboardDns('cpm.example.com', {
      resolveAddresses: async () => {
        throw new Error('SERVFAIL');
      },
      probe: async () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unresolved');
  });
});

describe('the probe signature', () => {
  it('accepts only what this instance signed', () => {
    const nonce = createProbeNonce();

    expect(probeSignatureMatches(nonce, signProbe(nonce))).toBe(true);
    // A server that merely echoes the nonce, or answers with anything else, is not this instance.
    expect(probeSignatureMatches(nonce, nonce)).toBe(false);
    expect(probeSignatureMatches(nonce, '')).toBe(false);
    expect(probeSignatureMatches(nonce, signProbe(`${nonce}x`))).toBe(false);
  });

  it('gives every check a different nonce', () => {
    // A fixed nonce would let a server that once saw a valid answer replay it later.
    expect(createProbeNonce()).not.toBe(createProbeNonce());
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
