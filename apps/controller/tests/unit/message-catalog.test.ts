/**
 * Shape rules for the message catalog itself.
 *
 * These exist because the first extraction pass broke all of them: prose lifted out of JSX kept the
 * source's line breaks and indentation, and the HTML entities JSX had been resolving at compile
 * time became literal `&apos;` once the text was a JSON string. Neither fails a build - they render
 * to the user and look like typos.
 */
import { describe, expect, it } from 'bun:test';
import { createTranslator, IntlErrorCode } from 'next-intl';
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

  it('parses every message, so none renders as its own key', () => {
    // A placeholder written as `<host>` reads as an unclosed rich-text tag. next-intl cannot parse
    // it and shows the key instead - `settings.dashboardPortEscapeDescription` did exactly that.
    // Quote a literal one: `'<host>'`. Missing values fail differently (FORMATTING_ERROR) and are
    // ignored here. The empty values object matters: without one the translator returns a message
    // with no placeholders verbatim, never parsing it, and this test would pass on the bug.
    const unparseable: string[] = [];
    const t = createTranslator({
      locale: 'en',
      messages,
      onError: (error) => {
        if (error.code === IntlErrorCode.INVALID_MESSAGE) unparseable.push(error.message);
      },
    }) as unknown as (key: string, values: Record<string, never>) => string;

    for (const [key] of ALL) {
      const before = unparseable.length;
      t(key, {});
      if (unparseable.length > before) unparseable[unparseable.length - 1] = key;
    }
    expect(unparseable).toEqual([]);
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

describe('message catalog source', () => {
  it('names no key twice in one object, where the later would silently replace the earlier', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const text = readFileSync(join(import.meta.dir, '../../messages/en.json'), 'utf8');
    const duplicates: string[] = [];
    // JSON.parse keeps the last of a repeated key, so the keys are read off the text itself. Every
    // string is a token, so a `{name}` placeholder inside a value never counts as a brace.
    const stack: Set<string>[] = [];
    for (const token of text.matchAll(/"((?:[^"\\]|\\.)*)"(\s*:)?|[{}]/g)) {
      if (token[0] === '{') stack.push(new Set());
      else if (token[0] === '}') stack.pop();
      else if (token[2]) {
        const keys = stack.at(-1);
        if (keys?.has(token[1])) duplicates.push(token[1]);
        keys?.add(token[1]);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
