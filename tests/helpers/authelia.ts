/**
 * Helpers for the real-Authelia functional tests.
 *
 * The test Authelia container (tests/authelia/configuration.yml) listens on
 * plain HTTP inside the docker network and is exposed to the test runner at
 * localhost:9092. First-factor login is performed with a "Host: auth.test"
 * header so Authelia matches the portal session cookie entry and issues a
 * session cookie the tests can replay against protected hosts.
 */
import http from 'node:http';

export interface AutheliaLoginResult {
  status: number;
  body: string;
  /** Raw value of the authelia_session cookie (without attributes). */
  sessionCookie: string | null;
}

export function autheliaFirstFactor(
  username: string,
  password: string,
  port = 9092,
  hostHeader = 'auth.test'
): Promise<AutheliaLoginResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ username, password, keepMeLoggedIn: true });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/firstfactor',
        method: 'POST',
        headers: {
          Host: hostHeader,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'] ?? [];
          const session = setCookie
            .map((c) => c.split(';')[0])
            .find((c) => c.startsWith('authelia_session='));
          resolve({
            status: res.statusCode ?? 0,
            body,
            sessionCookie: session ? session.split('=')[1] : null,
          });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
