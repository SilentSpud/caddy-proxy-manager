/**
 * The in-memory Caddy demo mode loads configs onto. It only has to be convincing to the controller:
 * a load it accepts must read back, and one real Caddy would refuse must be refused.
 */
import { describe, expect, it } from 'bun:test';
import { createSimulatedCaddy } from '../../src/lib/demo/simulated-caddy';

describe('simulated Caddy', () => {
  it('starts empty, which the monitor reads as a Caddy that needs its config', () => {
    const caddy = createSimulatedCaddy();
    const response = caddy({ method: 'GET', path: '/config/' });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({});
  });

  it('serves a loaded config back, whole or by path', () => {
    const caddy = createSimulatedCaddy();
    const config = { apps: { http: { servers: { srv0: { listen: [':443'] } } } } };
    expect(caddy({ method: 'POST', path: '/load', body: JSON.stringify(config) }).status).toBe(200);

    expect(JSON.parse(caddy({ method: 'GET', path: '/config/' }).text)).toEqual(config);
    expect(
      JSON.parse(caddy({ method: 'GET', path: '/config/apps/http/servers/srv0' }).text),
    ).toEqual(config.apps.http.servers.srv0);
    expect(caddy({ method: 'GET', path: '/config/apps/tls' }).text).toBe('null');
  });

  it('refuses a config that is not a JSON object, and keeps the previous one', () => {
    const caddy = createSimulatedCaddy();
    caddy({ method: 'POST', path: '/load', body: '{"apps":{}}' });

    expect(caddy({ method: 'POST', path: '/load', body: 'not json' }).status).toBe(400);
    expect(caddy({ method: 'POST', path: '/load', body: '[]' }).status).toBe(400);
    expect(JSON.parse(caddy({ method: 'GET', path: '/config/' }).text)).toEqual({ apps: {} });
  });

  it('accepts a Caddyfile snippet with a warning instead of routes', () => {
    const caddy = createSimulatedCaddy();
    const parsed = JSON.parse(
      caddy({ method: 'POST', path: '/adapt', body: 'respond "hi"', contentType: 'text/caddyfile' })
        .text,
    );
    expect(parsed.result.apps.http.servers).toEqual({});
    expect(parsed.warnings).toHaveLength(1);
  });

  it('answers any other admin path the way Caddy answers an unknown one', () => {
    expect(createSimulatedCaddy()({ method: 'POST', path: '/stop' }).status).toBe(404);
  });
});
