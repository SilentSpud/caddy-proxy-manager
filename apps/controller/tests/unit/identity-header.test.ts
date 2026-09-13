/**
 * Regression (L11): the X-CPM-* identity headers were built from raw names. A group named
 * "admins,ops" read as two groups upstream, and a non-Latin-1 name made the Headers constructor
 * throw, answering every verify for that user with a 500.
 */
import { describe, expect, it } from 'bun:test';
import { encodeGroupsHeaderValue, encodeIdentityHeaderValue } from '@/src/lib/identity-header';

describe('identity header values', () => {
  it('leaves a plain ASCII value unchanged', () => {
    expect(encodeIdentityHeaderValue('Alice Smith <alice@example.com>')).toBe(
      'Alice Smith <alice@example.com>',
    );
  });

  it('percent-encodes non-ASCII as UTF-8, and "%" so the encoding is reversible', () => {
    expect(encodeIdentityHeaderValue('Zoë')).toBe('Zo%C3%AB');
    expect(encodeIdentityHeaderValue('李')).toBe('%E6%9D%8E');
    expect(encodeIdentityHeaderValue('100%')).toBe('100%25');
    expect(decodeURIComponent(encodeIdentityHeaderValue('Zoë 100%'))).toBe('Zoë 100%');
  });

  it('never produces a value the Headers constructor rejects', () => {
    for (const hostile of [
      'Zoë',
      '李小龍',
      'a\r\nX-CPM-Admin: 1',
      'nul\0byte',
      '\uD800lone',
      '😀',
    ]) {
      const value = encodeIdentityHeaderValue(hostile);
      expect(() => new Headers({ 'X-CPM-User': value })).not.toThrow();
      expect(new Headers({ 'X-CPM-User': value }).get('X-CPM-User')).toBe(value);
    }
  });

  it('keeps a comma inside a group name from splitting it into two groups', () => {
    const header = encodeGroupsHeaderValue(['admins,ops', 'dev']);
    expect(header).toBe('admins%2Cops,dev');
    expect(header.split(',').map(decodeURIComponent)).toEqual(['admins,ops', 'dev']);
  });
});
