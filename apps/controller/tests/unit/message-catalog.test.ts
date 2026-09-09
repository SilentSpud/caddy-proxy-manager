/**
 * Shape rules for the message catalog itself.
 *
 * These exist because the first extraction pass broke all of them: prose lifted out of JSX kept the
 * source's line breaks and indentation, and the HTML entities JSX had been resolving at compile
 * time became literal `&apos;` once the text was a JSON string. Neither fails a build - they render
 * to the user and look like typos.
 */
import { describe, expect, it } from 'bun:test';
import messages from '../../messages/en.json';

type Node = { [key: string]: string | Node };

function entries(node: Node, prefix = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : entries(value, `${prefix}${key}.`),
  );
}

const ALL = entries(messages as unknown as Node);

describe('message catalog', () => {
  it('is not empty, so a broken import cannot pass these silently', () => {
    expect(ALL.length).toBeGreaterThan(500);
  });

  it('wraps no message by hand', () => {
    // Line breaks belong to layout. A translator cannot reproduce them, and the CSS that wraps the
    // English will wrap every other language too.
    const offenders = ALL.filter(([, value]) => /\n|\t| {2,}/.test(value)).map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('carries no leading or trailing whitespace', () => {
    expect(ALL.filter(([, v]) => v !== v.trim()).map(([k]) => k)).toEqual([]);
  });

  it('spells characters out rather than escaping them as HTML entities', () => {
    // `{t("...")}` renders a string, so `&mdash;` would reach the page as those nine characters.
    const offenders = ALL.filter(([, value]) => /&[a-zA-Z]+;|&#\d+;/.test(value)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('has no empty message', () => {
    expect(ALL.filter(([, value]) => value.trim() === '').map(([key]) => key)).toEqual([]);
  });

  it('names keys in camelCase, with no entity fragments left by slugging', () => {
    // settings.registry.* is the exception: those segments are the registry's own storage names
    // (`app_name`), because that is what settingMessageName() looks them up by.
    const offenders = ALL.filter(([key]) => !key.startsWith('settings.registry.'))
      .filter(([key]) => key.split('.').some((part) => !/^[a-z][A-Za-z0-9]*$/.test(part)))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('keys settings.registry by the registry name, not a camelCased one', () => {
    const registry = ALL.filter(([key]) => key.startsWith('settings.registry.'));
    expect(registry.length).toBeGreaterThan(0);
    for (const [key] of registry) {
      const [, , name, field] = key.split('.');
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(['label', 'description']).toContain(field);
    }
  });
});
