/**
 * The active schema, chosen from DATABASE_URL at module load.
 *
 * Drizzle has no dialect-neutral table builder: a table is either a `sqliteTable` or a `pgTable`,
 * and the driver must be handed the matching one. The dialect, though, is a runtime value while
 * types are resolved at compile time, so the two cannot both be inferred. This module resolves
 * that by re-exporting the tables ./connection.ts already gave the driver — so the tables and the
 * connection can never disagree about the dialect — and presenting the PostgreSQL types to
 * TypeScript.
 *
 * PostgreSQL is the canonical side deliberately. It is the stricter of the two: `pg-core` has no
 * `.get()`/`.all()`/`.run()`, so any SQLite-only call reintroduced into app code fails typecheck
 * instead of failing at a PostgreSQL deployment's first request. Row types are unaffected — the
 * two schemas declare identical column names and inferred types, which
 * tests/unit/db-schema-parity.test.ts asserts structurally.
 */
import { activeSchema } from "./connection";

export const {
  users,
  sessions,
  accounts,
  verifications,
  oauthProviders,
  oauthStates,
  pendingOAuthLinks,
  settings,
  instances,
  accessLists,
  accessListEntries,
  certificates,
  caCertificates,
  issuedClientCertificates,
  proxyHosts,
  apiTokens,
  auditEvents,
  linkingTokens,
  logParseState,
  wafLogParseState,
  mtlsRoles,
  mtlsCertificateRoles,
  mtlsAccessRules,
  groups,
  groupMembers,
  forwardAuthAccess,
  forwardAuthSessions,
  forwardAuthExchanges,
  forwardAuthRedirectIntents,
  l4ProxyHosts,
} = activeSchema;
