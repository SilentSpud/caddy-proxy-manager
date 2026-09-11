/**
 * Folding ClickHouse's per-Host-header totals back onto proxy host rows.
 *
 * ClickHouse knows the authority a request was made to; the list knows host ids and their domain
 * lists. The fold between them is where the numbers on the Proxy Hosts page can go wrong without
 * any query being wrong: a port left on the authority, a domain in a different case, or a host with
 * several domains reporting only one of them.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { vi } from '@/tests/helpers/vi';

const queryHostTotals = vi.fn();

vi.mock('../../src/lib/db', () => ({ default: {} }));
vi.mock('../../src/lib/clickhouse/client', () => ({
  queryHostTotals,
  querySummary: vi.fn(),
  queryTimeline: vi.fn(),
  queryCountries: vi.fn(),
  queryProtocols: vi.fn(),
  queryUserAgents: vi.fn(),
  queryBlocked: vi.fn(),
  queryTrafficEvents: vi.fn(),
  queryStatusClasses: vi.fn(),
  queryWafCount: vi.fn(),
  queryDistinctHosts: vi.fn(),
  isAnalyticsEnabled: vi.fn(),
}));

import { getTrafficByProxyHost } from '../../src/lib/analytics-db';

beforeEach(() => {
  queryHostTotals.mockReset();
});

describe('getTrafficByProxyHost', () => {
  it('sums every domain of a host onto its row', async () => {
    queryHostTotals.mockResolvedValue([
      { host: 'media.example.com', total: 100, blocked: 4 },
      { host: 'watch.example.com', total: 50, blocked: 1 },
    ]);

    const result = await getTrafficByProxyHost(0, 1, [
      { id: 7, domains: ['media.example.com', 'watch.example.com'] },
    ]);

    expect(result.get(7)).toEqual({ total: 150, blocked: 5 });
  });

  it('matches regardless of case and ignores a port on the authority', async () => {
    // Caddy logs the authority as sent, so a non-default port and whatever case the client used
    // both reach ClickHouse intact.
    queryHostTotals.mockResolvedValue([{ host: 'Git.Example.com:8443', total: 12, blocked: 0 }]);

    const result = await getTrafficByProxyHost(0, 1, [{ id: 3, domains: ['git.example.com'] }]);

    expect(result.get(3)).toEqual({ total: 12, blocked: 0 });
  });

  it('leaves out hosts that took no traffic rather than reporting zero', async () => {
    queryHostTotals.mockResolvedValue([{ host: 'a.example.com', total: 5, blocked: 0 }]);

    const result = await getTrafficByProxyHost(0, 1, [
      { id: 1, domains: ['a.example.com'] },
      { id: 2, domains: ['b.example.com'] },
    ]);

    expect(result.has(1)).toBe(true);
    // Absent, not zero: the page can then tell "no traffic recorded" from "analytics is off".
    expect(result.has(2)).toBe(false);
  });

  it('does not expand wildcards, since a wildcard never arrives as a Host header', async () => {
    queryHostTotals.mockResolvedValue([{ host: 'one.lab.example.com', total: 9, blocked: 0 }]);

    const result = await getTrafficByProxyHost(0, 1, [{ id: 4, domains: ['*.lab.example.com'] }]);

    expect(result.has(4)).toBe(false);
  });

  it('returns an empty map when ClickHouse cannot be reached', async () => {
    queryHostTotals.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await getTrafficByProxyHost(0, 1, [{ id: 1, domains: ['a.example.com'] }]);

    expect(result.size).toBe(0);
  });

  it('skips the query entirely for an empty page', async () => {
    const result = await getTrafficByProxyHost(0, 1, []);

    expect(result.size).toBe(0);
    expect(queryHostTotals).not.toHaveBeenCalled();
  });
});
