/**
 * Moving an agent's state off the controller's volume, once.
 *
 * Agents used to run as root and keep their database on the volume they shared with the
 * controller. They now run as their own user with a volume of their own, and mount the controller's
 * read-only - so on the first start after that upgrade the state is still over there, and a fresh
 * database here would mint a new agent id that the controller reads as a different machine.
 *
 * Copied rather than moved: the old mount is read-only, which is the point of it. What is left
 * behind is never read again.
 */

import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { BUILD_OVERRIDE_FILE, L4_OVERRIDE_FILE } from "./docker";

const DATABASE = "agent.db";

/**
 * Copy the agent's database and generated compose files from `legacyDir`, when this data directory
 * has none of its own. Returns whether it did.
 *
 * The WAL and shared-memory files come too: the old agent's container is gone by the time this
 * runs, so they are settled, and leaving the WAL behind would lose whatever it had not checkpointed.
 * Each file is copied under a temporary name and renamed, and the database is renamed last - its
 * presence is what marks this done, so a start interrupted halfway copies everything again rather
 * than opening half a database.
 */
export function adoptLegacyState(dataDir: string, legacyDir: string | null): boolean {
  if (!legacyDir) return false;
  if (existsSync(join(dataDir, DATABASE))) return false;
  if (!existsSync(join(legacyDir, DATABASE))) return false;

  mkdirSync(dataDir, { recursive: true });
  const files = [
    BUILD_OVERRIDE_FILE,
    L4_OVERRIDE_FILE,
    `${DATABASE}-wal`,
    `${DATABASE}-shm`,
    DATABASE,
  ];
  for (const name of files) {
    const from = join(legacyDir, name);
    if (!existsSync(from)) continue;
    const to = join(dataDir, name);
    copyFileSync(from, `${to}.migrating`);
    renameSync(`${to}.migrating`, to);
  }
  return true;
}
