import { describe, it, expect, vi, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncryptedSecret } from '@/src/lib/secret';

describe('secret', () => {
  it('encrypts a value (output is non-empty string)', () => {
    const encrypted = encryptSecret('my-api-token');
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it('encrypted value starts with "enc:v1:" prefix', () => {
    const encrypted = encryptSecret('hello-world');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
  });

  it('same input produces different output each time (random IV)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    // Different because IV is random
    expect(a).not.toBe(b);
  });

  it('different inputs produce different outputs', () => {
    const a = encryptSecret('value-one');
    const b = encryptSecret('value-two');
    expect(a).not.toBe(b);
  });

  it('decrypts back to original value', () => {
    const original = 'super-secret-token-12345';
    const encrypted = encryptSecret(original);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(original);
  });

  it('decryptSecret with plain text (non-encrypted) returns input unchanged', () => {
    const plain = 'not-encrypted-value';
    expect(decryptSecret(plain)).toBe(plain);
  });

  it('isEncryptedSecret returns true for encrypted values', () => {
    const encrypted = encryptSecret('test');
    expect(isEncryptedSecret(encrypted)).toBe(true);
  });

  it('isEncryptedSecret returns false for plain text', () => {
    expect(isEncryptedSecret('plain-text')).toBe(false);
  });

  it('encrypting empty string returns empty string', () => {
    expect(encryptSecret('')).toBe('');
  });

  it('decrypting empty string returns empty string', () => {
    expect(decryptSecret('')).toBe('');
  });

  it('already-encrypted value is not double-encrypted', () => {
    const encrypted = encryptSecret('value');
    const encrypted2 = encryptSecret(encrypted);
    // Should return the same value (idempotent)
    expect(encrypted2).toBe(encrypted);
  });

  describe('failure diagnostics (SESSION_SECRET changed)', () => {
    const savedEnv: Record<string, string | undefined> = {};

    function withEnv(key: string, value: string | undefined) {
      savedEnv[key] = process.env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      vi.resetModules();
    });

    it('grace period expired: error includes context, cause and recovery hint', async () => {
      withEnv('SESSION_SECRET', 'a'.repeat(32));
      withEnv('LEGACY_KEY_CUTOFF_DATE', '2020-01-01T00:00:00Z');
      vi.resetModules();
      const first = await import('@/src/lib/secret');
      const encrypted = first.encryptSecret('token-value');

      withEnv('SESSION_SECRET', 'b'.repeat(32));
      vi.resetModules();
      const second = await import('@/src/lib/secret');

      expect(() => second.decryptSecret(encrypted, 'DNS provider "cloudflare" credential "api_token"')).toThrow(
        /DNS provider "cloudflare" credential "api_token"/
      );
      expect(() => second.decryptSecret(encrypted)).toThrow(/SESSION_SECRET changed/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/LEGACY_KEY_CUTOFF_DATE=never/);
    });

    it('legacy support enabled: error reports failure with both keys', async () => {
      withEnv('SESSION_SECRET', 'c'.repeat(32));
      withEnv('LEGACY_KEY_CUTOFF_DATE', 'never');
      vi.resetModules();
      const first = await import('@/src/lib/secret');
      const encrypted = first.encryptSecret('token-value');

      withEnv('SESSION_SECRET', 'd'.repeat(32));
      vi.resetModules();
      const second = await import('@/src/lib/secret');

      expect(() => second.decryptSecret(encrypted, 'certificate "my-cert"')).toThrow(/certificate "my-cert"/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/HKDF\).*legacy/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/SESSION_SECRET changed/);
    });
  });
});
