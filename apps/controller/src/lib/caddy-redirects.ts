import type { RedirectRule } from "./models/proxy-hosts";

/** RE2 escaping for a literal path segment inside `path_regexp`. */
function escapeRegexp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The part of `from` before its first wildcard, without a trailing slash: what "after prefix"
 * strips, so `/old/*` sends `/old/a/b` on as `/a/b`.
 */
export function redirectPrefix(from: string): string {
  const star = from.indexOf("*");
  return (star === -1 ? from : from.slice(0, star)).replace(/\/+$/, "");
}

/** One redirect rule as a route inside the host's redirect subroute. */
export function buildRedirectRoute(rule: RedirectRule): Record<string, unknown> {
  if (!rule.preservePath) {
    return {
      match: [{ path: [rule.from] }],
      handle: [
        {
          handler: "static_response",
          status_code: rule.status,
          headers: { Location: [rule.to] },
        },
      ],
    };
  }

  // The request path is appended, and always starts with "/", so a target of "/" or "" would
  // hand a path of "//evil.example" back as a protocol-relative URL. Browsers read "/\" the same
  // way. Such requests are left unredirected instead.
  const base = rule.to.replace(/\/+$/, "");
  const unsafe: Record<string, unknown>[] = [{ path_regexp: { pattern: "^/[/\\\\]" } }];
  const handle: Record<string, unknown>[] = [];
  if (rule.preservePath === "suffix") {
    const prefix = redirectPrefix(rule.from);
    if (prefix) {
      unsafe.push({ path_regexp: { pattern: `(?i)^${escapeRegexp(prefix)}[/\\\\]{2}` } });
      handle.push({ handler: "rewrite", strip_path_prefix: prefix });
    }
  }
  handle.push({
    handler: "static_response",
    status_code: rule.status,
    headers: { Location: [`${base}{http.request.uri}`] },
  });

  return { match: [{ path: [rule.from], not: unsafe }], handle };
}
