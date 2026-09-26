/**
 * "Renew now" for a certificate Caddy manages.
 *
 * Caddy has no endpoint that renews a certificate on demand. What it does do, whenever a config is
 * loaded, is check each managed certificate against its policy's renewal window and renew the ones
 * inside it - in the background, still serving the current certificate meanwhile, so a failed
 * renewal can't take a site down. So a requested renewal moves that one name into a policy of its
 * own whose window already includes the current certificate, reloads, and moves it back once a
 * newer certificate shows up in Caddy's storage (or after a while, if none does).
 *
 * The check only runs for a name Caddy doesn't already have cached, and the cache outlives reloads,
 * so the reload is preceded by one that stops managing the name: Caddy evicts it, and the next load
 * reads it back from storage and checks it. TLS for that one name fails between the two.
 *
 * In memory: a request belongs to this controller process, and one lost to a restart only means
 * the certificate renews on its normal schedule.
 */

/** For a certificate whose dates are unknown: all but the last 0.01% of its lifetime. */
export const RENEW_NOW_WINDOW_RATIO = 0.9999;
/** How long a request stays in effect if no newer certificate appears. */
export const RENEWAL_TIMEOUT_MS = 15 * 60 * 1000;

type Pending = { requestedAt: number; ratio: number };
type Lifetime = { notBefore: string; notAfter: string };

const pending = new Map<string, Pending>();
const evicting = new Set<string>();

/** Runs `load` with these names left out of Caddy's management, so they drop out of its cache. */
export async function withEviction(names: string[], load: () => Promise<void>) {
  for (const name of names) evicting.add(name.toLowerCase());
  try {
    await load();
  } finally {
    for (const name of names) evicting.delete(name.toLowerCase());
  }
}

export function evictedNames(): string[] {
  return [...evicting];
}

function prune(now: number) {
  for (const [name, { requestedAt }] of pending) {
    if (now - requestedAt > RENEWAL_TIMEOUT_MS) pending.delete(name);
  }
}

/**
 * The ratio whose window opens once a certificate is 90% as old as the current one: that one is
 * inside it, and its replacement stays outside about as long, so a reload can't renew it again
 * while the request lasts unless the old one was minutes old. A fixed ratio can't: 0.9999 of a
 * 5-year lifetime still shuts out a certificate's first 4 hours.
 */
export function renewNowRatio(current: Lifetime | null | undefined, now = Date.now()): number {
  const notBefore = Date.parse(current?.notBefore ?? "");
  const notAfter = Date.parse(current?.notAfter ?? "");
  const lifetime = notAfter - notBefore;
  if (!(lifetime > 0) || notAfter <= now || notBefore >= now) return RENEW_NOW_WINDOW_RATIO;
  return 1 - Math.max((now - notBefore) * 0.9, 1000) / lifetime;
}

export function requestRenewal(name: string, current?: Lifetime | null, now = Date.now()) {
  pending.set(name.toLowerCase(), { requestedAt: now, ratio: renewNowRatio(current, now) });
}

export function renewalsPending(now = Date.now()): Map<string, Pending> {
  prune(now);
  return new Map(pending);
}

/**
 * Forget the requests a newer certificate has answered. Returns whether any were, so the caller
 * can reload with the ordinary policy again.
 */
export function settleRenewals(
  certificates: { names: string[]; notBefore: string }[],
  now = Date.now(),
): boolean {
  prune(now);
  let settled = false;
  for (const [name, { requestedAt }] of pending) {
    const renewed = certificates.some(
      (cert) =>
        cert.names.some((n) => n.toLowerCase() === name) &&
        Date.parse(cert.notBefore) >= requestedAt - 60_000,
    );
    if (renewed) {
      pending.delete(name);
      settled = true;
    }
  }
  return settled;
}

type Policy = Record<string, unknown> & { subjects?: string[] };

/**
 * The TLS automation policies with each pending name split out into a copy of the policy it came
 * from, carrying its wide renewal window. Only that name renews: widening the original policy
 * would renew every certificate it covers.
 */
export function withRenewalOverrides(policies: Policy[], now = Date.now()): Policy[] {
  const names = renewalsPending(now);
  if (evicting.size > 0) {
    policies = policies
      .map((policy) =>
        policy.subjects
          ? { ...policy, subjects: policy.subjects.filter((s) => !evicting.has(s.toLowerCase())) }
          : policy,
      )
      .filter((policy) => !policy.subjects || policy.subjects.length > 0);
    for (const name of evicting) names.delete(name);
  }
  if (names.size === 0) return policies;
  const overrides: Policy[] = [];
  const rest = policies.map((policy) => {
    const subjects = policy.subjects ?? [];
    const renewing = subjects.filter((subject) => names.has(subject.toLowerCase()));
    if (renewing.length === 0) return policy;
    for (const subject of renewing) {
      overrides.push({
        ...policy,
        subjects: [subject],
        renewal_window_ratio: names.get(subject.toLowerCase())?.ratio,
      });
    }
    const remaining = subjects.filter((subject) => !names.has(subject.toLowerCase()));
    return { ...policy, subjects: remaining };
  });
  // A policy left with no subjects would match everything; drop it instead.
  return [...overrides, ...rest.filter((policy) => !policy.subjects || policy.subjects.length > 0)];
}
