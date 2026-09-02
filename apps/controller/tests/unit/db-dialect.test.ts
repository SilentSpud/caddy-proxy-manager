/**
 * DATABASE_URL is the only thing that names the database, and PostgreSQL is now the only backend.
 *
 * The cases that matter are the rejections. Every deployment upgrading from 3.0 has a SQLite value
 * in its .env, and the difference between a clear "point this at PostgreSQL, the app will migrate
 * your file" and a driver-level parse failure is the difference between a five-minute upgrade and
 * a bug report.
 */
import { describe, expect, it } from 'bun:test';
import { resolveDatabaseTarget } from '../../src/lib/db/dialect';

describe('resolveDatabaseTarget', () => {
  describe('accepts PostgreSQL', () => {
    it('recognizes both spellings of the scheme', () => {
      expect(resolveDatabaseTarget('postgres://user:pw@db:5432/cpm').url).toBe(
        'postgres://user:pw@db:5432/cpm',
      );
      expect(resolveDatabaseTarget('postgresql://user:pw@db:5432/cpm').url).toBe(
        'postgresql://user:pw@db:5432/cpm',
      );
    });

    it('is case insensitive about the scheme', () => {
      expect(resolveDatabaseTarget('POSTGRES://user:pw@db/cpm').url).toBe(
        'POSTGRES://user:pw@db/cpm',
      );
    });

    it('passes the URL through untouched for the driver to parse', () => {
      const url = 'postgres://user:p%40ss@db:5432/cpm?sslmode=require';
      expect(resolveDatabaseTarget(url)).toEqual({ url });
    });

    it('trims surrounding whitespace, which .env files pick up easily', () => {
      expect(resolveDatabaseTarget('  postgres://db/cpm  ').url).toBe('postgres://db/cpm');
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
        expect(() => resolveDatabaseTarget(url)).toThrow(/no longer supported/);
        expect(() => resolveDatabaseTarget(url)).toThrow(/migrate/);
      });
    }
  });

  describe('rejects everything else by name', () => {
    it('names the backend when it is one Bun.SQL could almost reach', () => {
      expect(() => resolveDatabaseTarget('mysql://user:pw@db/cpm')).toThrow(/MySQL/);
      expect(() => resolveDatabaseTarget('mariadb://user:pw@db/cpm')).toThrow(/MariaDB/);
      expect(() => resolveDatabaseTarget('mongodb://db/cpm')).toThrow(/MongoDB/);
    });

    it('reports the scheme it did not recognize', () => {
      expect(() => resolveDatabaseTarget('redis://db:6379')).toThrow(/"redis"/);
    });

    it('requires the variable to be set at all', () => {
      expect(() => resolveDatabaseTarget(undefined)).toThrow(/DATABASE_URL is required/);
      expect(() => resolveDatabaseTarget('   ')).toThrow(/DATABASE_URL is required/);
    });
  });
});
