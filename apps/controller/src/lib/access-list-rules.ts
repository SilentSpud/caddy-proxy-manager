/**
 * An access list as Caddy handlers: ordered IP rules, basic-auth accounts, and how the two combine.
 *
 * Pure, so the whole decision table is testable without a database. Every handler returned sits in
 * the host's shared chain, where a `subroute` whose matching route has no handlers of its own simply
 * carries on with the rest of the host - that is how an allowed address "passes".
 */
import { isIP } from "node:net";
import { domainError } from "./domain-error";

export const IP_RULE_ACTIONS = ["allow", "deny"] as const;
export type IpRuleAction = (typeof IP_RULE_ACTIONS)[number];
export const ACCESS_LIST_SATISFY = ["all", "any"] as const;
export type AccessListSatisfy = (typeof ACCESS_LIST_SATISFY)[number];

export type IpRule = { action: IpRuleAction; cidr: string; note: string | null };

export type AccessListRuntime = {
  accounts: { username: string; passwordHash: string }[];
  ipRules: IpRule[];
  ipDefault: IpRuleAction;
  satisfy: AccessListSatisfy;
  passAuth: boolean;
};

/** Caps what one list can put in every request's path. */
export const MAX_IP_RULES = 500;
const MAX_NOTE_LENGTH = 200;

/** A bare address becomes a single-address range; anything else must be a well-formed CIDR. */
export function normalizeCidr(value: string): string | null {
  const text = value.trim();
  const slash = text.indexOf("/");
  if (slash === -1) {
    const version = isIP(text);
    return version === 4 ? `${text}/32` : version === 6 ? `${text}/128` : null;
  }
  const address = text.slice(0, slash);
  const prefix = text.slice(slash + 1);
  const version = isIP(address);
  if (version === 0 || !/^\d{1,3}$/.test(prefix)) return null;
  return Number(prefix) <= (version === 4 ? 32 : 128) ? `${address}/${Number(prefix)}` : null;
}

/** Validates rules from the API or the editor, in the order given. */
export function sanitizeIpRules(value: unknown): IpRule[] {
  if (!Array.isArray(value)) throw domainError("ipRulesInvalid", {}, { status: 400 });
  if (value.length > MAX_IP_RULES) {
    throw domainError("ipRulesTooMany", { max: MAX_IP_RULES }, { status: 400 });
  }
  return value.map((item, index) => {
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const action = raw.action;
    const cidr = typeof raw.cidr === "string" ? normalizeCidr(raw.cidr) : null;
    if (!(IP_RULE_ACTIONS as readonly unknown[]).includes(action) || !cidr) {
      throw domainError("ipRuleInvalid", { index: index + 1 }, { status: 400 });
    }
    const note = typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_NOTE_LENGTH) : "";
    return { action: action as IpRuleAction, cidr, note: note || null };
  });
}

const DENY = { handler: "static_response", status_code: 403, body: "Access denied" };

function basicAuth(accounts: AccessListRuntime["accounts"]): Record<string, unknown> {
  return {
    handler: "authentication",
    providers: {
      http_basic: {
        accounts: accounts.map((entry) => ({
          username: entry.username,
          password: entry.passwordHash,
        })),
      },
    },
  };
}

/**
 * The IP rules as one subroute: the first rule matching the client decides, then the default.
 * `onDeny` is what a denied address gets - a 403 when the password can't rescue it, or the
 * password prompt under "any".
 *
 * No route is terminal: a terminal route inside a subroute ends the whole request, so an allowed
 * address would get an empty 200 instead of the host. First-match order comes from each rule's
 * matcher excluding every range above it, and an allowed address simply matches nothing here.
 */
function ipSubroute(list: AccessListRuntime, onDeny: Record<string, unknown>[]) {
  const routes: Record<string, unknown>[] = [];
  const above: string[] = [];
  for (const rule of list.ipRules) {
    if (rule.action === "deny") {
      // client_ip, not remote_ip: it honours the server's trusted_proxies.
      const match: Record<string, unknown> = { client_ip: { ranges: [rule.cidr] } };
      if (above.length > 0) match.not = [{ client_ip: { ranges: [...above] } }];
      routes.push({ match: [match], handle: onDeny });
    }
    above.push(rule.cidr);
  }
  if (list.ipDefault === "deny") {
    routes.push({ match: [{ not: [{ client_ip: { ranges: above } }] }], handle: onDeny });
  }
  return { handler: "subroute", routes };
}

/** The handlers a host (or one of its location rules) puts in its chain for this list. */
export function buildAccessListHandlers(list: AccessListRuntime): Record<string, unknown>[] {
  const hasAccounts = list.accounts.length > 0;
  const hasIpRules = list.ipRules.length > 0;

  // Fail closed: a list with nothing in it admits nobody.
  if (!hasAccounts && !hasIpRules) return [DENY];

  const handlers: Record<string, unknown>[] = [];
  if (hasIpRules && hasAccounts && list.satisfy === "any") {
    // An allowed address walks in; everyone else is asked for the password.
    handlers.push(ipSubroute(list, [basicAuth(list.accounts)]));
  } else {
    if (hasIpRules) handlers.push(ipSubroute(list, [DENY]));
    if (hasAccounts) handlers.push(basicAuth(list.accounts));
  }
  // The upstream sees CPM's gate credentials only when the list says it should.
  if (hasAccounts && !list.passAuth) {
    handlers.push({ handler: "headers", request: { delete: ["Authorization"] } });
  }
  return handlers;
}
