# Security Analysis: Generic Forward Auth Provider (issue #188)

Scope: the `forward_auth` per-host meta block, its Caddy config generation
(`src/lib/caddy.ts`), model-layer validation (`src/lib/models/proxy-hosts.ts`),
the `ForwardAuthFields` UI, the `forward_auth` global defaults settings group,
and the functional security tests (`tests/e2e/functional/forward-auth-generic.spec.ts`).

## 1. Summary of the feature surface

A proxy host can now authenticate through any forward-auth server (Authelia
preset or custom), with three orthogonal, composable behaviors:

1. **Browser branch** — requests with `Accept: text/html` and no
   `X-Requested-With` header go through forward auth unchanged; the auth
   server's `302` portal redirect reaches the browser.
2. **API split (`api_split`)** — all other requests (API clients, WebSocket
   handshakes) are routed through a forward-auth handler whose `handle_response`
   converts any `3xx` from the auth server into a bare `401 Unauthorized`.
3. **Bypass headers (`api_bypass_headers`)** — requests carrying any of the
   configured header names skip forward auth entirely and reach the upstream,
   which performs its own API-key / `Authorization` check.

Identity headers copied from the auth server's `2xx` response (e.g. Authelia's
`Remote-User`, `Remote-Groups`) are forwarded to the upstream. Protected and
excluded paths behave identically to the existing Authentik/CPM modes.

## 2. Threat model

Assets: upstream service identity assumptions (the `Remote-*` headers upstream
apps trust), the auth server's session, and CPM's configuration integrity.

Adversaries:

- **Unauthenticated external client** — can send arbitrary headers, choose
  browser-like or API-like request shapes, and attempt to reach any path.
- **Authenticated user of the auth server** — cannot modify CPM config; may
  attempt to escalate what identity headers reach the upstream.
- **CPM admin** — already trusted with full Caddy JSON injection
  (`custom_reverse_proxy_json`, `custom_pre_handlers_json`); the generic
  forward-auth fields must not grant them *new* capabilities beyond what those
  fields already allow, and must not let non-admins influence generated config.

## 3. Identity header spoofing (primary risk; mitigated)

**Risk.** The upstream trusts headers such as `Remote-User` /
`Remote-Groups` to describe the *authenticated* caller. A caller that sets
`Remote-User: admin` directly can impersonate another user if the header
reaches the upstream:

- on routes that never run forward auth (excluded paths, bypass routes,
  unprotected catch-alls in whitelist mode), the forged header passes through
  untouched; and
- on authenticated routes, CPM's copy step only *overwrites* a header when the
  auth response value is non-empty — a user in no groups returns an empty
  `Remote-Groups`, leaving a forged value intact.

This is the exact bug class fixed for CPM's own forward auth (`X-CPM-*`
stripping, SECURITY-AUDIT H1). The generic provider inherits the same defense:

- A `headers` handler that **deletes every configured `copy_headers` name** is
  prepended to the shared handler chain for *all* of the host's routes —
  protected, unprotected catch-all, excluded, bypass, and location routes
  alike — so a forged identity header is removed before the request reaches
  the upstream regardless of authentication outcome.
- The strip list is exactly the copy list, so a header CPM would have copied
  can never be client-supplied.
- Verified end-to-end in
  `tests/e2e/functional/forward-auth-generic.spec.ts` ("spoofed Remote-User is
  stripped on the bypassed / excluded route").

Residual risk: an upstream that trusts a header *outside* the copy list can
still be spoofed (e.g. an app reading `X-We-Trust-This` directly). That is
outside CPM's visibility; the copy list should therefore include every header
the upstream consumes.

## 4. Fail-closed behavior on invalid configuration

A generated-but-broken or silently-skipped auth block must never degrade into
an unprotected host. Three layers enforce this:

1. **Model validation rejects impossible states at write time**
   (`normalizeForwardAuthInput`): when generic forward auth is enabled, an
   absent or non-`http(s)` `authUpstream` throws `ApiValidationError`, and the
   `custom` provider requires a non-empty `authEndpoint`. (Authelia hosts may
   omit the endpoint because generation applies the preset default.)
2. **Generation skips what it cannot parse** (`parseForwardAuthConfig`
   returns `null` unless the upstream parses as an http(s) URL and the
   endpoint is a sane absolute path). Skipping — rather than emitting a
   partial route — keeps Caddy's config loadable, but because layer 1 rejects
   the inputs that would cause a skip on a *live* write, the remaining skip
   cases (hand-edited DB rows) are operational, not attacker-reachable.
3. **Caddy rejection is loud**: if Caddy rejects the generated document,
   `applyCaddyConfig` raises `CaddyApplyError` and the API reports failure —
   the host is not silently left unprotected while the UI claims success.

## 5. Injection into generated Caddy config

Generated config is built as JSON structures (never string-templated), so
classic Caddyfile/directive injection does not apply. The remaining injection
channels are Caddy's own placeholder expansion and matcher semantics:

- **Placeholder injection via `{...}`**: values interpolated into Caddy
  placeholder strings (the auth endpoint used as `rewrite.uri`, header names
  used inside `{http.reverse_proxy.header.<name>}`, path matchers) are stripped
  of `{...}` sequences at model sanitize time and again at generation time
  (defense in depth; generation reads raw meta JSON).
- **Header names are validated against the RFC 7230 token grammar**
  (`HEADER_NAME_RE`) before being used in `headers.request.delete` lists,
  `handle_response` copy placeholders, and bypass header matchers. Free-form
  text (spaces, control characters, braces) cannot reach a matcher key or a
  placeholder.
- **Auth endpoint**: must start with `/`, may carry a query string (needed for
  Authelia's `authelia_url` portal parameter), and is checked for CR/LF/NUL.
- **Auth server URL**: must parse as `http:`/`https:` URL; only the
  `host:port` dial address is emitted (path components are dropped, matching
  the Authentik behavior).

## 6. The browser/API split matcher: can it be abused?

The split uses a header heuristic — `Accept: *text/html*` present and
`X-Requested-With` absent ⇒ browser branch. Two properties make this safe:

- **The choice only changes the failure presentation, not the gate.** Both
  branches run forward auth against the same endpoint with the same
  trusted-proxies and copy semantics. A malicious client can *claim* to be a
  browser to receive the 302 portal redirect instead of a 401 — but it remains
  unauthenticated and gets a redirect to the IdP's portal, not access.
- **WebSocket handshakes cannot opt into the browser branch by accident or
  design** (no `Accept: text/html` in a standard handshake) and so always land
  in the 401 branch under `api_split`, preventing an HTML login page from
  being served mid-upgrade.

One consequence worth documenting: without `api_split`, the failure mode for
API clients is whatever the auth server returns — for always-redirect
providers that is an HTML redirect. This is why the UI marks the split as
recommended for mixed UI+API hosts.

## 7. Bypass headers: explicit, client-controlled auth delegation

Bypass headers are the sharpest edge of this feature and are documented as
such in the UI and wiki:

- **Any client can set a header.** Adding `X-Api-Key` to the bypass list
  delegates authentication for matching requests entirely to the upstream. If
  the upstream does not actually enforce that key (misconfiguration), the
  path is effectively public. The UI helper text and wiki call this out
  ("the upstream can authenticate them itself").
- Bypass is **all-or-nothing per header name across the host** (scoped only by
  the protected/excluded path mode for where auth would have applied). It
  cannot be scoped to specific values (e.g. "only key abc"), because Caddy
  header matchers here intentionally do not see secret values — value-scoped
  bypass rules would embed secrets in Caddy's config, which is readable via
  the admin API. Upstream value enforcement is the correct boundary.
- Bypass routes still pass through the shared handler chain (geoblock, WAF,
  basic auth, HSTS) and the identity-header strip handler, so bypassing
  forward auth does not bypass the rest of the host's protections.

## 8. Trust boundaries for the auth subrequest

- The subrequest carries `X-Forwarded-Method`, `X-Forwarded-Uri`,
  `X-Forwarded-Host`, and `X-Forwarded-Proto` set from Caddy's request
  context — the auth server should treat these as trusted only from Caddy's
  network position (same assumption as the Authentik and CPM providers).
- `trusted_proxies` (default `private_ranges`, expanded to explicit CIDRs)
  controls which peers Caddy trusts for `X-Forwarded-For` on the subrequest so
  the auth server sees the real client IP for logging/banning. Expanding
  `private_ranges` server-side (as the Authentik path does) avoids emitting a
  shorthand that older Caddy builds might not resolve identically.
- The auth server's `3xx` responses are converted to `401` in the API branch —
  the `Location` header is dropped rather than forwarded, so a compromised or
  misbehaving auth server cannot redirect an API client to an attacker-chosen
  URL through the API branch (the browser branch intentionally forwards the
  portal redirect; its destination is the IdP's own portal URL).

## 9. Provider mutual exclusion

Only one forward-auth provider may be enabled per host. `buildMeta` rejects
(enabling) writes that would leave two providers active, because generation
applies a fixed precedence (`authentik` > `forward_auth` > `cpm_forward_auth`)
and a silently-ignored provider is a config the UI shows as active. Legacy rows
that already contain a conflict keep working (precedence unchanged) but cannot
be extended — only resolved.

## 10. Admin-only reachability

All write paths for the new configuration go through:

- the dashboard server actions (`requireAdmin`),
- `PUT/POST /api/v1/proxy-hosts` (`requireApiAdmin`), and
- `PUT /api/v1/settings/forward-auth` (`requireApiAdmin`).

The global defaults are additionally protected by the existing settings
validation (`onlyKeys`, URL/type checks, payload size limit) and the settings
update lock. Instance sync propagates the `forward_auth` defaults to slaves in
the same authenticated channel as the other settings groups and tolerates
payloads from older masters (optional field).

## 11. Testing coverage

| Property | Test |
|---|---|
| Browser branch keeps redirect flow; API branch converts 3xx→401 | `tests/unit/caddy-forward-auth-generic.test.ts` (split tests) |
| Strip-before-upstream on every route incl. excluded/bypass | unit test "strips spoofable identity headers…" + functional spoofing tests |
| WebSocket handshake ⇒ 401 | functional test via raw-socket handshake |
| **Authenticated WebSocket upgrade through the forward-auth layer** | `tests/e2e/functional/forward-auth-real-authelia.spec.ts` (101 via real Authelia session) |
| Bypass headers skip auth, still behind strip + WAF/geoblock chain | unit + functional tests |
| Valid session ⇒ identity headers copied to upstream | functional tests (whoami body assertions) |
| **Real IdP negotiation** (browser 302 / API 401 / `Accept: */*` wildcard behavior) | `forward-auth-real-authelia.spec.ts` against actual Authelia v4.38 |
| **Real upstream enforcement** (bypass delegates to the upstream's own key; wrong key rejected by Moonraker, not by CPM) | `forward-auth-real-moonraker.spec.ts` against actual Moonraker v0.11 |
| Fail-closed on invalid upstream / missing endpoint | unit tests (`rejects` assertions) |
| One-provider-per-host conflict rule (incl. legacy escape hatch) | unit tests |
| Real Caddy accepts the generated config (matcher shapes, `not` array form) | all functional tests run through the live Caddy container |

Notes from the real-IdP integration tests that unit tests could not capture:

- Authelia v4.38 requires `https` for the target URL (tests run over TLS with
  an imported self-signed certificate, matching production) and for any
  configured portal URL.
- Authelia treats a leading `Accept: */*` as browser-like and responds 302 —
  the apiSplit 3xx→401 conversion is what turns that into a clean 401 for
  machine clients (asserted with the exact static body).

## 12. Recommendations for operators

1. Always keep the copy-header list equal to the set of identity headers your
   upstream actually consumes — nothing more, nothing less.
2. Prefer `api_split: true` on any host that serves non-browser clients.
3. Only add a bypass header when the upstream demonstrably enforces its own
   authentication for requests carrying it; verify with a negative test
   (request with the header and a *bad* key must be rejected by the upstream).
4. Put the auth server on a trusted network segment and configure its
   trusted-proxy list to match `trusted_proxies` here.
