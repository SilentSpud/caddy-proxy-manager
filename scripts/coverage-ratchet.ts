#!/usr/bin/env bun
/**
 * Enforces the suite's coverage ratchet against the lcov report that
 * `bun test --coverage` writes.
 *
 * Bun's own `coverageThreshold` is evaluated per file, so it can only express a
 * floor under the weakest module — not the floor under the suite as a whole
 * that this project ratchets on. The terminal reporter's "All files" row is no
 * substitute either: it averages the per-file percentages, so a hundred-line
 * module and a thousand-line one count the same. lcov carries the raw hit and
 * found counts, so the numbers below are weighted by size.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A ratchet, not an aspiration: these sit just under what the suite achieves
 * today, so a real drop fails the run while ordinary churn does not. Raise them
 * as coverage improves; do not lower them to make a build pass.
 *
 * Rebaselined when the suite moved from Vitest to `bun test`. Bun reports only
 * the files a test actually loaded, and reports functions and lines (there is
 * no statement or branch metric), so these are not comparable to the istanbul
 * thresholds they replace.
 *
 * These assume the serial run that `bun run test:coverage` performs. Under
 * `--parallel` each worker only instruments the files it happened to load and
 * the merge loses some of that, so both the numerator and the denominator move
 * between runs — which is why the coverage script does not use it.
 */
const THRESHOLDS = {
  lines: 58,
  functions: 71,
} as const;

const LCOV_PATH = resolve(import.meta.dir, "..", "coverage", "lcov.info");

type Totals = { found: number; hit: number };

/** Sums the `<prefix>F:`/`<prefix>H:` records lcov emits once per source file. */
function total(report: string, prefix: "L" | "FN"): Totals {
  let found = 0;
  let hit = 0;
  for (const line of report.split("\n")) {
    const [key, value] = line.split(":");
    if (key === `${prefix}F`) found += Number(value);
    else if (key === `${prefix}H`) hit += Number(value);
  }
  return { found, hit };
}

const percent = ({ found, hit }: Totals) => (found === 0 ? 100 : (hit / found) * 100);

let report: string;
try {
  report = readFileSync(LCOV_PATH, "utf8");
} catch {
  console.error(
    `No coverage report at ${LCOV_PATH}. Run \`bun run test:coverage\`, which produces it.`,
  );
  process.exit(1);
}

const measured = {
  lines: total(report, "L"),
  functions: total(report, "FN"),
};

let failed = false;
for (const [metric, threshold] of Object.entries(THRESHOLDS) as [
  keyof typeof THRESHOLDS,
  number,
][]) {
  const { found, hit } = measured[metric];
  const actual = percent(measured[metric]);
  const ok = actual >= threshold;
  if (!ok) failed = true;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${metric.padEnd(9)} ${actual.toFixed(2)}% (${hit}/${found}), ratchet ${threshold}%`,
  );
}

if (failed) {
  console.error(
    "\nCoverage fell below the ratchet. Add tests for what you changed rather than lowering it.",
  );
  process.exit(1);
}
