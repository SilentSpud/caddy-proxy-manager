/**
 * A `file:` URL hands back its path with a leading slash, so a Windows absolute
 * path arrives as "/C:/data/app.db". Passing that to mkdir/open resolves it
 * against the current drive root — "C:\C:\data\app.db" — and the database is
 * created (or fails to be created) in the wrong place.
 *
 * The rewrite is deliberately Windows-only: "file:/app/data/…" is the
 * documented DATABASE_URL for Docker, and on POSIX "/C:/x" is a legitimate path
 * under a directory named "C:".
 */
import { describe, expect, it } from 'bun:test';
import { stripLeadingSlashBeforeDriveLetter } from '../../src/lib/db';

describe('stripLeadingSlashBeforeDriveLetter', () => {
  describe('on Windows', () => {
    const onWindows = (pathname: string) => stripLeadingSlashBeforeDriveLetter(pathname, 'win32');

    it('drops the slash a file: URL puts before the drive letter', () => {
      expect(onWindows('/C:/data/app.db')).toBe('C:/data/app.db');
      expect(onWindows('/R:/source/caddy-proxy-manager/data/app.db')).toBe(
        'R:/source/caddy-proxy-manager/data/app.db',
      );
    });

    it('handles a lower-case drive letter and a backslash separator', () => {
      expect(onWindows('/c:/data/app.db')).toBe('c:/data/app.db');
      expect(onWindows('/C:\\data\\app.db')).toBe('C:\\data\\app.db');
    });

    it('leaves a POSIX path alone — that is the Docker default', () => {
      expect(onWindows('/app/data/caddy-proxy-manager.db')).toBe(
        '/app/data/caddy-proxy-manager.db',
      );
    });

    it('leaves an already-correct drive path alone', () => {
      expect(onWindows('C:/data/app.db')).toBe('C:/data/app.db');
    });

    it('does not mistake a single leading letter for a drive', () => {
      expect(onWindows('/C:')).toBe('/C:');
      expect(onWindows('/CC:/data/app.db')).toBe('/CC:/data/app.db');
    });
  });

  describe('on POSIX', () => {
    it('changes nothing, since a drive letter carries no meaning there', () => {
      expect(stripLeadingSlashBeforeDriveLetter('/C:/data/app.db', 'linux')).toBe(
        '/C:/data/app.db',
      );
      expect(stripLeadingSlashBeforeDriveLetter('/app/data/app.db', 'linux')).toBe(
        '/app/data/app.db',
      );
    });
  });
});
