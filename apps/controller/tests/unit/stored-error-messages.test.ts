/**
 * The update check and the GeoIP updater run with no reader, so they store a failure's English and
 * its code, and the settings page says it later in the reader's language. These check that the
 * stored shapes render, that a result stored before codes existed still shows its English, and that
 * the English a code renders to is what the job stored - the REST contract and the log see that.
 */
import { describe, expect, it } from 'bun:test';
import { createTranslator } from 'next-intl';
import messages from '../../messages/en.json';
import { storedErrorMessage } from '@/src/lib/actions';
import { domainError, storedErrorCode } from '@/src/lib/domain-error';
import { geoipDownloadErrorMessage, geoipUpdateErrorMessage } from '@/src/lib/geoip/messages';

const t = createTranslator({ locale: 'en', messages });

describe('storedErrorMessage', () => {
  it('renders a stored code as the English it was stored with', () => {
    const failure = domainError('registryHttpStatus', { status: 503 });
    expect(storedErrorMessage(t, failure.message, storedErrorCode(failure))).toBe(
      'The registry answered HTTP 503',
    );
  });

  it('shows the stored English when there is no code', () => {
    expect(storedErrorMessage(t, 'fetch failed', null)).toBe('fetch failed');
    expect(storedErrorMessage(t, 'fetch failed', undefined)).toBe('fetch failed');
  });

  it('stores no code for an error that has none', () => {
    expect(storedErrorCode(new Error('fetch failed'))).toBeNull();
  });
});

describe('GeoIP failure messages', () => {
  const rejected = domainError('maxmindCredentialsRejected');
  const missing = domainError('geoipDatabaseMissing', { edition: 'GeoLite2-City' });
  const failures = [
    { edition: 'GeoLite2-ASN', message: rejected.message, code: storedErrorCode(rejected) },
    { edition: 'GeoLite2-City', message: missing.message, code: storedErrorCode(missing) },
  ];
  const joined = failures.map((f) => `${f.edition}: ${f.message}`).join('; ');

  it('says each download failure as the updater joined it', () => {
    expect(geoipDownloadErrorMessage(t, joined, failures)).toBe(joined);
  });

  it('falls back to the joined English a state stored earlier holds', () => {
    expect(geoipDownloadErrorMessage(t, 'GeoLite2-ASN: boom', [])).toBe('GeoLite2-ASN: boom');
    expect(geoipDownloadErrorMessage(t, null, failures)).toBeNull();
  });

  it('puts the check failure before the download failures', () => {
    const check = domainError('maxmindTimedOut');
    const result = {
      downloaded: [],
      error: `${check.message}; ${joined}`,
      checkError: { message: check.message, code: storedErrorCode(check) },
      failures,
    };
    expect(geoipUpdateErrorMessage(t, result)).toBe(result.error);
  });

  it('keeps the English of a run that threw before recording anything', () => {
    expect(geoipUpdateErrorMessage(t, { downloaded: [], error: 'disk full' })).toBe('disk full');
    expect(geoipUpdateErrorMessage(t, { downloaded: [], error: null })).toBeNull();
  });
});
