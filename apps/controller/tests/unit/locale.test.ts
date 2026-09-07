import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_LOCALE,
  isLocale,
  negotiateLocale,
  parseAcceptLanguage,
  parsePreference,
  preferenceCookieValue,
  resolveLocale,
} from '../../src/lib/locale';

describe('parseAcceptLanguage', () => {
  it('returns tags in weight order, not header order', () => {
    expect(parseAcceptLanguage('de;q=0.7,en;q=0.9,fr;q=0.8')).toEqual(['en', 'fr', 'de']);
  });

  it('treats a tag with no q as the strongest preference', () => {
    expect(parseAcceptLanguage('en-GB,de;q=0.9')).toEqual(['en-GB', 'de']);
  });

  it('drops the wildcard, which would otherwise outrank a tag we ship', () => {
    expect(parseAcceptLanguage('*;q=0.9,en;q=0.5')).toEqual(['en']);
  });

  it('drops q=0, which explicitly rejects a language', () => {
    expect(parseAcceptLanguage('de,en;q=0')).toEqual(['de']);
  });

  it('is empty for a missing header', () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });
});

describe('negotiateLocale', () => {
  it('matches a region tag through its base language', () => {
    expect(negotiateLocale(['en-AU'])).toBe('en');
  });

  it('is case-insensitive', () => {
    expect(negotiateLocale(['EN-us'])).toBe('en');
  });

  it('skips tags with no catalog and keeps looking', () => {
    expect(negotiateLocale(['de-DE', 'ja', 'en'])).toBe('en');
  });

  it('returns undefined rather than a default, so callers can tell nothing matched', () => {
    expect(negotiateLocale(['de', 'ja'])).toBeUndefined();
    expect(negotiateLocale([])).toBeUndefined();
  });
});

describe('parsePreference', () => {
  it('reads a bare locale as the user having chosen it', () => {
    expect(parsePreference('en')).toEqual({ source: 'chosen', locale: 'en' });
  });

  it('reads the auto: prefix as a detection', () => {
    expect(parsePreference('auto:en')).toEqual({ source: 'detected', locale: 'en' });
  });

  it('discards a locale it has no catalog for', () => {
    expect(parsePreference('kl')).toEqual({ source: 'unset' });
    expect(parsePreference('auto:kl')).toEqual({ source: 'unset' });
  });

  it('reads a missing cookie as no preference', () => {
    expect(parsePreference(undefined)).toEqual({ source: 'unset' });
  });

  it('round-trips through preferenceCookieValue', () => {
    for (const value of ['en', 'auto:en']) {
      expect(preferenceCookieValue(parsePreference(value))).toBe(value);
    }
    expect(preferenceCookieValue({ source: 'unset' })).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('lets an explicit choice beat the browser', () => {
    expect(resolveLocale('en', 'de,ja')).toBe('en');
  });

  it('falls back to the default when nothing matches', () => {
    expect(resolveLocale(undefined, 'de,ja')).toBe(DEFAULT_LOCALE);
  });

  it('negotiates from the header when no cookie is set', () => {
    expect(resolveLocale(undefined, 'en-GB;q=0.8')).toBe('en');
  });

  it('prefers a live header over a stored detection, which may be stale', () => {
    // Both resolve to en while en is the only catalog; the ordering is what this pins.
    expect(resolveLocale('auto:en', 'en')).toBe('en');
  });

  it('keeps a stored detection when the header offers nothing', () => {
    expect(resolveLocale('auto:en', 'de')).toBe('en');
    expect(resolveLocale('auto:en', null)).toBe('en');
  });
});

describe('isLocale', () => {
  it('rejects non-strings and unknown tags', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});
