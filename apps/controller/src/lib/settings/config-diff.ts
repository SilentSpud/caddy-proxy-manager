/**
 * A line diff of the Caddy config document, for the review sheet.
 *
 * Caddy has no JSON-to-Caddyfile converter - its adapter runs one way only (see
 * ../caddy-caddyfile.ts) - so what an operator reviews is the JSON document that is actually
 * pushed, not a Caddyfile rendering of it.
 *
 * Keys are sorted before stringifying so that a diff shows what changed rather than what moved:
 * the builder assembles objects in whatever order its branches run, and an unsorted render turns
 * an unrelated edit into hundreds of reordered lines.
 */

/** Property names whose values are replaced before the document is ever rendered. */
const SECRET_KEY_PATTERN =
  /(token|secret|password|passphrase|api_key|apikey|auth_key|authkey|private_key|privatekey|credential|client_secret)/i;

export type DiffLine = {
  kind: "context" | "added" | "removed" | "gap";
  /** Line number in the staged document; null for a removed line or a gap. */
  line: number | null;
  text: string;
};

export type ConfigDiff = {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the documents are identical, which is normal for a settings-only change. */
  unchanged: boolean;
};

/**
 * Stable JSON with secrets masked.
 *
 * The document carries decrypted credentials - DNS provider tokens, Tailscale auth keys - because
 * that is what Caddy needs. None of them belong in a page rendered for review, so they are masked
 * here rather than at the seam that displays them: a mask applied at render time is one that a
 * later caller can forget.
 */
function render(value: unknown): string {
  return `${stringify(value, "", 0)}\n`;
}

function stringify(value: unknown, key: string, depth: number): string {
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);

  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && SECRET_KEY_PATTERN.test(key)) {
      return JSON.stringify(value.length === 0 ? "" : "********");
    }
    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${inner}${stringify(item, key, depth + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return "{}";
  const body = entries.map(
    ([name, item]) => `${inner}${JSON.stringify(name)}: ${stringify(item, name, depth + 1)}`,
  );
  return `{\n${body.join(",\n")}\n${pad}}`;
}

/**
 * Diff two config documents into display lines.
 *
 * `contextLines` unchanged lines are kept around each change and the rest collapse into a gap
 * marker, so a three-field edit does not render three thousand identical lines.
 */
export function diffConfigDocuments(
  current: unknown,
  staged: unknown,
  contextLines = 3,
): ConfigDiff {
  const before = render(current).split("\n");
  const after = render(staged).split("\n");

  const ops = diffLines(before, after);
  const added = ops.filter((op) => op.kind === "added").length;
  const removed = ops.filter((op) => op.kind === "removed").length;

  return {
    lines: collapse(ops, contextLines),
    added,
    removed,
    unchanged: added === 0 && removed === 0,
  };
}

type Op = { kind: "context" | "added" | "removed"; line: number | null; text: string };

/**
 * Longest-common-subsequence diff, with the shared head and tail trimmed first.
 *
 * The trim is what keeps this affordable: two renders of the same config differ in a handful of
 * lines out of thousands, and the quadratic table only ever sees the part that actually differs.
 */
function diffLines(before: string[], after: string[]): Op[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const ops: Op[] = [];
  for (let i = 0; i < head; i += 1) {
    ops.push({ kind: "context", line: i + 1, text: before[i] as string });
  }

  const midBefore = before.slice(head, before.length - tail);
  const midAfter = after.slice(head, after.length - tail);
  ops.push(...lcsOps(midBefore, midAfter, head));

  for (let i = 0; i < tail; i += 1) {
    const index = after.length - tail + i;
    ops.push({ kind: "context", line: index + 1, text: after[index] as string });
  }
  return ops;
}

function lcsOps(before: string[], after: string[], offset: number): Op[] {
  const rows = before.length;
  const cols = after.length;

  // Nothing to align: one side is empty, so every line on the other is a plain insert or delete.
  if (rows === 0 || cols === 0) {
    return [
      ...before.map((text) => ({ kind: "removed" as const, line: null, text })),
      ...after.map((text, i) => ({ kind: "added" as const, line: offset + i + 1, text })),
    ];
  }

  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      const next = table[i + 1] as number[];
      row[j] =
        before[i] === after[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      ops.push({ kind: "context", line: offset + j + 1, text: after[j] as string });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] as number) >= (table[i]?.[j + 1] as number)) {
      ops.push({ kind: "removed", line: null, text: before[i] as string });
      i += 1;
    } else {
      ops.push({ kind: "added", line: offset + j + 1, text: after[j] as string });
      j += 1;
    }
  }
  while (i < rows) {
    ops.push({ kind: "removed", line: null, text: before[i] as string });
    i += 1;
  }
  while (j < cols) {
    ops.push({ kind: "added", line: offset + j + 1, text: after[j] as string });
    j += 1;
  }
  return ops;
}

/** Keep `context` lines either side of each change; replace longer runs with a gap marker. */
function collapse(ops: Op[], context: number): DiffLine[] {
  const keep = new Set<number>();
  ops.forEach((op, index) => {
    if (op.kind === "context") return;
    for (let i = index - context; i <= index + context; i += 1) {
      if (i >= 0 && i < ops.length) keep.add(i);
    }
  });

  const lines: DiffLine[] = [];
  let skipped = 0;
  ops.forEach((op, index) => {
    if (keep.has(index)) {
      if (skipped > 0) {
        lines.push({ kind: "gap", line: null, text: `${skipped} unchanged lines` });
        skipped = 0;
      }
      lines.push(op);
      return;
    }
    skipped += 1;
  });
  if (skipped > 0) {
    lines.push({ kind: "gap", line: null, text: `${skipped} unchanged lines` });
  }
  return lines;
}
