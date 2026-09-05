/**
 * How the environment names the database, and what it refuses.
 *
 * Two things are worth pinning here. The rejections: every deployment upgrading from 3.0 has a
 * SQLite value in its .env, and the difference between a clear "point this at PostgreSQL, the app
 * will migrate your file" and a driver-level parse failure is the difference between a five-minute
 * upgrade and a bug report.
 *
 * And the field form, which exists because a URL has to encode its password and the Compose file
 * that builds one cannot. `openssl rand -base64 32` — what the .env.example tells operators to run
 * — emits `/` about half the time, and a `/` in a URL's password ends the authority early: the app
 * then tries to reach a host nobody configured. Fields have no delimiter to collide with, and the
 * tests below say so with the characters that actually broke it.
 */
import { describe, expect, it } from 'bun:test';
import { driverOptions, resolveDatabaseTarget } from '../../src/lib/db/dialect';

/** Only what the test sets: the real environment must not decide what these assert. */
function env(values: Record<string, string | undefined>) {
  return values;
}

describe('resolveDatabaseTarget', () => {
  describe('DATABASE_URL, when it is set', () => {
    it('recognizes both spellings of the scheme', () => {
      expect(
        resolveDatabaseTarget(env({ DATABASE_URL: 'postgres://user:pw@db:5432/cpm' })),
      ).toEqual({ kind: 'url', url: 'postgres://user:pw@db:5432/cpm' });
      expect(
        resolveDatabaseTarget(env({ DATABASE_URL: 'postgresql://user:pw@db:5432/cpm' })).kind,
      ).toBe('url');
    });

    it('is case insensitive about the scheme', () => {
      const target = resolveDatabaseTarget(env({ DATABASE_URL: 'POSTGRES://user:pw@db/cpm' }));
      expect(target).toEqual({ kind: 'url', url: 'POSTGRES://user:pw@db/cpm' });
    });

    it('passes the URL through untouched for the driver to parse', () => {
      const url = 'postgres://user:p%40ss@db:5432/cpm?sslmode=require';
      expect(resolveDatabaseTarget(env({ DATABASE_URL: url }))).toEqual({ kind: 'url', url });
    });

    it('trims surrounding whitespace, which .env files pick up easily', () => {
      const target = resolveDatabaseTarget(env({ DATABASE_URL: '  postgres://db/cpm  ' }));
      expect(target).toEqual({ kind: 'url', url: 'postgres://db/cpm' });
    });

    it('wins over the fields, since it is the escape hatch for what they cannot say', () => {
      const target = resolveDatabaseTarget(
        env({ DATABASE_URL: 'postgres://db/cpm', POSTGRES_PASSWORD: 'ignored' }),
      );
      expect(target).toEqual({ kind: 'url', url: 'postgres://db/cpm' });
    });
  });

  describe('the POSTGRES_* fields', () => {
    it('takes a password with the characters that broke it as a URL', () => {
      // The reported failure: base64 output containing a slash. As a URL this ends the authority
      // early and the host becomes "cpm:pa"; as a field it is just the password.
      const target = resolveDatabaseTarget(env({ POSTGRES_PASSWORD: 'pa/ss+wo=rd' }));
      expect(target).toMatchObject({ kind: 'fields', password: 'pa/ss+wo=rd' });
    });

    it('leaves @ ? # and % alone too, none of which delimit anything here', () => {
      const password = 'p@ss?w#rd%2F/';
      expect(resolveDatabaseTarget(env({ POSTGRES_PASSWORD: password }))).toMatchObject({
        password,
      });
    });

    it('defaults the rest to the bundled stack, so a password is enough', () => {
      expect(resolveDatabaseTarget(env({ POSTGRES_PASSWORD: 'pw' }))).toEqual({
        kind: 'fields',
        hostname: 'postgres',
        port: 5432,
        username: 'cpm',
        password: 'pw',
        database: 'cpm',
        tls: false,
      });
    });

    it('takes an external server', () => {
      const target = resolveDatabaseTarget(
        env({
          POSTGRES_HOST: 'db.example.com',
          POSTGRES_PORT: '6432',
          POSTGRES_USER: 'proxy',
          POSTGRES_PASSWORD: 'pw',
          POSTGRES_DB: 'manager',
          POSTGRES_SSL: 'true',
        }),
      );
      expect(target).toEqual({
        kind: 'fields',
        hostname: 'db.example.com',
        port: 6432,
        username: 'proxy',
        password: 'pw',
        database: 'manager',
        tls: true,
      });
    });

    it('treats a blank variable as unset, which .env files produce easily', () => {
      const target = resolveDatabaseTarget(
        env({ POSTGRES_PASSWORD: 'pw', POSTGRES_HOST: '   ', POSTGRES_DB: '' }),
      );
      expect(target).toMatchObject({ hostname: 'postgres', database: 'cpm' });
    });

    it('refuses a port that is not one rather than quietly defaulting past it', () => {
      // Silently using 5432 for a typo'd port produces a connection error naming the right host
      // and the wrong port, which is a long way to walk back to a one-character mistake.
      for (const port of ['abc', '0', '70000', '5432.5', '']) {
        const values = env({ POSTGRES_PASSWORD: 'pw', POSTGRES_PORT: port });
        if (port === '') {
          expect(resolveDatabaseTarget(values)).toMatchObject({ port: 5432 });
        } else {
          expect(() => resolveDatabaseTarget(values)).toThrow(/POSTGRES_PORT/);
        }
      }
    });

    it('refuses a POSTGRES_SSL it cannot read as on or off', () => {
      expect(() =>
        resolveDatabaseTarget(env({ POSTGRES_PASSWORD: 'pw', POSTGRES_SSL: 'verify-full' })),
      ).toThrow(/POSTGRES_SSL/);
    });
  });

  describe('rejects the values a 3.0 deployment already has', () => {
    // Each of these is what an unmodified .env from the previous release carries, so each is a
    // real upgrade path rather than a hypothetical typo.
    for (const url of [
      'file:/app/data/caddy-proxy-manager.db',
      'file:./data/caddy-proxy-manager.db',
      'sqlite:///var/lib/cpm/app.db',
      '/var/lib/cpm/app.db',
      'data/app.db',
      'C:\\data\\app.db',
      ':memory:',
    ]) {
      it(`explains the migration path for ${url}`, () => {
        expect(() => resolveDatabaseTarget(env({ DATABASE_URL: url }))).toThrow(
          /no longer supported/,
        );
        expect(() => resolveDatabaseTarget(env({ DATABASE_URL: url }))).toThrow(/migrate/);
      });
    }
  });

  describe('rejects everything else by name', () => {
    it('names the backend when it is one Bun.SQL could almost reach', () => {
      expect(() => resolveDatabaseTarget(env({ DATABASE_URL: 'mysql://user:pw@db/cpm' }))).toThrow(
        /MySQL/,
      );
      expect(() =>
        resolveDatabaseTarget(env({ DATABASE_URL: 'mariadb://user:pw@db/cpm' })),
      ).toThrow(/MariaDB/);
      expect(() => resolveDatabaseTarget(env({ DATABASE_URL: 'mongodb://db/cpm' }))).toThrow(
        /MongoDB/,
      );
    });

    it('reports the scheme it did not recognize', () => {
      expect(() => resolveDatabaseTarget(env({ DATABASE_URL: 'redis://db:6379' }))).toThrow(
        /"redis"/,
      );
    });

    it('requires something to be set at all, and names both ways of doing it', () => {
      expect(() => resolveDatabaseTarget(env({}))).toThrow(/No database is configured/);
      expect(() => resolveDatabaseTarget(env({}))).toThrow(/POSTGRES_PASSWORD/);
      expect(() => resolveDatabaseTarget(env({}))).toThrow(/DATABASE_URL/);
      // A blank DATABASE_URL is what `${DATABASE_URL:-}` in the compose file produces when the
      // operator has not set one; it must read as absent rather than as an empty URL.
      expect(() => resolveDatabaseTarget(env({ DATABASE_URL: '   ' }))).toThrow(
        /No database is configured/,
      );
    });
  });
});

describe('driverOptions', () => {
  it('hands the fields to the driver as fields, with nothing of ours left in', () => {
    const options = driverOptions(resolveDatabaseTarget(env({ POSTGRES_PASSWORD: 'pa/ss' })));
    expect(options).toEqual({
      hostname: 'postgres',
      port: 5432,
      username: 'cpm',
      password: 'pa/ss',
      database: 'cpm',
      tls: false,
    });
    expect(options).not.toHaveProperty('kind');
  });

  it('hands a URL over as a url', () => {
    const options = driverOptions(
      resolveDatabaseTarget(env({ DATABASE_URL: 'postgres://db/cpm' })),
    );
    expect(options).toEqual({ url: 'postgres://db/cpm' });
  });
});
