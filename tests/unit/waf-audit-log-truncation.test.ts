/**
 * Regression: Coraza's SecAuditLog writes waf-audit.log directly with no
 * rotation of its own (unlike access.log/waf-rules.log, which go through
 * Caddy's file writer and roll automatically) — it grew to ~2GB in
 * production and was never cleaned up. parseNewWafLogEntries now truncates
 * the file in place once it has been fully ingested and crosses a size
 * threshold. These tests pin that behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// Matches AUDIT_LOG_TRUNCATE_THRESHOLD in src/lib/waf-log-parser.ts
const TRUNCATE_THRESHOLD = 100 * 1024 * 1024;
const AUDIT_LOG_PATH = '/logs/waf-audit.log';

const state = { inserted: [] as { key: string; value: string }[] };
const fsState = { auditSize: 0, rulesExists: false };

vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }),
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: { key: string; value: string }) => {
        state.inserted.push(v);
        return { onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) };
      }),
    })),
  },
  nowIso: () => new Date().toISOString(),
}));

vi.mock('maxmind', () => ({
  default: { open: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/src/lib/clickhouse/client', () => ({
  insertWafEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => (p.includes('waf-audit') ? true : fsState.rulesExists)),
  statSync: vi.fn((p: string) => ({ size: p.includes('waf-audit') ? fsState.auditSize : 0 })),
  // Produces exactly `size - start` bytes so the parser always reads through
  // to the simulated current end-of-file in one pass, regardless of start offset.
  createReadStream: vi.fn((p: string, opts: { start?: number }) => {
    const start = opts?.start ?? 0;
    const size = p.includes('waf-audit') ? fsState.auditSize : 0;
    const remaining = Math.max(0, size - start);
    const content = remaining > 0 ? 'x'.repeat(remaining - 1) + '\n' : '';
    return Readable.from([content]);
  }),
  truncateSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { parseNewWafLogEntries } from '@/src/lib/waf-log-parser';

beforeEach(() => {
  state.inserted = [];
  fsState.auditSize = 0;
  fsState.rulesExists = false;
  vi.mocked(fs.truncateSync).mockClear();
});

function stateValue(key: string): string | undefined {
  return [...state.inserted].reverse().find((s) => s.key === key)?.value;
}

describe('waf-audit.log truncation', () => {
  it('does not truncate when below the size threshold', async () => {
    fsState.auditSize = 50 * 1024 * 1024; // 50MB < 100MB threshold
    await parseNewWafLogEntries();

    expect(fs.truncateSync).not.toHaveBeenCalled();
    expect(stateValue('waf_audit_log_size')).toBe(String(fsState.auditSize));
  });

  it('does not truncate exactly at the threshold (strictly greater-than)', async () => {
    fsState.auditSize = TRUNCATE_THRESHOLD;
    await parseNewWafLogEntries();

    expect(fs.truncateSync).not.toHaveBeenCalled();
    expect(stateValue('waf_audit_log_size')).toBe(String(TRUNCATE_THRESHOLD));
  });

  it('truncates in place once past the threshold and resets stored offset/size to 0', async () => {
    fsState.auditSize = TRUNCATE_THRESHOLD + 1;
    await parseNewWafLogEntries();

    expect(fs.truncateSync).toHaveBeenCalledWith(AUDIT_LOG_PATH, 0);
    expect(stateValue('waf_audit_log_offset')).toBe('0');
    expect(stateValue('waf_audit_log_size')).toBe('0');
  });
});
