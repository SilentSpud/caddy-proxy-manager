/**
 * A translator over the real English catalog, for tests that call a server action directly.
 *
 * `getTranslations` needs a request scope, and a unit test has none — next-intl resolves to its
 * client build and throws. Mocking it with the real catalog rather than an identity function keeps
 * the assertions honest: a test still fails if the message it expects is renamed or deleted.
 */
import messages from '../../messages/en.json';

function lookup(key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node === null || node === undefined || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[part];
  }, messages);
  if (typeof value !== 'string') throw new Error(`missing message: ${key}`);
  return value;
}

function interpolate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    name in values ? String(values[name]) : whole,
  );
}

/** Mirrors `getTranslations(namespace?)`: keys resolve relative to the namespace when given. */
export function testTranslator(namespace?: string) {
  const t = (key: string, values: Record<string, unknown> = {}) =>
    interpolate(lookup(namespace ? `${namespace}.${key}` : key), values);
  return Object.assign(t, {
    rich: t,
    markup: t,
    raw: (key: string) => lookup(namespace ? `${namespace}.${key}` : key),
    has: (key: string) => {
      try {
        lookup(namespace ? `${namespace}.${key}` : key);
        return true;
      } catch {
        return false;
      }
    },
  });
}

/** The shape `vi.mock('next-intl/server', ...)` needs. */
export function nextIntlServerMock() {
  return {
    getTranslations: async (namespace?: string) => testTranslator(namespace),
    getLocale: async () => 'en',
    getMessages: async () => messages,
    getFormatter: async () => ({}),
    getNow: async () => new Date(),
    getTimeZone: async () => 'UTC',
  };
}
