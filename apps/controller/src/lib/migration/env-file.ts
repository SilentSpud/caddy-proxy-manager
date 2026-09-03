/**
 * Producing the `.env` a deployment should keep once its settings live in the database.
 *
 * The output is the operator's copy of their own file with the migrated lines removed, not a
 * generated template — comments, ordering and anything we do not recognise are preserved exactly.
 * A file rewritten from a template would silently drop whatever else they had put in it.
 */
import { SETTINGS_BY_ENV } from "../settings/registry";

/** `KEY=`, `export KEY=` — the same shape the test harness's dotenv reader recognises. */
const ASSIGNMENT = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export type TrimResult = {
  /** The file to keep, with migrated assignments commented out. */
  contents: string;
  /** The variables that were commented out, for the summary shown alongside it. */
  removed: string[];
};

/**
 * Comment out every assignment whose setting now lives in the database.
 *
 * Commented rather than deleted: the values are the only copy of some secrets an operator has, and
 * a migration that silently erased them from the file it hands back would be a poor trade for
 * tidiness. They can delete the block themselves once they are satisfied.
 */
export function trimMigratedEnv(contents: string): TrimResult {
  const removed: string[] = [];

  const lines = contents.split("\n").map((line) => {
    const match = ASSIGNMENT.exec(line);
    if (!match) return line;

    const [, indent, name] = match;
    if (!SETTINGS_BY_ENV.has(name)) return line;

    removed.push(name);
    return `${indent}# migrated to the database: ${line.trim()}`;
  });

  if (removed.length === 0) {
    return { contents, removed };
  }

  const header = [
    '# The lines below marked "migrated to the database" are now stored in PostgreSQL and are',
    "# no longer read from this file. They are commented rather than deleted so you keep a copy;",
    "# remove them once you are satisfied the values came across.",
    "",
  ];

  return { contents: [...header, ...lines].join("\n"), removed };
}
