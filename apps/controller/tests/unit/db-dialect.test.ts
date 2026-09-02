/**
 * DATABASE_URL is the only thing that selects a backend, and every existing deployment's value was
 * written when SQLite was the only option. Anything that used to mean "a SQLite file" must keep
 * meaning that — a URL misread as PostgreSQL would start an app against an empty database rather
 * than failing, and one misread as a filename would create a stray file named "postgres:".
 */
import { describe, expect, it } from 'bun:test';
import { isAbsolute, resolve } from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  resolveDatabaseDialect,
  resolveDatabaseTarget,
} from '../../src/lib/db/dialect';

describe('resolveDatabaseTarget', () => {
  describe('PostgreSQL', () => {
    it('recognizes both spellings of the scheme', () => {
      expect(resolveDatabaseDialect('postgres://user:pw@db:5432/cpm')).toBe('postgres');
      expect(resolveDatabaseDialect('postgresql://user:pw@db:5432/cpm')).toBe('postgres');
    });

    it('is case insensitive about the scheme', () => {
      expect(resolveDatabaseDialect('POSTGRES://user:pw@db/cpm')).toBe('postgres');
    });

    it('passes the URL through untouched for the driver to parse', () => {
      const url = 'postgres://user:p%40ss@db:5432/cpm?sslmode=require';
      expect(resolveDatabaseTarget(url)).toEqual({ dialect: 'postgres', url });
    });

    it('trims surrounding whitespace, which .env files pick up easily', () => {
      expect(resolveDatabaseDialect('  postgres://db/cpm  ')).toBe('postgres');
    });
  });

  describe('SQLite — the values existing deployments already have', () => {
    it('reads the documented Docker default', () => {
      expect(resolveDatabaseTarget('file:/app/data/caddy-proxy-manager.db')).toEqual({
        dialect: 'sqlite',
        path: '/app/data/caddy-proxy-manager.db',
      });
    });

    it('reads the repo default', () => {
      const target = resolveDatabaseTarget(DEFAULT_DATABASE_URL);
      expect(target.dialect).toBe('sqlite');
      expect(target).toMatchObject({
        path: resolve(process.cwd(), './data/caddy-proxy-manager.db'),
      });
    });

    it('treats a bare path as SQLite', () => {
      const target = resolveDatabaseTarget('/var/lib/cpm/app.db');
      expect(target).toEqual({ dialect: 'sqlite', path: '/var/lib/cpm/app.db' });
    });

    it('resolves a relative bare path against the working directory', () => {
      const target = resolveDatabaseTarget('data/app.db');
      expect(target.dialect).toBe('sqlite');
      expect(isAbsolute((target as { path: string }).path)).toBe(true);
    });

    it('recognizes every in-memory spelling', () => {
      for (const url of [':memory:', 'file::memory:', 'sqlite::memory:']) {
        expect(resolveDatabaseTarget(url)).toEqual({ dialect: 'sqlite', path: ':memory:' });
      }
    });

    it('defaults to in-memory for an empty value rather than a file named ""', () => {
      expect(resolveDatabaseTarget('')).toEqual({ dialect: 'sqlite', path: ':memory:' });
    });

    it('falls back to the repo default when unset', () => {
      expect(resolveDatabaseTarget(undefined).dialect).toBe('sqlite');
    });

    it('accepts an explicit sqlite: scheme', () => {
      expect(resolveDatabaseTarget('sqlite:/var/lib/cpm/app.db')).toEqual({
        dialect: 'sqlite',
        path: '/var/lib/cpm/app.db',
      });
      expect(resolveDatabaseTarget('sqlite:///var/lib/cpm/app.db')).toEqual({
        dialect: 'sqlite',
        path: '/var/lib/cpm/app.db',
      });
    });

    it('does not mistake a Windows drive letter for a URL scheme', () => {
      // Only the dialect is asserted: whether "C:/data/app.db" is already absolute depends on the
      // host OS, and path resolution itself is covered by db-sqlite-path.test.ts, which passes the
      // platform explicitly instead of inheriting it.
      expect(resolveDatabaseDialect('C:/data/app.db')).toBe('sqlite');
      expect(resolveDatabaseDialect('c:\\data\\app.db')).toBe('sqlite');
    });
  });

  describe('backends Bun speaks but this app does not', () => {
    it.each(['mysql://user:pw@db/cpm', 'mariadb://user:pw@db/cpm', 'mongodb://db/cpm'])(
      'rejects %s by name instead of treating it as a filename',
      (url) => {
        expect(() => resolveDatabaseTarget(url)).toThrow(/not supported/);
      },
    );

    it('names the backend and both supported alternatives in the message', () => {
      expect(() => resolveDatabaseTarget('mysql://db/cpm')).toThrow(/MySQL/);
      expect(() => resolveDatabaseTarget('mysql://db/cpm')).toThrow(/postgres:\/\//);
      expect(() => resolveDatabaseTarget('mysql://db/cpm')).toThrow(/file:/);
    });
  });
});
