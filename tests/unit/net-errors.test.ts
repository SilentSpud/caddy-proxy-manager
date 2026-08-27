/**
 * These two helpers exist because Bun 1.4 changed the shape of what `fetch()`
 * rejects with and how duplicate request headers are read. The cases below are
 * the shapes both runtimes actually produce — the Bun ones were taken from a
 * live `fetch()` against a closed port and an unresolvable host under Bun
 * 1.4.0, not from the changelog.
 */
import { describe, expect, it } from 'vitest';
import { isConnectionError } from '@/src/lib/net-errors';
import { lastHeaderValue } from '@/src/lib/request-headers';

/** Builds an error carrying a `code`, the way a runtime does. */
const coded = (code: string, message = 'failed'): Error => {
  const error = new TypeError(message);
  Object.assign(error, { code });
  return error;
};

describe('isConnectionError', () => {
  it('matches the TypeError Bun rejects with for a refused connection', () => {
    // Bun reports "ConnectionRefused", not "ECONNREFUSED", and sets no cause.
    expect(
      isConnectionError(
        coded('ConnectionRefused', 'Unable to connect. Is the computer able to access the url?'),
      ),
    ).toBe(true);
  });

  it('matches an unresolvable host', () => {
    expect(isConnectionError(coded('ENOTFOUND', 'getaddrinfo ENOTFOUND example.invalid'))).toBe(
      true,
    );
  });

  it("matches Node's shape, where the code hangs off the cause", () => {
    const error = new TypeError('fetch failed');
    Object.assign(error, { cause: coded('ECONNREFUSED') });
    expect(isConnectionError(error)).toBe(true);
  });

  it('walks nested causes from wrapping clients', () => {
    const inner = coded('FailedToOpenSocket');
    const middle = new Error('clickhouse request failed', { cause: inner });
    const outer = new Error('analytics query failed', { cause: middle });
    expect(isConnectionError(outer)).toBe(true);
  });

  it('does not match an unrelated failure', () => {
    expect(isConnectionError(coded('ERR_INVALID_ARG_TYPE'))).toBe(false);
    expect(isConnectionError(new Error('Caddy config load failed: 500'))).toBe(false);
  });

  it('tolerates non-errors and self-referential causes', () => {
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError('ECONNREFUSED')).toBe(false);

    const looping = new Error('loop') as Error & { cause?: unknown };
    looping.cause = looping;
    expect(isConnectionError(looping)).toBe(false);
  });
});

describe('lastHeaderValue', () => {
  it('returns a single value unchanged', () => {
    expect(lastHeaderValue('app.example.com')).toBe('app.example.com');
  });

  it('takes the proxy-supplied value when duplicates were combined', () => {
    // Bun 1.4 joins duplicate headers per the Fetch spec; the client's own
    // value comes first and the proxy's is appended after it.
    expect(lastHeaderValue('spoofed.example.com, app.example.com')).toBe('app.example.com');
  });

  it('trims whitespace around the segment', () => {
    expect(lastHeaderValue('  10.0.0.1 ,  203.0.113.7  ')).toBe('203.0.113.7');
  });

  it('returns an empty string for a missing or empty header', () => {
    expect(lastHeaderValue(null)).toBe('');
    expect(lastHeaderValue(undefined)).toBe('');
    expect(lastHeaderValue('')).toBe('');
    expect(lastHeaderValue('  ,  ')).toBe('');
  });
});
