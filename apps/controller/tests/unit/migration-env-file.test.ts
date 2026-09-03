/**
 * Trimming a `.env` once its settings live in the database.
 *
 * The file handed back is the operator's own, edited — not regenerated — so the properties worth
 * pinning are about what survives untouched as much as what goes.
 */
import { describe, expect, it } from 'bun:test';
import { trimMigratedEnv } from '@/src/lib/migration/env-file';

describe('trimMigratedEnv', () => {
  it('comments out a migrated variable rather than deleting it', () => {
    const { contents, removed } = trimMigratedEnv('APP_NAME=Edge Router\n');

    expect(removed).toEqual(['APP_NAME']);
    // Commented, not gone: for a secret this file is the operator's only copy.
    expect(contents).toContain('APP_NAME=Edge Router');
    expect(contents).toMatch(/#\s*migrated to the database: APP_NAME=Edge Router/);
  });

  it('leaves the variables that stay in the file alone', () => {
    const original = [
      'DATABASE_URL=postgres://cpm:pw@postgres:5432/cpm',
      'SESSION_SECRET=a-secret-of-sufficient-length-for-production',
      'POSTGRES_PASSWORD=another-secret',
      '',
    ].join('\n');

    const { contents, removed } = trimMigratedEnv(original);

    expect(removed).toEqual([]);
    // Untouched entirely — no header either, since nothing was migrated.
    expect(contents).toBe(original);
  });

  it('preserves comments, blank lines and ordering around what it removes', () => {
    const original = [
      '# Database',
      'DATABASE_URL=postgres://cpm:pw@postgres:5432/cpm',
      '',
      '# Branding',
      'APP_NAME=Edge Router',
      'SOMETHING_WE_DO_NOT_KNOW=keep me',
      '',
    ].join('\n');

    const { contents } = trimMigratedEnv(original);

    expect(contents).toContain('# Database');
    expect(contents).toContain('# Branding');
    expect(contents).toContain('SOMETHING_WE_DO_NOT_KNOW=keep me');
    expect(contents).toContain('DATABASE_URL=postgres://cpm:pw@postgres:5432/cpm');
    expect(contents.indexOf('# Database')).toBeLessThan(contents.indexOf('# Branding'));
  });

  it('handles the export prefix and leading whitespace', () => {
    const { removed } = trimMigratedEnv('  export CLICKHOUSE_PASSWORD=hunter2\n');
    expect(removed).toEqual(['CLICKHOUSE_PASSWORD']);
  });

  it('reports every variable it commented out', () => {
    const { removed } = trimMigratedEnv(
      ['APP_NAME=x', 'LOGIN_MAX_ATTEMPTS=9', 'DATABASE_URL=postgres://x', ''].join('\n'),
    );
    expect(removed.sort()).toEqual(['APP_NAME', 'LOGIN_MAX_ATTEMPTS']);
  });

  it('adds nothing to a file with no migrated entries', () => {
    const { contents } = trimMigratedEnv('# just a comment\n');
    expect(contents).toBe('# just a comment\n');
  });
});
