import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

/**
 * The settings catalog shows each section's environment variables as tokens beside its name, and
 * feeds the same strings to the search. A token is only worth showing if it names a variable that
 * exists: a typo or a variable that was renamed out from under it sends an operator looking for a
 * line that is not there, and the search silently stops matching what they type.
 *
 * `.env.example` is the list of variables this deployment documents, so it is what the tokens are
 * checked against. Nothing here asserts the reverse - most variables configure something with no
 * settings page at all.
 */

const settingsClient = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/settings/SettingsClient.tsx'),
  'utf8',
);

const envExample = readFileSync(join(process.cwd(), '../../.env.example'), 'utf8');

/** Every `NAME=` in `.env.example`, commented-out lines included - those are documentation too. */
const documented = new Set(
  Array.from(envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm), (m) => m[1]),
);

/**
 * Variables that are real but are not CPM's own, so `.env.example` does not carry them.
 *
 * `TS_AUTHKEY` lives in Caddy's environment: the Tailscale section accepts `{env.TS_AUTHKEY}` as
 * an auth key and Caddy's replacer resolves it, which is what keeps the key out of the database.
 */
const FOREIGN = new Set(['TS_AUTHKEY']);

/** Tokens naming a family rather than a variable. Their members are asserted separately. */
const isWildcard = (name: string) => name.endsWith('_*');

function tokensIn(field: 'env' | 'envSearch'): string[] {
  const names: string[] = [];
  for (const block of settingsClient.matchAll(
    new RegExp(String.raw`\b${field}:\s*\[([^\]]*)\]`, 'g'),
  )) {
    for (const quoted of block[1].matchAll(/"([^"]+)"/g)) names.push(quoted[1]);
  }
  return names;
}

describe('settings environment tokens', () => {
  it('finds tokens to check', () => {
    // Guards the regexes above: a catalog refactor that renames the fields would otherwise leave
    // this file asserting nothing at all, quietly.
    expect(tokensIn('env').length).toBeGreaterThan(15);
    expect(tokensIn('envSearch').length).toBeGreaterThan(0);
  });

  it('names only variables the deployment documents', () => {
    const unknown = [...tokensIn('env'), ...tokensIn('envSearch')]
      .filter((name) => !isWildcard(name))
      .filter((name) => !documented.has(name) && !FOREIGN.has(name));

    expect(unknown).toEqual([]);
  });

  it('backs every wildcard token with the members it stands for', () => {
    const searchable = new Set(tokensIn('envSearch'));

    for (const wildcard of tokensIn('env').filter(isWildcard)) {
      const prefix = wildcard.slice(0, -1);
      const members = [...searchable].filter((name) => name.startsWith(prefix));

      // Shown as a prefix, so the search is the only way to reach it by a member's name.
      expect(members.length).toBeGreaterThan(0);
    }
  });
});
