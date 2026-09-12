/**
 * What an operator runs to fix the log permissions an agent reported.
 *
 * The agent only reports; it runs as its own user and could not change these even if it should.
 * Every fix is a command for the agent's host, run through `docker exec` as root in Caddy's
 * container - which works the same on a named volume and a bind mount, where a host-side `chmod`
 * would first need the operator to find out which of the two they have.
 */

import type { LogAccessReport } from "@cpm/shared";

export type LogAccessFixKind = "groupMismatch" | "unreadable" | "notTruncatable" | "cleanupBlocked";

export type LogAccessFix = {
  kind: LogAccessFixKind;
  path: string;
  gid: number;
  command: string;
};

/** Quoted only when it has to be, so the common `/logs/access.log` reads as typed. */
function shellQuote(value: string): string {
  return /^[\w./:@-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * One fix per problem, in the order reported, except that files whose group the agent is not in
 * collapse into one: that is a CADDY_GID mismatch, and no mode on the file would help.
 */
export function logAccessFixes(report: LogAccessReport | undefined): LogAccessFix[] {
  if (!report) return [];
  const container = shellQuote(report.caddyContainer);
  const exec = `docker exec -u 0 ${container}`;
  const fixes: LogAccessFix[] = [];
  const mismatched = new Set<number>();

  for (const problem of report.problems) {
    const path = shellQuote(problem.path);
    if (problem.kind === "cleanupBlocked") {
      const gid = report.caddyGid ?? problem.gid;
      fixes.push({
        kind: "cleanupBlocked",
        path: problem.path,
        gid,
        command: `${exec} sh -c "chgrp ${gid} ${path} && chmod 2770 ${path}"`,
      });
      continue;
    }

    if (!report.agentGroups.includes(problem.gid)) {
      if (mismatched.has(problem.gid)) continue;
      mismatched.add(problem.gid);
      fixes.push({
        kind: "groupMismatch",
        path: problem.path,
        gid: problem.gid,
        command: `# in .env: CADDY_GID=${problem.gid}\ndocker compose up -d agent`,
      });
      continue;
    }

    const bit = problem.kind === "unreadable" ? "g+r" : "g+w";
    fixes.push({
      kind: problem.kind,
      path: problem.path,
      gid: problem.gid,
      command: `${exec} chmod ${bit} ${path}`,
    });
  }

  return fixes;
}
