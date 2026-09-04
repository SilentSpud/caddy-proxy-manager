/**
 * Regression: Coraza's SecAuditLog writes waf-audit.log with no rotation of its own, and it grew to
 * ~2GB in production. parseNewWafLogEntries truncates it in place once fully ingested and past a
 * size threshold; these pin that.
 *
 * Moved here with the parser. The offsets now go through the agent's own store, so this uses a real
 * one on a temp file rather than the shape-mocked data layer the controller's copy needed —
 * round-tripping through real SQLite is the point, since a test spanning two passes proves nothing
 * if each starts from a blank slate.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { vi } from "./helpers/vi";

// Matches AUDIT_LOG_TRUNCATE_THRESHOLD in src/analytics/waf-log-parser.ts
const TRUNCATE_THRESHOLD = 100 * 1024 * 1024;
const AUDIT_LOG_PATH = "/logs/waf-audit.log";

const fsState = { auditSize: 0, rulesExists: false, auditInode: 42 };

vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => (p.includes("waf-audit") ? true : fsState.rulesExists)),
  statSync: vi.fn((p: string) => ({
    size: p.includes("waf-audit") ? fsState.auditSize : 0,
    ino: p.includes("waf-audit") ? fsState.auditInode : 1,
  })),
  // Produces exactly `size - start` bytes so the parser always reads through
  // to the simulated current end-of-file in one pass, regardless of start offset.
  // Chunks are Buffers because that is what createReadStream yields when no
  // encoding is set, and the offset accounting counts bytes, not characters.
  createReadStream: vi.fn((p: string, opts: { start?: number }) => {
    const start = opts?.start ?? 0;
    const size = p.includes("waf-audit") ? fsState.auditSize : 0;
    const remaining = Math.max(0, size - start);
    const content =
      remaining > 0
        ? `${"x".repeat(remaining - 1)}
`
        : "";
    return Readable.from([Buffer.from(content, "utf8")]);
  }),
  truncateSync: vi.fn(),
  // The store creates its directory and opens a database; those calls are real.
  mkdirSync: vi.fn(),
}));

import * as fs from "node:fs";
import { AgentStore } from "../src/db";
import { bindStore, parseNewWafLogEntries } from "../src/analytics/waf-log-parser";

let dir: string;
let store: AgentStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-waf-"));
  store = new AgentStore(join(dir, "agent.db"));
  bindStore(store);

  fsState.auditSize = 0;
  fsState.rulesExists = false;
  fsState.auditInode = 42;
  vi.mocked(fs.truncateSync).mockReset();
});

afterEach(() => {
  store.close();
  Bun.gc(true);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp directory is not worth failing a test over */
  }
});

function stateValue(key: string): string | undefined {
  return store.parseState(key) ?? undefined;
}

describe("waf-audit.log truncation", () => {
  it("does not truncate when below the size threshold", async () => {
    fsState.auditSize = 50 * 1024 * 1024; // 50MB < 100MB threshold
    await parseNewWafLogEntries();

    expect(fs.truncateSync).not.toHaveBeenCalled();
    expect(stateValue("waf_audit_log_size")).toBe(String(fsState.auditSize));
  });

  it("does not truncate exactly at the threshold (strictly greater-than)", async () => {
    fsState.auditSize = TRUNCATE_THRESHOLD;
    await parseNewWafLogEntries();

    expect(fs.truncateSync).not.toHaveBeenCalled();
    expect(stateValue("waf_audit_log_size")).toBe(String(TRUNCATE_THRESHOLD));
  });

  it("truncates in place once past the threshold and resets stored offset/size to 0", async () => {
    fsState.auditSize = TRUNCATE_THRESHOLD + 1;
    await parseNewWafLogEntries();

    expect(fs.truncateSync).toHaveBeenCalledWith(AUDIT_LOG_PATH, 0);
    expect(stateValue("waf_audit_log_offset")).toBe("0");
    expect(stateValue("waf_audit_log_size")).toBe("0");
  });

  // Regression (issue #233): Coraza creates waf-audit.log owned by the caddy
  // user with mode 0644, so the web container — a different UID — gets EACCES
  // here. The truncate used to run *before* the offsets were persisted, so the
  // throw aborted the pass and froze them, making every later pass re-read and
  // re-insert the same tail forever. Progress must survive a failed truncate.
  it("keeps advancing the stored offset when truncation fails with EACCES", async () => {
    fsState.auditSize = TRUNCATE_THRESHOLD + 1;
    vi.mocked(fs.truncateSync).mockImplementation(() => {
      const err = new Error(
        "EACCES: permission denied, truncate '/logs/waf-audit.log'",
      ) as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });

    await parseNewWafLogEntries();

    expect(fs.truncateSync).toHaveBeenCalled();
    expect(stateValue("waf_audit_log_offset")).toBe(String(fsState.auditSize));
    expect(stateValue("waf_audit_log_size")).toBe(String(fsState.auditSize));
  });

  it("re-reads from the start when the audit log is replaced by a new inode", async () => {
    // First pass consumes the whole file and records its inode.
    fsState.auditSize = 5_000;
    await parseNewWafLogEntries();
    expect(stateValue("waf_audit_log_offset")).toBe("5000");

    // File is deleted and recreated, then grows past the previously stored
    // size — so the shrink check alone would never notice the replacement.
    fsState.auditInode = 43;
    fsState.auditSize = 9_000;
    await parseNewWafLogEntries();

    // Read restarted at 0, so the offset reflects the full new file.
    expect(stateValue("waf_audit_log_offset")).toBe("9000");
    expect(stateValue("waf_audit_log_inode")).toBe("43");
  });
});
