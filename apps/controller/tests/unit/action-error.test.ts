/**
 * How a failed server action decides what to show.
 *
 * The params case is here because it was missed once: extractErrorMessage translated the code but
 * dropped DomainError.params, so a message carrying placeholders would have rendered them raw. No
 * code took params at the time, which is exactly why nothing caught it.
 */
import { describe, expect, it } from 'bun:test';
import { actionError, extractErrorMessage } from '@/src/lib/actions';
import { DomainError, domainError } from '@/src/lib/domain-error';

/** Stands in for next-intl's translator: resolves nothing, just proves what it was handed. */
function translator(seen?: { key?: string; values?: Record<string, string | number> }) {
  const t = (key: string, values?: Record<string, string | number>) => {
    if (seen) {
      seen.key = key;
      seen.values = values;
    }
    return `translated:${key}${values ? `:${JSON.stringify(values)}` : ''}`;
  };
  return t as unknown as Parameters<typeof extractErrorMessage>[0];
}

describe('extractErrorMessage', () => {
  it('translates a DomainError by its code', () => {
    const seen: { key?: string } = {};
    const message = extractErrorMessage(translator(seen), domainError('nameRequired'), 'fallback');
    expect(seen.key).toBe('errors.nameRequired');
    expect(message).toContain('errors.nameRequired');
  });

  it('passes the error params through to the translator', () => {
    const seen: { values?: Record<string, string | number> } = {};
    const error = new DomainError('nameRequired', { count: 3, name: 'x' }, 'English');
    extractErrorMessage(translator(seen), error, 'fallback');
    expect(seen.values).toEqual({ count: 3, name: 'x' });
  });

  it('keeps the English sentence on an ordinary Error, which carries no code', () => {
    expect(extractErrorMessage(translator(), new Error('Upstream refused'), 'fallback')).toBe(
      'Upstream refused',
    );
  });

  it("falls back to the caller's wording for something that is not an Error", () => {
    expect(extractErrorMessage(translator(), 'not an error', 'fallback')).toBe('fallback');
  });
});

describe('actionError', () => {
  it('reports the message as a failed action state', () => {
    const state = actionError(translator(), new Error('Boom'), 'fallback');
    expect(state).toEqual({ status: 'error', message: 'Boom' });
  });
});
