/**
 * Branding: APP_NAME is the single knob. It renames the app in the sidebar and
 * on the login card, and it is the suffix every page title carries.
 *
 * A page that should not carry the suffix opts out per page with
 * `title: { absolute: ... }` rather than through configuration — the forward
 * auth portal is the one that does.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { vi } from '@/tests/helpers/vi';
import { fresh } from '@/tests/helpers/fresh';

async function loadAppName(env: Record<string, string | undefined>): Promise<string> {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { config } = await import(`../../src/lib/config${fresh()}`);
  return config.appName;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('APP_NAME', () => {
  it('defaults to the product name', async () => {
    expect(await loadAppName({})).toBe('Caddy Proxy Manager');
  });

  it('renames the app when set', async () => {
    expect(await loadAppName({ APP_NAME: 'Acme Proxies' })).toBe('Acme Proxies');
  });

  it('trims surrounding whitespace', async () => {
    expect(await loadAppName({ APP_NAME: '  Acme Proxies  ' })).toBe('Acme Proxies');
  });

  it('falls back to the default when blank, so the suffix is never empty', async () => {
    expect(await loadAppName({ APP_NAME: '   ' })).toBe('Caddy Proxy Manager');
  });
});

describe('the page title template', () => {
  // Mirrors app/layout.tsx. Next fills %s with the page's own title, and skips
  // the template entirely for a title given as { absolute: ... }.
  const render = (appName: string, pageTitle: string) => `%s · ${appName}`.replace('%s', pageTitle);

  it('suffixes the page title with the app name', async () => {
    expect(render(await loadAppName({}), 'Users')).toBe('Users · Caddy Proxy Manager');
  });

  it('follows a renamed app', async () => {
    expect(render(await loadAppName({ APP_NAME: 'Acme Proxies' }), 'Users')).toBe(
      'Users · Acme Proxies',
    );
  });
});
