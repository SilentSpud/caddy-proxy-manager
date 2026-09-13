/**
 * With no agent attached, the controller loads its document straight onto Caddy. That document binds
 * the admin API to every interface, so the direct path pins CADDY_ADMIN_LISTEN the way the agent does,
 * or the first apply would put the API back on the network Caddy shares with its upstreams.
 */
import { describe, it, expect } from 'bun:test';
import { directRequestBody } from '../../src/lib/caddy-admin';

const LISTEN = 'caddy-admin:2019';
const DOCUMENT = JSON.stringify({ admin: { listen: ':2019', origins: ['caddy:2019'] }, apps: {} });

describe('directRequestBody', () => {
  it('pins the admin bind of a config it loads', () => {
    const body = directRequestBody({ method: 'POST', path: '/load', body: DOCUMENT }, LISTEN);
    const admin = JSON.parse(body ?? '{}').admin;
    expect(admin.listen).toBe(LISTEN);
    expect(admin.origins).toEqual(['caddy:2019', LISTEN]);
  });

  it('leaves every other request, and an unset listen, as sent', () => {
    expect(directRequestBody({ method: 'POST', path: '/adapt', body: 'respond 200' }, LISTEN)).toBe(
      'respond 200',
    );
    expect(directRequestBody({ method: 'POST', path: '/load', body: DOCUMENT }, null)).toBe(
      DOCUMENT,
    );
  });

  it('refuses a config that is not a JSON object rather than loading it unpinned', () => {
    expect(() =>
      directRequestBody({ method: 'POST', path: '/load', body: '[]' }, LISTEN),
    ).toThrow();
  });
});
