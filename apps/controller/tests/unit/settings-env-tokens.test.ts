import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

/**
 * The settings screens show environment variables as tokens - beside a block's heading when the
 * variable governs the block, and under a field when it sets that one field - and feed the same
 * strings to the search. A token is only worth showing if it names a variable that
 * exists: a typo or a variable that was renamed out from under it sends an operator looking for a
 * line that is not there, and the search silently stops matching what they type.
 *
 * `.env.example` is the list of variables this deployment documents, so it is what the tokens are
 * checked against. Nothing here asserts the reverse - most variables configure something with no
 * settings page at all.
 */

// The navigation catalogue, which the sidebar and the section pane both render from.
const settingsClient = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/settings/sections.ts'),
  'utf8',
);

// The blocks themselves, where a variable that sets one field is named under that field.
const settingsBlocks = readFileSync(
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

/** The variables named on a field's own label line, as `<EnvLabelledField env={[...]}>`. */
function fieldTokens(): string[] {
  const names: string[] = [];
  for (const use of settingsBlocks.matchAll(/<EnvLabelledField[^>]*?env=\{\[([^\]]*)\]\}/g)) {
    for (const quoted of use[1].matchAll(/"([^"]+)"/g)) names.push(quoted[1]);
  }
  return names;
}

describe('settings environment tokens', () => {
  it('finds tokens to check', () => {
    // Guards the regexes above: a catalog refactor that renames the fields would otherwise leave
    // this file asserting nothing at all, quietly.
    expect([...tokensIn('env'), ...fieldTokens()].length).toBeGreaterThan(15);
    expect(tokensIn('envSearch').length).toBeGreaterThan(0);
    // Both shapes are in use, so a refactor that drops one fails here rather than going quiet.
    expect(tokensIn('env').length).toBeGreaterThan(0);
    expect(fieldTokens().length).toBeGreaterThan(0);
  });

  it('names only variables the deployment documents', () => {
    const unknown = [...tokensIn('env'), ...tokensIn('envSearch'), ...fieldTokens()]
      .filter((name) => !isWildcard(name))
      .filter((name) => !documented.has(name) && !FOREIGN.has(name));

    expect(unknown).toEqual([]);
  });

  it('names only documented variables on the setup step', () => {
    // The identity-provider card is not generated from the registry, so its names are typed out.
    const setupClient = readFileSync(
      join(process.cwd(), 'src/app/setup/settings/SetupSettingsClient.tsx'),
      'utf8',
    );
    const names = Array.from(setupClient.matchAll(/"(OAUTH_[A-Z_]+)"/g), (m) => m[1]);

    expect(names.length).toBeGreaterThan(15);
    expect(names.filter((name) => !documented.has(name))).toEqual([]);
  });

  it('shows a variable in one place, not two', () => {
    // A variable named under its field must not also sit beside the heading: the heading is for
    // what governs the whole block, and saying it twice reads as two different settings.
    const heading = new Set(tokensIn('env'));
    expect(fieldTokens().filter((name) => heading.has(name))).toEqual([]);
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
