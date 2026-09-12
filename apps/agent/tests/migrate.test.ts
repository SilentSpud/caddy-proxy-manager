/**
 * Moving an upgraded agent's state onto its own volume. A real filesystem, since copying files is
 * the whole of it.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_OVERRIDE_FILE, L4_OVERRIDE_FILE } from "../src/docker";
import { adoptLegacyState } from "../src/migrate";

let root: string;
let dataDir: string;
let legacyDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-migrate-"));
  dataDir = join(root, "data");
  legacyDir = join(root, "controller-data");
  mkdirSync(legacyDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("adoptLegacyState", () => {
  it("copies the database, its WAL and the compose overrides", () => {
    for (const name of [
      "agent.db",
      "agent.db-wal",
      "agent.db-shm",
      BUILD_OVERRIDE_FILE,
      L4_OVERRIDE_FILE,
    ]) {
      writeFileSync(join(legacyDir, name), `contents of ${name}`);
    }
    // The controller's own files share that volume and are none of the agent's business.
    writeFileSync(join(legacyDir, "agent-bootstrap"), "token");

    expect(adoptLegacyState(dataDir, legacyDir)).toBe(true);

    for (const name of [
      "agent.db",
      "agent.db-wal",
      "agent.db-shm",
      BUILD_OVERRIDE_FILE,
      L4_OVERRIDE_FILE,
    ]) {
      expect(readFileSync(join(dataDir, name), "utf-8")).toBe(`contents of ${name}`);
    }
    expect(existsSync(join(dataDir, "agent-bootstrap"))).toBe(false);
    expect(existsSync(join(dataDir, "agent.db.migrating"))).toBe(false);
  });

  it("copies what there is when the old agent never wrote an override or a WAL", () => {
    writeFileSync(join(legacyDir, "agent.db"), "db");
    expect(adoptLegacyState(dataDir, legacyDir)).toBe(true);
    expect(readFileSync(join(dataDir, "agent.db"), "utf-8")).toBe("db");
    expect(existsSync(join(dataDir, L4_OVERRIDE_FILE))).toBe(false);
  });

  it("leaves a data directory that already has a database alone", () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "agent.db"), "mine");
    writeFileSync(join(legacyDir, "agent.db"), "old");

    expect(adoptLegacyState(dataDir, legacyDir)).toBe(false);
    expect(readFileSync(join(dataDir, "agent.db"), "utf-8")).toBe("mine");
  });

  it("does nothing without a legacy directory, or without a database in it", () => {
    expect(adoptLegacyState(dataDir, null)).toBe(false);
    expect(adoptLegacyState(dataDir, legacyDir)).toBe(false);
    expect(existsSync(dataDir)).toBe(false);
  });
});
