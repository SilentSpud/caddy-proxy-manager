/**
 * Planning the `.env` cleanup once the settings live in the database.
 *
 * The app never sees that file, so what is pinned here is the decision: which variables it tells
 * the operator to comment out, which it tells them to leave, and that the command it hands over
 * matches the first list and only the first list.
 */
import { describe, expect, it } from 'bun:test';
import { planEnvCleanup } from '@/src/lib/migration/env-file';

describe('planEnvCleanup', () => {
  it('offers to comment out a migrated variable', () => {
    const { comment, keep, command } = planEnvCleanup(['APP_NAME']);

    expect(comment).toEqual(['APP_NAME']);
    expect(keep).toEqual([]);
    expect(command).toContain('APP_NAME');
  });

  it('holds back the variables Compose reads', () => {
    const { comment, keep, command } = planEnvCleanup([
      'APP_NAME',
      'CLICKHOUSE_PASSWORD',
      'GEOIPUPDATE_LICENSE_KEY',
    ]);

    // Compose provisions clickhouse and geoipupdate from these and cannot read the database, so
    // commenting them out would break the next `docker compose up` on a stack with no agent.
    expect(keep).toEqual(['CLICKHOUSE_PASSWORD', 'GEOIPUPDATE_LICENSE_KEY']);
    expect(comment).toEqual(['APP_NAME']);
    expect(command).not.toContain('CLICKHOUSE_PASSWORD');
    expect(command).not.toContain('GEOIPUPDATE_LICENSE_KEY');
  });

  it('ignores a name that is not a setting', () => {
    // SESSION_SECRET and DATABASE_URL have to be read before the database can be, so they are not
    // in the registry at all and must never reach the generated command.
    const { comment, command } = planEnvCleanup(['SESSION_SECRET', 'DATABASE_URL', 'APP_NAME']);

    expect(comment).toEqual(['APP_NAME']);
    expect(command).not.toContain('SESSION_SECRET');
    expect(command).not.toContain('DATABASE_URL');
  });

  it('has no command when nothing can be removed', () => {
    expect(planEnvCleanup([]).command).toBeNull();
    // Every migrated variable still being needed by Compose is the same case.
    expect(planEnvCleanup(['CLICKHOUSE_PASSWORD']).command).toBeNull();
  });

  it('edits .env in place, keeping a backup, and comments rather than deletes', () => {
    const command = planEnvCleanup(['APP_NAME', 'BASE_URL']).command ?? '';

    // `-i.bak` with the suffix attached is the one spelling both GNU and BSD sed accept.
    expect(command).toContain('sed -i.bak -E');
    expect(command).toContain('.env');
    expect(command).toContain('# migrated to the database:');
    expect(command).toContain("migrated='APP_NAME|BASE_URL'");
  });

  it('lists variables in the order the settings pages use', () => {
    const forwards = planEnvCleanup(['APP_NAME', 'LOGIN_MAX_ATTEMPTS']).comment;
    const backwards = planEnvCleanup(['LOGIN_MAX_ATTEMPTS', 'APP_NAME']).comment;

    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual(['APP_NAME', 'LOGIN_MAX_ATTEMPTS']);
  });
});
