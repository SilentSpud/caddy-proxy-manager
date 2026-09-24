/**
 * The application's tables, for whichever backend DATABASE_URL names.
 *
 * Drizzle has no dialect-neutral table builder, and the dialect is a runtime value while types are
 * compile-time, so this exports the SQLite tables typed as their PostgreSQL twins when SQLite is
 * in use. The two declare identical column names and inferred types, which
 * tests/unit/db-schema-parity.test.ts asserts. ./connection.ts refuses to start if it and this
 * module ever disagree about the dialect.
 *
 * Decided here from the environment rather than imported from the connection, so a test can import
 * tables without opening a database.
 */
import { databaseDialect } from "./dialect";
import * as pgSchema from "./schema.pg";
import * as sqliteSchema from "./schema.sqlite";

export const schemaDialect = databaseDialect(process.env);

// Spread into a plain object: a module namespace has a null prototype, and Better Auth's schema
// check (drizzle's `is()`) throws on one under Vite, failing every sign-in with a 500.
export const activeSchema = {
  ...(schemaDialect === "sqlite" ? sqliteSchema : pgSchema),
} as unknown as typeof pgSchema;

export const {
  users,
  sessions,
  accounts,
  verifications,
  oauthProviders,
  oauthStates,
  pendingOAuthLinks,
  settings,
  settingsStaged,
  settingsRevisions,
  agents,
  accessLists,
  accessListEntries,
  certificates,
  caCertificates,
  issuedClientCertificates,
  proxyHosts,
  apiTokens,
  auditEvents,
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
  proxyHostAgents,
  l4ProxyHostAgents,
  groupIdpMappings,
  groupGrants,
  wafPresets,
  crsPlugins,
} = activeSchema;
