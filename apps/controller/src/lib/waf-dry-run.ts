/**
 * Asking a real Caddy whether a WAF configuration loads, before it is saved.
 *
 * Coraza compiles a WAF while Caddy provisions its config, so a directive it refuses fails the
 * whole document and every host stops updating. The linter (`seclang.ts`) catches what can be
 * known from the text; this catches the rest - a rule id the CRS already uses, two rules from
 * different sources colliding once merged - by having an agent run `caddy validate` on the WAFs a
 * save would produce, with the binary its Caddy runs.
 *
 * Best effort by design. With no agent able to run it (none attached, one older than the
 * `caddy-validate` capability, Caddy not started yet) the save goes ahead on the linter's word,
 * and the apply-time recovery in `crs-plugins/recovery.ts` stays the net.
 */

import { CADDY_VALIDATE_REFUSED_STATUS } from "@cpm/shared";
import { type CrsPluginRules, buildWafHandler, resolveEffectiveWaf } from "./caddy-waf";
import { domainError } from "./domain-error";
import type { WafHostConfig } from "./models/proxy-hosts";
import type { WafSettings } from "./settings";

/** What a candidate WAF belongs to, which is what the refusal names. */
export type WafDryRunTarget =
  | { kind: "global" }
  | { kind: "dashboard" }
  | { kind: "host"; name: string }
  | { kind: "preset" }
  | { kind: "plugin" };

export type WafDryRunCandidate = { target: WafDryRunTarget; waf: WafSettings | null };

export type WafDryRunOutcome =
  | { status: "accepted" }
  | { status: "refused"; target: WafDryRunTarget; detail: string }
  /** Nothing was learned; the save proceeds. */
  | { status: "skipped"; reason: "noAgent" | "unavailable" | "notWaf" };

/** Runs `caddy validate` on a config; null when nothing can. */
export type CaddyValidator = (config: string) => Promise<{ status: number; text: string } | null>;

const agentValidator: CaddyValidator = async (config) => {
  const { isDemoMode } = await import("./demo-mode");
  if (isDemoMode()) return null;
  const { caddyValidateViaAgent } = await import("./agent/client");
  return caddyValidateViaAgent(config);
};

let validator: CaddyValidator = agentValidator;

/** Test seam, shaped like `setCaddyAdminTransport`: returns the previous one to restore. */
export function setCaddyValidator(next: CaddyValidator): CaddyValidator {
  const previous = validator;
  validator = next;
  return previous;
}

/** Ports the candidate servers claim. Nothing binds during validate; distinct only so none clash. */
const CANDIDATE_PORT_BASE = 20_000;

/**
 * A config holding nothing but one server per WAF handler, so what Caddy provisions is the WAFs
 * and the server name in a refusal says which one failed.
 */
export function buildValidationDocument(handlers: readonly Record<string, unknown>[]): string {
  const servers = Object.fromEntries(
    handlers.map((handler, index) => [
      `candidate_${index}`,
      {
        listen: [`127.0.0.1:${CANDIDATE_PORT_BASE + index}`],
        automatic_https: { disable: true },
        routes: [{ handle: [handler] }],
      },
    ]),
  );
  return JSON.stringify({ admin: { disabled: true }, apps: { http: { servers } } });
}

/** Coraza's wording for a WAF it could not build, as caddy-apply-error.ts matches it. */
const WAF_FAILURE = /provision http\.handlers\.waf: |invalid WAF config/i;
/** Long enough for any Coraza message; a rule it quotes whole is cut. */
const MAX_DETAIL = 400;

/**
 * Which candidate Caddy refused and Coraza's reason, or null when the refusal is not a WAF's -
 * a Caddy built without coraza, say, which says nothing about the directives.
 *
 * The reason is shown as Coraza wrote it, untranslated: it quotes only the directives being saved
 * and the public CRS, since the document held nothing else.
 */
export function parseValidationRefusal(
  transcript: string,
): { index: number | null; detail: string } | null {
  const lines = transcript.split("\n").map((line) => line.trim());
  const error = [...lines].reverse().find((line) => line.startsWith("Error:")) ?? lines.join(" ");
  const match = WAF_FAILURE.exec(error);
  if (!match) return null;
  const server = /server candidate_(\d+)/.exec(error);
  const detail = error
    .slice(match.index + (match[0].startsWith("provision") ? match[0].length : 0))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return {
    index: server ? Number(server[1]) : null,
    detail: detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}...` : detail,
  };
}

/** Validates every candidate that would emit a WAF handler, in one `caddy validate`. */
export async function dryRunWaf(
  candidates: readonly WafDryRunCandidate[],
  presets: ReadonlyMap<number, string>,
  plugins: ReadonlyMap<number, CrsPluginRules>,
): Promise<WafDryRunOutcome> {
  const targets: WafDryRunTarget[] = [];
  const handlers: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const { target, waf } of candidates) {
    // What caddy.ts skips: no handler, nothing for Coraza to compile.
    if (!waf?.enabled || waf.mode === "Off") continue;
    const handler = buildWafHandler(waf, presets, plugins);
    // Most hosts inherit the global WAF unchanged; compiling it once per host only costs time.
    const key = JSON.stringify(handler);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
    handlers.push(handler);
  }
  if (handlers.length === 0) return { status: "accepted" };

  let answer: Awaited<ReturnType<CaddyValidator>>;
  try {
    answer = await validator(buildValidationDocument(handlers));
  } catch (error) {
    console.warn(
      "[waf] could not dry-run the WAF configuration:",
      error instanceof Error ? error.message : error,
    );
    return { status: "skipped", reason: "unavailable" };
  }
  if (!answer) return { status: "skipped", reason: "noAgent" };
  if (answer.status !== CADDY_VALIDATE_REFUSED_STATUS) return { status: "accepted" };

  const refusal = parseValidationRefusal(answer.text);
  if (!refusal) {
    console.warn(
      "[waf] caddy validate refused the WAF dry run for a reason that is not the WAF's.",
    );
    return { status: "skipped", reason: "notWaf" };
  }
  const target = (refusal.index !== null ? targets[refusal.index] : undefined) ?? targets[0];
  return { status: "refused", target, detail: refusal.detail };
}

const REFUSAL_CODES = {
  global: "wafDryRunRejectedGlobal",
  dashboard: "wafDryRunRejectedDashboard",
  host: "wafDryRunRejectedHost",
  preset: "wafDryRunRejectedPreset",
  plugin: "wafDryRunRejectedPlugin",
} as const;

/** Throws when Caddy refuses one of the candidates; anything else lets the save proceed. */
export async function assertWafLoads(
  candidates: readonly WafDryRunCandidate[],
  rules: {
    presets?: ReadonlyMap<number, string>;
    plugins?: ReadonlyMap<number, CrsPluginRules>;
  } = {},
): Promise<void> {
  if (!candidates.some(({ waf }) => waf?.enabled && waf.mode !== "Off")) return;
  const presets = rules.presets ?? (await loadPresets());
  const plugins = rules.plugins ?? (await loadPlugins());
  const outcome = await dryRunWaf(candidates, presets, plugins);
  if (outcome.status !== "refused") return;
  const { target, detail } = outcome;
  throw domainError(
    REFUSAL_CODES[target.kind],
    target.kind === "host" ? { name: target.name, detail } : { detail },
    { status: 400 },
  );
}

// Lazy: the models import this module, and caddy.ts imports them.
async function loadPresets(): Promise<Map<number, string>> {
  const { getWafPresetDirectives } = await import("./models/waf-presets");
  return getWafPresetDirectives();
}

async function loadPlugins(): Promise<Map<number, CrsPluginRules>> {
  const { getCrsPluginRules } = await import("./models/crs-plugins");
  return getCrsPluginRules();
}

// ---------------------------------------------------------------------------
// Candidates: the WAFs a save would change, resolved as caddy.ts resolves them.
// ---------------------------------------------------------------------------

type HostWaf = { target: WafDryRunTarget; waf: WafHostConfig | null | undefined };

function wafInMeta(meta: string | null | undefined): WafHostConfig | null {
  if (!meta) return null;
  try {
    return (JSON.parse(meta) as { waf?: WafHostConfig })?.waf ?? null;
  } catch {
    return null;
  }
}

/** The dashboard host, when served, and every enabled proxy host, with their own WAF blocks. */
async function hostWafs(): Promise<HostWaf[]> {
  const [{ default: db }, { proxyHosts }, { eq }, { getDashboardSettings }] = await Promise.all([
    import("./db"),
    import("./db/schema"),
    import("drizzle-orm"),
    import("./settings"),
  ]);
  const [dashboard, rows] = await Promise.all([
    getDashboardSettings(),
    db
      .select({ name: proxyHosts.name, meta: proxyHosts.meta })
      .from(proxyHosts)
      .where(eq(proxyHosts.enabled, true)),
  ]);
  const out: HostWaf[] = [];
  if (dashboard?.enabled) {
    out.push({ target: { kind: "dashboard" }, waf: wafInMeta(dashboard.options?.meta) });
  }
  for (const row of rows)
    out.push({ target: { kind: "host", name: row.name }, waf: wafInMeta(row.meta) });
  return out;
}

async function currentGlobal(): Promise<WafSettings | null> {
  const { getWafSettings } = await import("./settings");
  return getWafSettings();
}

/** A global save changes the global WAF and every host that merges it. */
export async function wafCandidatesForGlobal(next: WafSettings): Promise<WafDryRunCandidate[]> {
  return [
    { target: { kind: "global" }, waf: next },
    ...(await hostWafs()).map(({ target, waf }) => ({
      target,
      waf: resolveEffectiveWaf(next, waf),
    })),
  ];
}

/** A host save changes that host's WAF alone. */
export async function wafCandidatesForHost(
  target: WafDryRunTarget,
  waf: WafHostConfig | null | undefined,
): Promise<WafDryRunCandidate[]> {
  return [{ target, waf: resolveEffectiveWaf(await currentGlobal(), waf) }];
}

/** Every WAF the config builds today whose settings `selects`, for a preset or plugin edit. */
export async function wafCandidatesSelecting(
  selects: (waf: WafSettings) => boolean,
): Promise<WafDryRunCandidate[]> {
  const global = await currentGlobal();
  const all: WafDryRunCandidate[] = [
    { target: { kind: "global" }, waf: global },
    ...(await hostWafs()).map(({ target, waf }) => ({
      target,
      waf: resolveEffectiveWaf(global, waf),
    })),
  ];
  return all.filter(({ waf }) => waf !== null && selects(waf));
}
